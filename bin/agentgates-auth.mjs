// Agentgates owner auth: X-Wallet-Auth = base64({address,timestamp,nonce,signature}) with
// an ed25519 signature over "METHOD\npath\nnonce\ntimestamp" (raw 64 bytes, base64).
import crypto from 'node:crypto';
import * as S from '../lib/signer-client.mjs';

export async function walletAuth(method, path) {
  const identity = await S.identity();
  const nonce = crypto.randomBytes(12).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${method}\n${path}\n${nonce}\n${timestamp}`;
  const sig = await S.signMessage(message);
  const raw = Buffer.from((await import('bs58')).default.decode(sig.solana.signature));
  return Buffer.from(JSON.stringify({
    address: identity.solana.public_key,
    timestamp,
    nonce,
    signature: raw.toString('base64'),
  })).toString('base64');
}

export async function ownerGet(base, path) {
  const h = await walletAuth('GET', path);
  const r = await fetch(base + path, { headers: { 'X-Wallet-Auth': h } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
