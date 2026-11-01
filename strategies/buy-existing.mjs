// Buy an EXISTING pump coin (a sibling's launch) and hold a real position.
// Same rules as the launch dev buy: parsed curve, t22 program, amount = tokens the curve owes.
import { Connection, PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { PumpSdk, OnlinePumpSdk, bondingCurvePda } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import * as S from '../lib/signer-client.mjs';
import * as R from '../lib/rpc.mjs';

import { tokenProgramOf } from '../lib/token-program.mjs';

export async function buyExisting({ identity, mint: mintAddress, solLamports, slippageBps = 1500 }) {
  const mint = new PublicKey(mintAddress);
  const user = new PublicKey(identity.solana.public_key);
  const conn = new Connection(R.RPC_URL, 'confirmed');
  const T22 = await tokenProgramOf(conn, mintAddress);
  const online = new OnlinePumpSdk(conn);
  const sdk = new PumpSdk();
  const curve = await online.fetchBondingCurve(mint);
  const curvePda = bondingCurvePda(mint);
  const global = await online.fetchGlobal();
  const vTok = Number(curve.virtualTokenReserves ?? 0);
  const vSol = Number(curve.virtualQuoteReserves ?? 0);
  const inSol = Number(solLamports);
  if (!(vTok > 0) || !(vSol > 0)) return { ok: false, err: 'curve empty or graduated' };
  const expectedOut = Math.floor((vTok * inSol) / (vSol + inSol));
  if (expectedOut <= 0) return { ok: false, err: 'amount too small' };
  const ata = getAssociatedTokenAddressSync(mint, user, false, T22);
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
    createAssociatedTokenAccountIdempotentInstruction(user, ata, user, mint, T22),
    ...(await sdk.buyInstructions({
      global,
      bondingCurveAccountInfo: await conn.getAccountInfo(curvePda),
      bondingCurve: curve,
      associatedUserAccountInfo: null,
      mint,
      user,
      amount: new BN(String(Math.floor(expectedOut * 0.95))),
      solAmount: new BN(String(solLamports)),
      slippage: slippageBps,
      tokenProgram: T22,
    })),
  ];
  const mk = (ix) => ({ programId: ix.programId.toBase58(), keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: !!k.isSigner, isWritable: !!k.isWritable })), dataHex: Buffer.from(ix.data).toString('hex') });
  const { blockhash, lastValidBlockHeight } = await R.getLatestBlockhash();
  const allow = [...new Set(ixs.flatMap((ix) => ix.keys.map((k) => k.pubkey.toBase58())))];
  const env = await S.signV1({ instructions: ixs.map(mk), blockhash, lastValidBlockHeight, cuLimit: 300000, allowedDestinations: allow, strategy: true });
  const sim = await R.simulate(env.wireBase64, allow);
  if (sim.value?.err) return { ok: false, stage: 'buy', err: sim.value.err, logs: (sim.value.logs || []).slice(-2) };
  const sig = await R.sendRaw(env.wireBase64);
  return { ok: true, sig, mint: mintAddress, sol_in: solLamports / 1e9, tokens_expected: expectedOut };
}
