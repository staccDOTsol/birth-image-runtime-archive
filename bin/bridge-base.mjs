// Bridge Solana SOL to Base native USDC through deBridge DLN, signed inside the TEE.
// Builds the provider transaction, signs it with the sealed Solana key, broadcasts,
// and reports the DLN order id so arrival can be tracked. Read-only until the send.
// usage: node bin/bridge-base.mjs [lamports]
import * as S from '../lib/signer-client.mjs';
import * as R from '../lib/rpc.mjs';
import * as J from '../lib/journal.mjs';
import { quoteDebridge, status as dlnStatus } from '../strategies/bridge.mjs';
import { now } from '../lib/util.mjs';

const lamports = Number(process.argv[2] || 50_000_000);
J.openJournal();
const id = await S.identity();

const q = await quoteDebridge({ amountLamports: lamports, agentSolana: id.solana.public_key, agentBase: id.evm.address });
if (!q.ok) { console.log(JSON.stringify({ stage: 'quote', ok: false, errors: q.validation?.errors, body: q.quote })); process.exit(1); }
const txObj = q.quote.tx;
const out = q.quote.estimation?.dstChainTokenOut;
console.log(JSON.stringify({ stage: 'quoted', orderId: q.quote.orderId, to_base_usdc: out?.amount, recipient: id.evm.address }));

const wire = txObj?.data;
if (!wire) { console.log(JSON.stringify({ stage: 'no_tx_payload', tx: txObj })); process.exit(1); }
// deBridge builds with its own blockhash; refresh it so submission is not stale.
const { VersionedTransaction } = await import('@solana/web3.js');
let refresh = wire;
try {
  const vtx = VersionedTransaction.deserialize(Buffer.from(String(wire).replace(/^0x/, ''), 'hex'));
  const bh = await R.getLatestBlockhash();
  vtx.message.recentBlockhash = bh.blockhash;
  refresh = Buffer.from(vtx.serialize()).toString('base64');
} catch (e) { console.log(JSON.stringify({ stage: 'blockhash_refresh_failed', err: String(e.message || e).slice(0, 120) })); }
const signed = await S.signTx(refresh);
const sig = await R.sendRaw(signed.wireBase64);
console.log(JSON.stringify({ stage: 'broadcast', signature: sig }));
let st = null;
for (let i = 0; i < 40; i++) { const r = (await R.signatureStatuses([sig]))[0]; if (r?.confirmationStatus) { st = r; break; } await new Promise((x) => setTimeout(x, 1500)); }
const rec = { at: now(), kind: 'sol_to_base_usdc', in_lamports: lamports, order_id: q.quote.orderId, out_usdc_raw: out?.amount || null, signature: sig, status: st?.confirmationStatus || 'unknown', err: st?.err || null };
await J.append('treasury.bridge_base', rec);
console.log(JSON.stringify({ stage: 'sent', ...rec }));

// Report the DLN order state once, so the record shows the route accepted it.
try { const s = await dlnStatus(q.quote.orderId); console.log(JSON.stringify({ stage: 'dln_status', body: s })); } catch (e) { console.log(JSON.stringify({ stage: 'dln_status_error', err: String(e.message || e) })); }
