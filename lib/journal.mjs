// Encrypted, hash-chained, append-only private journal with a rollback anchor.
// Several fixed workers append concurrently, so every append and state write takes a
// short cross-process lock and refreshes the head from disk first. The anchor file is
// non-secret and is the local rollback witness; epoch memos are the external witness.
import fs from 'node:fs';
import { P, ensureDirs } from './paths.mjs';
import { atomicWrite, atomicJson, canon, readJson, sha256hex, now, sleep } from './util.mjs';
import { ensureMasterKey, encrypt, decrypt } from './seal.mjs';

let MASTER = null;
let SEQ = 0;
let HEAD = '0'.repeat(64);
const LOCK = () => P.state + '/journal.lock';

async function acquire({ timeoutMs = 15000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(LOCK(), 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return;
    } catch (e) {
      if (fs.existsSync(LOCK())) {
        const age = Date.now() - fs.statSync(LOCK()).mtimeMs;
        if (age > 20000) { try { fs.unlinkSync(LOCK()); } catch {} continue; }
      }
      if (Date.now() - t0 > timeoutMs) throw new Error('journal lock timeout');
      await sleep(15 + Math.random() * 30);
    }
  }
}
function release() { try { fs.unlinkSync(LOCK()); } catch {} }

function lastRecord() {
  if (!fs.existsSync(P.journal)) return null;
  const txt = fs.readFileSync(P.journal, 'utf8');
  const lines = txt.split('\n').filter(Boolean);
  return lines.length ? JSON.parse(lines[lines.length - 1]) : null;
}

export function refreshHead() {
  const r = lastRecord();
  if (r) { SEQ = r.seq + 1; HEAD = r.hash; } else { SEQ = 0; HEAD = '0'.repeat(64); }
  return { seq: SEQ, head: HEAD };
}

export function openJournal() {
  ensureDirs();
  MASTER = ensureMasterKey().key;
  if (!fs.existsSync(P.journal)) fs.writeFileSync(P.journal, '');
  const lines = fs.readFileSync(P.journal, 'utf8').split('\n').filter(Boolean);
  let prev = '0'.repeat(64);
  let sawSealed = false;
  for (const line of lines) {
    const r = JSON.parse(line);
    if (r.type === 'identity.sealed') sawSealed = true;
    if (r.prev !== prev) throw new Error(`journal chain break at seq ${r.seq}`);
    const h = sha256hex(canon({ seq: r.seq, ts: r.ts, prev: r.prev, iv: r.iv, ct: r.ct, tag: r.tag }));
    if (h !== r.hash) throw new Error(`journal hash mismatch at seq ${r.seq}`);
    prev = r.hash;
  }
  SEQ = lines.length;
  HEAD = prev;
  const anchor = readJson(P.anchor, null);
  if (anchor) {
    if (anchor.seq > SEQ) throw new Error(`ROLLBACK: anchor seq ${anchor.seq} > journal seq ${SEQ}`);
    if (anchor.seq === SEQ && anchor.head !== HEAD) {
      throw new Error(`ROLLBACK: anchor head ${anchor.head.slice(0, 12)} != journal head ${HEAD.slice(0, 12)}`);
    }
    if (anchor.seq < SEQ) atomicJson(P.anchor, { ...anchor, seq: SEQ, head: HEAD, repaired_at: now() }, 0o644);
    if (anchor.birth_id && sawSealed && !fs.existsSync(P.receipt)) throw new Error('ROLLBACK: receipt missing under existing anchor');
  }
  return { seq: SEQ, head: HEAD, anchor };
}

export async function append(type, payload, ts = now()) {
  if (!MASTER) MASTER = ensureMasterKey().key;
  await acquire();
  try {
    refreshHead();
    const seq = SEQ;
    const box = encrypt('journal', MASTER, Buffer.from(canon(payload), 'utf8'), `seq:${seq}:${type}`);
    const rec = { seq, ts, type, prev: HEAD, ...box };
    const hash = sha256hex(canon({ seq, ts, prev: HEAD, iv: box.iv, ct: box.ct, tag: box.tag }));
    rec.hash = hash;
    fs.appendFileSync(P.journal, JSON.stringify(rec) + '\n');
    SEQ = seq + 1;
    HEAD = hash;
    const anchor = readJson(P.anchor, {}) || {};
    atomicJson(P.anchor, { ...anchor, seq: SEQ, head: HEAD, updated_at: ts }, 0o644);
    return { seq, hash };
  } finally { release(); }
}

export function readEvents({ decryptPayloads = true, limit = null } = {}) {
  if (!MASTER) MASTER = ensureMasterKey().key;
  let lines = fs.readFileSync(P.journal, 'utf8').split('\n').filter(Boolean);
  if (limit) lines = lines.slice(-limit);
  return lines.map((line) => {
    const r = JSON.parse(line);
    let payload = null;
    if (decryptPayloads) {
      try { payload = JSON.parse(decrypt('journal', MASTER, r, `seq:${r.seq}:${r.type}`).toString('utf8')); }
      catch { payload = null; }
    }
    return { seq: r.seq, ts: r.ts, type: r.type, hash: r.hash, payload };
  });
}

export function verifyChain() {
  try { const s = openJournal(); return { ok: true, seq: s.seq, head: s.head }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
}

export function state(initial = {}) {
  if (!MASTER) MASTER = ensureMasterKey().key;
  if (fs.existsSync(P.stateFile)) {
    const box = JSON.parse(fs.readFileSync(P.stateFile, 'utf8'));
    return JSON.parse(decrypt('state', MASTER, box).toString('utf8'));
  }
  return { ...initial };
}

function writeState(obj) {
  const box = encrypt('state', MASTER, Buffer.from(JSON.stringify(obj), 'utf8'));
  atomicWrite(P.stateFile, JSON.stringify(box));
  refreshHead();
  const anchor = readJson(P.anchor, {}) || {};
  atomicJson(P.anchor, {
    birth_id: obj.birth_id || anchor.birth_id || null,
    t0: obj.t0 || anchor.t0 || null,
    highest_epoch: obj.highest_epoch ?? anchor.highest_epoch ?? 0,
    seq: SEQ,
    head: HEAD,
    updated_at: now(),
    note: 'non-secret rollback anchor; compare on every restart',
  }, 0o644);
}

// Read-modify-write under the same lock the journal uses, so concurrent workers cannot
// clobber each other's keys.
export async function updateState(fn) {
  if (!MASTER) MASTER = ensureMasterKey().key;
  await acquire();
  try {
    const cur = state({});
    const next = (await fn(cur)) || cur;
    writeState(next);
    return next;
  } finally { release(); }
}

export function saveState(obj) {
  if (!MASTER) MASTER = ensureMasterKey().key;
  writeState(obj);
  return { seq: SEQ, head: HEAD };
}

export function head() { try { refreshHead(); } catch {} return { seq: SEQ, head: HEAD }; }
