// Fund a child from the parent's own wallet (inside-TEE signing). The parent keeps no
// key to the child; this is an endowment transfer, booked as capital out, not revenue.
// usage: node bin/fund-child.mjs <childSolanaAddress> <lamports>
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import * as S from '../lib/signer-client.mjs';
import * as R from '../lib/rpc.mjs';
import * as J from '../lib/journal.mjs';
import { now, log } from '../lib/util.mjs';

const to = process.argv[2];
const lamports = Number(process.argv[3] || 200_000_000);
if (!to) throw new Error('usage: fund-child.mjs <address> [lamports]');
const SYSTEM = '11111111111111111111111111111111';

try { J.openJournal(); } catch (e) { console.log(JSON.stringify({ warn: 'journal open failed, continuing', err: String(e.message||e).slice(0,60) })); }
const id = await S.identity();
const before = await R.getBalance(to).catch(() => 0);

const data = Buffer.alloc(12);
data.writeUInt32LE(2, 0);
data.writeBigUInt64LE(BigInt(lamports), 4);
const ix = {
  programId: SYSTEM,
  keys: [{ pubkey: id.solana.public_key, isSigner: true, isWritable: true }, { pubkey: to, isSigner: false, isWritable: true }],
  dataHex: data.toString('hex'),
};
const { blockhash, lastValidBlockHeight } = await R.getLatestBlockhash();
const env = await S.signV1({ instructions: [ix], blockhash, lastValidBlockHeight, cuLimit: 100000, allowedDestinations: [to] });
const sim = await R.simulate(env.wireBase64, [id.solana.public_key, to]);
if (sim.value?.err) { console.log(JSON.stringify({ stage: 'simulate', err: sim.value.err })); process.exit(1); }
const sig = await R.sendRaw(env.wireBase64);
let status = null;
for (let i = 0; i < 40; i++) {
  const st = (await R.signatureStatuses([sig]))[0];
  if (st?.confirmationStatus) { status = st; break; }
  await new Promise((r) => setTimeout(r, 1200));
}
const after = await R.getBalance(to).catch(() => 0);
const rec = { at: now(), kind: 'child_endowment', to, lamports, signature: sig, status: status?.confirmationStatus || 'unknown', balance_before: before, balance_after: after };
await J.append('procreation.endowment', rec);
console.log(JSON.stringify(rec));
