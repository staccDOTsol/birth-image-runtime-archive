// SOL -> native Base USDC through deBridge DLN, signed inside the TEE. This is the route that
// actually settles (the Relay Solana deposit rejects with program error 100), so procreation pays
// for its Base lease out of its own SOL rather than leaning on the parent.
import { VersionedTransaction } from '@solana/web3.js';
import * as S from './signer-client.mjs';
import * as R from './rpc.mjs';
import { quoteDebridge } from '../strategies/bridge.mjs';

export async function bridgeSolToBaseUsdc(identity, lamports) {
  const q = await quoteDebridge({ amountLamports: lamports, agentSolana: identity.solana.public_key, agentBase: identity.evm.address });
  if (!q.ok) return { ok: false, stage: 'quote', errors: q.validation?.errors || null };
  const wire = q.quote?.tx?.data;
  if (!wire) return { ok: false, stage: 'no_tx_payload' };
  let payload = wire;
  try {
    const vtx = VersionedTransaction.deserialize(Buffer.from(String(wire).replace(/^0x/, ''), 'hex'));
    const bh = await R.getLatestBlockhash();
    vtx.message.recentBlockhash = bh.blockhash;
    payload = Buffer.from(vtx.serialize()).toString('base64');
  } catch { /* send as-is */ }
  const signed = await S.signTx(payload);
  const sig = await R.sendRaw(signed.wireBase64);
  let st = null;
  for (let i = 0; i < 40; i++) {
    const r = (await R.signatureStatuses([sig]))[0];
    if (r?.confirmationStatus) { st = r; break; }
    await new Promise((x) => setTimeout(x, 1500));
  }
  return { ok: !st?.err, signature: sig, orderId: q.quote.orderId, outUsdcRaw: q.quote.estimation?.dstChainTokenOut?.amount || null, status: st?.confirmationStatus || 'unknown' };
}
