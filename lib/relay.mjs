// Gasless Base USDC -> Solana SOL via Relay (EIP-3009 ReceiveWithAuthorization).
// No Base ETH required: the TEE signer produces the authorization and Relay's relayer submits it.
import * as S from './signer-client.mjs';

export const RELAY_API = 'https://api.relay.link';
export const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const SOL_MINT = '11111111111111111111111111111111';

export async function quoteToSol({ amountRaw, identity }) {
  const body = {
    user: identity.evm.address,
    recipient: identity.solana.public_key,
    originChainId: 8453,
    destinationChainId: 792703809,
    originCurrency: BASE_USDC,
    destinationCurrency: SOL_MINT,
    amount: String(amountRaw),
    tradeType: 'EXACT_INPUT',
    usePermit: true,
  };
  const r = await fetch(`${RELAY_API}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const q = await r.json();
  if (!q.steps) throw new Error(`relay quote: ${r.status} ${JSON.stringify(q).slice(0, 160)}`);
  return q;
}

export async function bridgeBaseToSol(identity, amountRaw) {
  const q = await quoteToSol({ amountRaw, identity });
  const item = (q.steps[0].items || [])[0];
  const signReq = item?.data?.sign;
  if (!signReq) throw new Error('relay: no permit step');
  const types = { ...signReq.types };
  if (!types.EIP712Domain) {
    types.EIP712Domain = [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ];
  }
  const signed = await S.signEvmTyped({ domain: signReq.domain, types, primaryType: signReq.primaryType, message: signReq.value });
  const post = item.data.post;
  const url = `${RELAY_API}${post.endpoint}?signature=${encodeURIComponent(signed.signature)}`;
  const res = await fetch(url, { method: post.method || 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(post.body) });
  const text = await res.text();
  return { ok: res.status === 200, status: res.status, body: text.slice(0, 200), out: q.details?.currencyOut?.amount || null };
}
