// Dev buy after a create, in the shape the SDK actually wants: parsed curve, token program,
// slippage, non-zero amount, and the curve's own t22 account created first.
import { Connection, PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { PumpSdk, OnlinePumpSdk, bondingCurvePda } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import * as S from '../lib/signer-client.mjs';
import * as R from '../lib/rpc.mjs';

const T22 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

export async function devBuyCurve({ identity, mint, lamports }) {
  const user = new PublicKey(identity.solana.public_key);
  const conn = new Connection(R.RPC_URL, 'confirmed');
  const online = new OnlinePumpSdk(conn);
  const sdk = new PumpSdk();
  const curve = await online.fetchBondingCurve(mint);
  const curvePda = bondingCurvePda(mint);
  const curveAta = getAssociatedTokenAddressSync(mint, curvePda, true, T22);
  const userAta = getAssociatedTokenAddressSync(mint, user, false, T22);
  const global = await online.fetchGlobal();
  // tokens out for this much SOL, from the curve's own reserves (constant product)
  const vTok = Number(curve.virtualTokenReserves ?? 0);
  const vSol = Number(curve.virtualQuoteReserves ?? 0);
  const inSol = Number(lamports);
  const expectedOut = vSol > 0 && vTok > 0 ? Math.floor((vTok * inSol) / (vSol + inSol)) : 0;
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
    createAssociatedTokenAccountIdempotentInstruction(user, userAta, user, mint, T22),
    createAssociatedTokenAccountIdempotentInstruction(user, curveAta, curvePda, mint, T22),
    ...(await sdk.buyInstructions({
      global,
      bondingCurveAccountInfo: await conn.getAccountInfo(curvePda),
      bondingCurve: curve,
      associatedUserAccountInfo: null,
      mint, user,
      amount: new BN(String(Math.floor(expectedOut * 0.95))),
      solAmount: new BN(String(lamports)),
      slippage: 1500,
      tokenProgram: T22,
    })),
  ];
  const mk = (ix) => ({ programId: ix.programId.toBase58(), keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: !!k.isSigner, isWritable: !!k.isWritable })), dataHex: Buffer.from(ix.data).toString('hex') });
  const { blockhash, lastValidBlockHeight } = await R.getLatestBlockhash();
  const allow = [...new Set(ixs.flatMap((ix) => ix.keys.map((k) => k.pubkey.toBase58())))];
  const env = await S.signV1({ instructions: ixs.map(mk), blockhash, lastValidBlockHeight, cuLimit: 400000, allowedDestinations: allow, strategy: true });
  const sim = await R.simulate(env.wireBase64, allow);
  if (sim.value?.err) return { ok: false, err: sim.value.err };
  return { ok: true, sig: await R.sendRaw(env.wireBase64) };
}
