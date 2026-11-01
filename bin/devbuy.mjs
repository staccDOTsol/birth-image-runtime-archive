// Dev buy on an existing pump mint, using the pump SDK's own buy instructions and creating the
// Token-2022 associated account first (Jupiter's route skips it, which is why buys failed).
import { Connection, PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { PumpSdk, OnlinePumpSdk } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import * as S from '../lib/signer-client.mjs';
import * as R from '../lib/rpc.mjs';

const mintArg = process.argv[2];
const lamports = Number(process.argv[3] || 400000);
const id = await S.identity();
const user = new PublicKey(id.solana.public_key);
const mint = new PublicKey(mintArg);
const conn = new Connection(R.RPC_URL, 'confirmed');
const online = new OnlinePumpSdk(conn);
const sdk = new PumpSdk();
const global = await online.fetchGlobal();
const curve = await online.fetchBondingCurve(mint);
const T22 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ata = getAssociatedTokenAddressSync(mint, user, false, T22);
const ixs = [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
  createAssociatedTokenAccountIdempotentInstruction(user, ata, user, mint, T22),
  ...(await sdk.buyInstructions({
    global,
    bondingCurveAccountInfo: { ...curve, creator: curve.creator },
    bondingCurve: curve,
    associatedUserAccountInfo: await conn.getAccountInfo(ata),
    mint,
    creator: curve.creator,
    user,
    amount: new BN(0),
    solAmount: new BN(String(lamports)),
  })),
];
const { blockhash, lastValidBlockHeight } = await R.getLatestBlockhash();
const env = await S.signV1({
  instructions: ixs.map((ix) => ({ programId: ix.programId.toBase58(), keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: !!k.isSigner, isWritable: !!k.isWritable })), dataHex: Buffer.from(ix.data).toString('hex') })),
  blockhash, lastValidBlockHeight, cuLimit: 400000, allowedDestinations: [...new Set(ixs.flatMap((ix) => ix.keys.map((k) => k.pubkey.toBase58())))], strategy: true,
});
const sim = await R.simulate(env.wireBase64, [...new Set(ixs.flatMap((ix) => ix.keys.map((k) => k.pubkey.toBase58())))]);
if (sim.value?.err) { console.log(JSON.stringify({ err: sim.value.err, logs: (sim.value.logs || []).slice(-3) })); process.exit(1); }
const sig = await R.sendRaw(env.wireBase64);
console.log(JSON.stringify({ ok: true, sig, mint: mintArg, sol: lamports / 1e9 }));
