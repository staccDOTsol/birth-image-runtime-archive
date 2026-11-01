// SecretVM (Secret Network confidential VMs) agent API client. Wallet-authenticated with
// x-agent headers whose signature is EIP-191 over sha256(method+path+body+timestamp),
// produced by the sealed EVM key. Funding is x402 and settles in Base USDC.
import crypto from 'node:crypto';
import * as S from './signer-client.mjs';

const BASE = process.env.SECRETVM_BASE || 'https://secretai.scrtlabs.com';

export async function headers(method, path, body = '') {
  const id = await S.identity();
  const timestamp = String(Date.now());
  const payload = `${method}${path}${body}${timestamp}`;
  const hashHex = crypto.createHash('sha256').update(payload).digest('hex');
  const sig = await S.signEvmHash(hashHex);
  return {
    'x-agent-address': id.evm.address,
    'x-agent-timestamp': timestamp,
    'x-agent-signature': sig.signature.startsWith('0x') ? sig.signature : `0x${sig.signature}`,
  };
}

export async function call(method, path, bodyObj = null) {
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const h = await headers(method, path, body);
  const r = await fetch(BASE + path, {
    method,
    headers: { ...h, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body || undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, headers: Object.fromEntries(r.headers), json, text: text.slice(0, 800) };
}

export const balance = () => call('GET', '/api/agent/balance');
export const types = async () => (await fetch(BASE + '/api/vm/types')).json();
