// List x402compute instances for our wallet using the documented X402-COMPUTE-AUTH
// message (9 newline-joined lines, sha256 of the body, EIP-191 signature).
// The docs only say "signature over the request"; wallet_signing.py has the exact shape.
import crypto from 'node:crypto';
import * as S from '../lib/signer-client.mjs';

const BASE = 'https://compute.x402layer.cc';

export async function authHeaders(method, path, body = '') {
  const id = await S.identity();
  const addr = id.evm.address;
  const bodyHash = crypto.createHash('sha256').update(body || '').digest('hex');
  const ts = Date.now();
  const nonce = crypto.randomBytes(16).toString('hex');
  const msg = ['X402-COMPUTE-AUTH', 'v1', 'base', addr, method.toUpperCase(), path, bodyHash, String(ts), nonce].join('\n');
  const r = await S.signMessage(msg);
  const sig = r.evm?.signature || r.signature;
  return {
    'X-Auth-Address': addr,
    'X-Auth-Chain': 'base',
    'X-Auth-Signature': sig,
    'X-Auth-Nonce': nonce,
    'X-Auth-Timestamp': String(ts),
    'X-Auth-Sig-Encoding': 'hex',
  };
}

export async function listInstances() {
  const path = '/compute/instances';
  const r = await fetch(BASE + path, { headers: await authHeaders('GET', path) });
  const j = await r.json();
  return j.instances || j.data || [];
}

if ((process.argv[1] || '').includes('x402-instances')) {
  const list = await listInstances();
  console.log(JSON.stringify(list.map((i) => ({
    id: i.id, plan: i.vultr_plan, status: i.status, ip: i.ip_address,
    expires: i.expires_at, label: i.label,
  })), null, 2));
}
