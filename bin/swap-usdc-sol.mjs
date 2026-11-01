// Quoted USDC -> native SOL conversion, so a USDC-only parent can still endow children with rent.
// usage: node bin/swap-usdc-sol.mjs <usdc_raw>   e.g. 1000000 = 1.0 USDC
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import * as swap from '../lib/swap.mjs';
import * as S from '../lib/signer-client.mjs';
import * as R from '../lib/rpc.mjs';
import * as J from '../lib/journal.mjs';
import { now } from '../lib/util.mjs';

const WSOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const amount = Number(process.argv[2] || 1_000_000);

J.openJournal();
const id = await S.identity();
const owner = new PublicKey(id.solana.public_key);
const wsolAta = getAssociatedTokenAddressSync(new PublicKey(WSOL), owner).toBase58();
const usdcAta = getAssociatedTokenAddressSync(new PublicKey(USDC), owner).toBase58();

const q = await swap.quote({ inputMint: USDC, outputMint: WSOL, amount: String(amount), slippageBps: 80 });
const set = await swap.swapInstructions({ quoteResponse: q, userPublicKey: owner.toBase58(), wrapAndUnwrapSol: true });
const ixs = swap.ixsOf(set);
const { blockhash, lastValidBlockHeight } = await R.getLatestBlockhash();
const env = await S.signV1({ instructions: ixs, blockhash, lastValidBlockHeight, cuLimit: 1_400_000, allowedDestinations: [wsolAta, usdcAta], strategy: true });
const sim = await R.simulate(env.wireBase64, [wsolAta, usdcAta, owner.toBase58()]);
if (sim.value?.err) {
  console.log(JSON.stringify({ stage: 'simulate', err: sim.value.err, logs: (sim.value.logs || []).slice(-6) }));
  process.exit(1);
}
const sig = await R.sendRaw(env.wireBase64);
let status = null;
for (let i = 0; i < 40; i++) {
  const st = (await R.signatureStatuses([sig]))[0];
  if (st?.confirmationStatus) { status = st; break; }
  await new Promise((r) => setTimeout(r, 1200));
}
const rec = { at: now(), kind: 'usdc_to_sol', in_usdc_raw: amount, quoted_lamports: q.outAmount, signature: sig, status: status?.confirmationStatus || 'unknown', err: status?.err || null, sol_balance: await R.getBalance(owner.toBase58()) };
await J.append('treasury.swap', rec);
console.log(JSON.stringify(rec));
