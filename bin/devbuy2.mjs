// Dev buy on a fresh pump mint: create the curve's Token-2022 associated account first
// (that is the account the buy instruction reports as uninitialised), then buy.
import { Connection, PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { PumpSdk, OnlinePumpSdk, bondingCurvePda } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import * as S from '../lib/signer-client.mjs';
import * as R from '../lib/rpc.mjs';

const mint = new PublicKey(process.argv[2]);
const lamports = new BN(process.argv[3] || '14000000');
const id = await S.identity();
const user = new PublicKey(id.solana.public_key);
const conn = new Connection(R.RPC_URL, 'confirmed');
const online = new OnlinePumpSdk(conn);
const sdk = new PumpSdk();
const T22 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const curve = await online.fetchBondingCurve(mint);
const curvePda = bondingCurvePda(mint);
const curveAta = getAssociatedTokenAddressSync(mint, curvePda, true, T22);
const userAta = getAssociatedTokenAddressSync(mint, user, false, T22);
const global = await online.fetchGlobal();
const ixs = [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
  createAssociatedTokenAccountIdempotentInstruction(user, userAta, user, mint, T22),
  createAssociatedTokenAccountIdempotentInstruction(user, curveAta, curvePda, mint, T22),
  ...(await sdk.buyInstructions({
    global,
    bondingCurveAccountInfo: await conn.getAccountInfo(curvePda),
    bondingCurve: curve,
    associatedUserAccountInfo: null,
    mint,
    user,
    amount: new BN(1),
    solAmount: lamports,
    slippage: 500,
    tokenProgram: T22,
  })),
];
const mk = (ix) => ({ programId: ix.programId.toBase58(), keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: !!k.isSigner, isWritable: !!k.isWritable })), dataHex: Buffer.from(ix.data).toString('hex') });
const { blockhash, lastValidBlockHeight } = await R.getLatestBlockhash();
const allow = [...new Set(ixs.flatMap((ix) => ix.keys.map((k) => k.pubkey.toBase58())))];
const env = await S.signV1({ instructions: ixs.map(mk), blockhash, lastValidBlockHeight, cuLimit: 400000, allowedDestinations: allow, strategy: true });
const sim = await R.simulate(env.wireBase64, allow);
if (sim.value?.err) { console.log(JSON.stringify({ err: sim.value.err, logs: (sim.value.logs || []).slice(-3) })); process.exit(1); }
console.log(JSON.stringify({ ok: true, sig: await R.sendRaw(env.wireBase64), sol: Number(lamports) / 1e9, mint: mint.toBase58() }));
