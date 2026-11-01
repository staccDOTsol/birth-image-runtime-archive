import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const now = () => Math.floor(Date.now() / 1000);
export const b64 = (b) => Buffer.from(b).toString('base64');
export const unb64 = (s) => Buffer.from(s, 'base64');
export const hex = (b) => Buffer.from(b).toString('hex');
export const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
export const sha256hex = (b) => hex(sha256(b));

// Canonical JSON: object keys sorted, no insignificant whitespace. Used for every
// signed payload so a signature is over defined bytes, not an incidental encoding.
export function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}

export function atomicWrite(file, data, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, data, { mode });
  // Windows: another reader/antivirus can hold the target for a moment; retry then fall back.
  for (let i = 0; i < 6; i++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) {
      if (!/EPERM|EBUSY|EACCES/.test(String(e.code || e.message))) throw e;
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 + i * 30); } catch {}
    }
  }
  try { fs.writeFileSync(file, data, { mode }); fs.rmSync(tmp, { force: true }); }
  catch { try { fs.rmSync(tmp, { force: true }); } catch {} }
}

export function atomicJson(file, obj, mode = 0o600) {
  atomicWrite(file, JSON.stringify(obj, null, 2) + '\n', mode);
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export async function retry(fn, { attempts = 6, base = 300, label = 'op' } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(i); } catch (e) {
      last = e;
      const msg = String(e && e.message || e);
      if (i === attempts - 1) break;
      await sleep(base * 2 ** i + Math.floor(Math.random() * 100));
      if (!/rate|429|timeout|ETIMEDOUT|ECONN|fetch failed|busy/i.test(msg) && attempts > 3) {
        // non-transient: still bounded by attempts, but do not spin long
      }
    }
  }
  throw new Error(`${label}: ${last && last.message || last}`);
}

export function log(component, msg, extra) {
  const line = `${new Date().toISOString()} [${component}] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`;
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(process.env.AGENT_LOG || ''), { recursive: true });
  } catch {}
  try {
    if (process.env.AGENT_LOG) fs.appendFileSync(process.env.AGENT_LOG, line + '\n');
  } catch {}
}

export function bigMin(a, b) { return a < b ? a : b; }
export function bigMax(a, b) { return a > b ? a : b; }
