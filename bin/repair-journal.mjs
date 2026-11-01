// Journal repair: keep the longest hash-valid prefix, record exactly what was dropped,
// and re-anchor. Used when a pre-lock write produced a duplicate sequence number.
import fs from 'node:fs';
import { P } from '../lib/paths.mjs';
import { canon, sha256hex, atomicJson, now } from '../lib/util.mjs';

const lines = fs.readFileSync(P.journal, 'utf8').split('\n').filter(Boolean);
let prev = '0'.repeat(64);
const keep = [];
const dropped = [];
for (const line of lines) {
  const r = JSON.parse(line);
  const h = sha256hex(canon({ seq: r.seq, ts: r.ts, prev: r.prev, iv: r.iv, ct: r.ct, tag: r.tag }));
  const ok = r.prev === prev && h === r.hash && r.seq === keep.length;
  if (ok) { keep.push(line); prev = r.hash; }
  else dropped.push({ seq: r.seq, type: r.type, ts: r.ts, hash: r.hash, reason: r.prev !== prev ? 'prev_mismatch' : 'seq_or_hash' });
}
fs.writeFileSync(P.journal, keep.join('\n') + (keep.length ? '\n' : ''));
const last = keep.length ? JSON.parse(keep[keep.length - 1]) : null;
if (last) {
  atomicJson(P.anchor, {
    ...JSON.parse(fs.readFileSync(P.anchor, 'utf8')),
    seq: keep.length,
    head: last.hash,
    repaired_at: now(),
  }, 0o644);
}
atomicJson(`${P.state}/journal-repair-${now()}.json`, { at: now(), kept: keep.length, dropped }, 0o644);
console.log(JSON.stringify({ kept: keep.length, dropped }, null, 2));
