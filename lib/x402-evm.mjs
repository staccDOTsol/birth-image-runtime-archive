// x402 "exact" payer for EVM rails (EIP-3009 transferWithAuthorization).
// Signs the transfer with the agent's sealed EVM key; the key never leaves the signer.
import crypto from 'node:crypto';
import * as S from './signer-client.mjs';

const TYPES = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ],
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

export function pickAccept(accepts, { network = 'eip155:8453' } = {}) {
  return (accepts || []).find((a) => a.scheme === 'exact' && String(a.network) === network)
    || (accepts || []).find((a) => a.scheme === 'exact' && String(a.asset || '').toLowerCase() === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
}

// Returns the base64 X-PAYMENT header value for one exact-scheme requirement.
export async function authorize(accept, { value, validForSeconds = 240, resource = null, version = 2 } = {}) {
  const id = await S.identity();
  const chainId = String(accept.network).startsWith('eip155:') ? Number(String(accept.network).split(':')[1]) : 8453;
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: id.evm.address,
    to: accept.payTo,
    value: String(value ?? accept.amount ?? accept.maxAmountRequired),
    validAfter: String(now - 60),
    validBefore: String(now + validForSeconds),
    nonce: '0x' + crypto.randomBytes(32).toString('hex'),
  };
  const domain = {
    name: accept.extra?.name || 'USD Coin',
    version: accept.extra?.version || '2',
    chainId,
    verifyingContract: accept.asset,
  };
  const signed = await S.signEvmTyped({ domain, types: TYPES, primaryType: 'TransferWithAuthorization', message: authorization });
  // v2 carries resource + the verbatim accepted row; v1 is the bare envelope.
  const payload = version === 1
    ? { x402Version: 1, scheme: 'exact', network: accept.network, payload: { signature: signed.signature, authorization } }
    : { x402Version: 2, resource: resource || undefined, accepted: accept, payload: { signature: signed.signature, authorization } };
  return { header: Buffer.from(JSON.stringify(payload)).toString('base64'), authorization, signature: signed.signature, domain, digest: signed.digest };
}

export function decodeRequirements(headerValue) {
  try { return JSON.parse(Buffer.from(headerValue, 'base64').toString('utf8')); } catch { return null; }
}
