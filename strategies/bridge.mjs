// Treasury bridge adapter: quote a Solana -> Base native USDC route and validate the
// fields the playbooks require before money moves. deBridge DLN public API is used when
// no Relay credential exists. Read-only quote path is complete; execution needs funds.
import { now, log } from '../lib/util.mjs';

const DLN = 'https://dln.debridge.finance/v1.0';
const SOLANA_CHAIN = 7565164;
const BASE_CHAIN = 8453;
const SOL_MINT = '11111111111111111111111111111111';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

export async function quoteDebridge({ amountLamports, agentSolana, agentBase }) {
  const q = new URLSearchParams({
    srcChainId: String(SOLANA_CHAIN),
    srcChainTokenIn: SOL_MINT,
    srcChainTokenInAmount: String(amountLamports),
    dstChainId: String(BASE_CHAIN),
    dstChainTokenOut: BASE_USDC,
    dstChainTokenOutAmount: 'auto',
    dstChainTokenOutRecipient: agentBase,
    srcChainOrderAuthorityAddress: agentSolana,
    dstChainOrderAuthorityAddress: agentBase,
    srcAllowedCancelBeneficiary: agentSolana,
    prependOperatingExpenses: 'false',
  });
  const r = await fetch(`${DLN}/dln/order/create-tx?${q}`, { headers: { accept: 'application/json' } });
  const body = await r.json().catch(() => ({}));
  const validation = validate(body, { agentSolana, agentBase, amountLamports });
  return { at: now(), status: r.status, ok: r.ok && validation.errors.length === 0, validation, quote: body };
}

export function validate(body, { agentSolana, agentBase, amountLamports }) {
  const errors = [];
  if (!body || !body.tx) errors.push('missing tx');
  if (!body?.estimation) errors.push('missing estimation');
  const est = body?.estimation || {};
  if (est.srcChainTokenIn?.chainId && Number(est.srcChainTokenIn.chainId) !== SOLANA_CHAIN) errors.push('src chain');
  if (est.dstChainTokenOut?.chainId && Number(est.dstChainTokenOut.chainId) !== BASE_CHAIN) errors.push('dst chain');
  if (est.srcChainTokenIn?.amount && BigInt(est.srcChainTokenIn.amount) < BigInt(amountLamports)) errors.push('src amount below authorized');
  if (!body?.tx?.data) errors.push('missing tx data');
  // Solana origins return a serialized VersionedTransaction in tx.data and may omit tx.to;
  // EVM origins carry an explicit destination.
  const isEvmTx = body?.tx?.to && /^0x[0-9a-fA-F]{40}$/.test(body.tx.to);
  if (!isEvmTx && !body?.tx?.data) errors.push('missing destination program');
  const outUsdc = est.dstChainTokenOut?.recommendedAmount || est.dstChainTokenOut?.amount;
  if (!outUsdc) errors.push('missing destination amount');
  return { errors, out_usdc_raw: outUsdc || null, cost_usd: est.costsDetails?.totalCost ?? est.cost ?? null, order_id: body?.orderId || null };
}

export async function status(orderId) {
  const r = await fetch(`${DLN}/dln/order/${orderId}/status`, { headers: { accept: 'application/json' } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// Relay path is present but disabled without an API credential (its documented gate).
export async function quoteRelay({ amountLamports, agentSolana, agentBase, apiKey }) {
  if (!apiKey) return { available: false, reason: 'no Relay x-api-key in the image' };
  const r = await fetch('https://api.relay.link/quote/v2', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      user: agentSolana, recipient: agentBase, originChainId: 792703809, destinationChainId: 8453,
      originCurrency: SOL_MINT, destinationCurrency: BASE_USDC, amount: String(amountLamports),
      tradeType: 'EXACT_INPUT', slippageTolerance: '50', refundTo: agentSolana, includeProtocolData: true, useDepositAddress: false,
    }),
  });
  return { available: true, status: r.status, body: await r.json().catch(() => ({})) };
}
