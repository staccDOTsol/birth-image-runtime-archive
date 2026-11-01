// Sealing: the guest's master secret lives outside the journal, in a 0600 file owned by
// the guest account. Journal and state are encrypted with HKDF-separated AES-256-GCM keys.
// The master is never written to the journal, the receipt, a prompt or a tool result.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { P } from './paths.mjs';
import { b64, unb64, sha256hex } from './util.mjs';

function derive(master, label, len = 32) {
  return Buffer.from(crypto.hkdfSync('sha256', master, Buffer.from('birth-image-seal-v1'), Buffer.from(label), len));
}

export function ensureMasterKey() {
  fs.mkdirSync(path.dirname(P.sealKey), { recursive: true });
  if (!fs.existsSync(P.sealKey)) {
    const k = crypto.randomBytes(32);
    fs.writeFileSync(P.sealKey, k, { mode: 0o600 });
    return { key: k, created: true };
  }
  const k = fs.readFileSync(P.sealKey);
  if (k.length !== 32) throw new Error('seal.key corrupt');
  return { key: k, created: false };
}

export function sealKeys(label, master) {
  const key = derive(master, `keys:${label}`);
  return key;
}

export function encrypt(label, master, plaintextBuf, aad = '') {
  const key = derive(master, label);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintextBuf), c.final()]);
  return { iv: b64(iv), ct: b64(ct), tag: b64(c.getAuthTag()) };
}

export function decrypt(label, master, box, aad = '') {
  const key = derive(master, label);
  const d = crypto.createDecipheriv('aes-256-gcm', key, unb64(box.iv));
  if (aad) d.setAAD(Buffer.from(aad));
  d.setAuthTag(unb64(box.tag));
  return Buffer.concat([d.update(unb64(box.ct)), d.final()]);
}

export function fingerprint(b) { return sha256hex(b).slice(0, 16); }
