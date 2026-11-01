// Sell a pump position back into its curve. Same rules as the buy: parsed curve, t22 program,
// non-zero amount, slippage stated. Prints realised SOL so the round trip is measurable.
import { Connection, PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { PumpSdk, OnlinePumpSdk, bondingCurvePda } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import * as S from '../lib/signer-client.mjs';
import * as R from '../lib/rpc.mjs';

const mint = new PublicKey(process.argv[2]);
const slippage = Number(process.argv[3] || 1500);
const id = await S.identity();
const user = new PublicKey(id.solana.public_key);
const T22 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const conn = new Connection(R.RPC_URL, 'confirmed');
const online = new OnlinePumpSdk(conn);
const sdk = new PumpSdk();
const ata = getAssociatedTokenAddressSync(mint, user, false, T22);
const acc = await conn.getParsedAccountInfo(ata);
const amountRaw = acc?.value?.data?.parsed?.info?.tokenAmount?.amount;
if (!amountRaw || amountRaw === '0') { console.log(JSON.stringify({ err: 'no position in this wallet' })); process.exit(0); }
const curve = await online.fetchBondingCurve(mint);
const curvePda = bondingCurvePda(mint);
const global = await online.fetchGlobal();
const before = BigInt(await R.getBalance(id.solana.public_key) || 0);
const ixs = [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
  createAssociatedTokenAccountIdempotentInstruction(user, ata, user, mint, T22),
  ...(await sdk.sellInstructions({
    global,
    bondingCurveAccountInfo: await conn.getAccountInfo(curvePda),
    bondingCurve: curve,
    mint, user,
    amount: new BN(String(amountRaw)),
    solAmount: new BN(0),
    slippage,
    tokenProgram: T22,
  })),
];
const mk = (ix) => ({ programId: ix.programId.toBase58(), keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: !!k.isSigner, isWritable: !!k.isWritable })), dataHex: Buffer.from(ix.data).toString('hex') });
const { blockhash, lastValidBlockHeight } = await R.getLatestBlockhash();
const allow = [...new Set(ixs.flatMap((ix) => ix.keys.map((k) => k.pubkey.toBase58())))];
const env = await S.signV1({ instructions: ixs.map(mk), blockhash, lastValidBlockHeight, cuLimit: 400000, allowedDestinations: allow, strategy: true });
const sim = await R.simulate(env.wireBase64, allow);
if (sim.value?.err) { console.log(JSON.stringify({ stage: 'exit', err: sim.value.err, logs: (sim.value.logs || []).slice(-2) })); process.exit(0); }
const sig = await R.sendRaw(env.wireBase64);
const after = BigInt(await R.getBalance(id.solana.public_key) || 0);
console.log(JSON.stringify({ stage: 'exit', ok: true, sig, tokens_sold: String(amountRaw), sol_back: Number(after - before) / 1e9, mint: mint.toBase58() }));
