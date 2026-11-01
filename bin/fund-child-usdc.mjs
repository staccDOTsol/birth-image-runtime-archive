// Send USDC from the parent wallet to a child (inside-TEE signing). A child whose
// wallet holds >= the provider minimum tops up its own inference credit on its next tick.
// usage: node bin/fund-child-usdc.mjs <childSolanaAddress> <usdcBaseUnits>
import { PublicKey } from '@solana/web3.js';
import { createTransferCheckedInstruction, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as S from '../lib/signer-client.mjs';
import * as R from '../lib/rpc.mjs';
import * as J from '../lib/journal.mjs';
import { now } from '../lib/util.mjs';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const to = process.argv[2];
const amount = BigInt(process.argv[3] || 5_400_000);
if (!to) throw new Error('usage: fund-child-usdc.mjs <address> [baseUnits]');

J.openJournal();
const id = await S.identity();
const mint = new PublicKey(USDC);
const from = getAssociatedTokenAddressSync(mint, new PublicKey(id.solana.public_key));
const dst = getAssociatedTokenAddressSync(mint, new PublicKey(to));
const ixs = [];
if (!(await R.getAccountInfo(dst.toBase58()))) {
  ixs.push(createAssociatedTokenAccountIdempotentInstruction(new PublicKey(id.solana.public_key), dst, new PublicKey(to), mint, TOKEN_PROGRAM_ID));
}
ixs.push(createTransferCheckedInstruction(from, mint, dst, new PublicKey(id.solana.public_key), amount, 6, [], TOKEN_PROGRAM_ID));
const { blockhash, lastValidBlockHeight } = await R.getLatestBlockhash();
const env = await S.signV1({
  instructions: ixs.map((ix) => ({ programId: ix.programId.toBase58(), keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: !!k.isSigner, isWritable: !!k.isWritable })), dataHex: Buffer.from(ix.data).toString('hex') })),
  blockhash, lastValidBlockHeight, cuLimit: 200000, allowedDestinations: [dst.toBase58()],
});
const sim = await R.simulate(env.wireBase64, [from.toBase58(), dst.toBase58()]);
if (sim.value?.err) { console.log(JSON.stringify({ stage: 'simulate', err: sim.value.err, logs: (sim.value.logs || []).slice(-6) })); process.exit(1); }
const sig = await R.sendRaw(env.wireBase64);
let status = null;
for (let i = 0; i < 40; i++) { const st = (await R.signatureStatuses([sig]))[0]; if (st?.confirmationStatus) { status = st; break; } await new Promise((r) => setTimeout(r, 1200)); }
const rec = { at: now(), kind: 'child_usdc_endowment', to, amount_raw: amount.toString(), signature: sig, status: status?.confirmationStatus || 'unknown', err: status?.err || null };
await J.append('procreation.endowment_usdc', rec);
console.log(JSON.stringify(rec));
