import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import * as S from '../lib/signer-client.mjs';
import * as R from '../lib/rpc.mjs';
import * as swap from '../lib/swap.mjs';
const id = await S.identity();
const user = new PublicKey(id.solana.public_key);
const mint = new PublicKey(process.argv[2]);
const lamports = process.argv[3] || '400000';
const T22 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ata = getAssociatedTokenAddressSync(mint, user, false, T22);
const mk = (ix) => ({ programId: ix.programId.toBase58(), keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: !!k.isSigner, isWritable: !!k.isWritable })), dataHex: Buffer.from(ix.data).toString('hex') });
try {
  const ixs = [createAssociatedTokenAccountIdempotentInstruction(user, ata, user, mint, T22)];
  const b = await R.getLatestBlockhash();
  const env = await S.signV1({ instructions: ixs.map(mk), blockhash: b.blockhash, lastValidBlockHeight: b.lastValidBlockHeight, cuLimit: 100000, allowedDestinations: [ata.toBase58()], strategy: true });
  console.log(JSON.stringify({ stage: 'ata', sig: await R.sendRaw(env.wireBase64) }));
  const q = await swap.quote({ inputMint: 'So11111111111111111111111111111111111111112', outputMint: mint.toBase58(), amount: lamports, slippageBps: 800 });
  const set = await swap.swapInstructions({ quoteResponse: q, userPublicKey: user.toBase58() });
  const six = swap.ixsOf(set);
  const b2 = await R.getLatestBlockhash();
  const env2 = await S.signV1({ instructions: six, blockhash: b2.blockhash, lastValidBlockHeight: b2.lastValidBlockHeight, cuLimit: 400000, allowedDestinations: swap.uniqueAccounts(six), strategy: true });
  console.log(JSON.stringify({ stage: 'buy', sig: await R.sendRaw(env2.wireBase64), out: String(q.outAmount) }));
} catch (e) { console.log(JSON.stringify({ stage: 'error', err: String(e.message || e).slice(0, 200) })); }
