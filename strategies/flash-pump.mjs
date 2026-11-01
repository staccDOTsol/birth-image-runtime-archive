// A flashloan that actually does something inside it: borrow USDC -> SOL -> a real pump
// position -> repay the loan (plus fee) -> keep the tokens. All in one v1 transaction,
// so the loan is repaid from the same signature that acquired the asset.
import { Connection, PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PumpSdk, OnlinePumpSdk, bondingCurvePda } from '@pump-fun/pump-sdk';
import { getFlashloanIx } from '@jup-ag/lend/flashloan';
import * as swap from '../lib/swap.mjs';
import * as R from '../lib/rpc.mjs';
import * as S from '../lib/signer-client.mjs';
import BN from 'bn.js';
import { tokenProgramOf } from '../lib/token-program.mjs';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WSOL = 'So11111111111111111111111111111111111111112';

export async function buildFlashPump({ identity, mint: mintAddress, sizeUsdcRaw, slippageBps = 300 }) {
  const owner = new PublicKey(identity.solana.public_key);
  const mint = new PublicKey(mintAddress);
  const conn = new Connection(R.RPC_URL, 'confirmed');
  const online = new OnlinePumpSdk(conn);
  const sdk = new PumpSdk();
  const usdcAta = getAssociatedTokenAddressSync(new PublicKey(USDC), owner);

  const { borrowIx, paybackIx, feeAmount } = await getFlashloanIx({
    connection: conn, signer: owner, asset: new PublicKey(USDC), amount: new BN(String(sizeUsdcRaw)),
  });

  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    createAssociatedTokenAccountIdempotentInstruction(owner, usdcAta, owner, new PublicKey(USDC), TOKEN_PROGRAM_ID),
    borrowIx,
  ];

  // USDC -> SOL, so the pump buy can be paid for inside the same transaction
  const toSol = await swap.quote({ inputMint: USDC, outputMint: WSOL, amount: String(sizeUsdcRaw), slippageBps });
  const toSolSet = await swap.swapInstructions({ quoteResponse: toSol, userPublicKey: owner.toBase58(), wrapAndUnwrapSol: true });
  ixs.push(...swap.ixsOf(toSolSet).map((x) => x));

  // the leg that makes the loan worth taking: a real position on the curve
  const curve = await online.fetchBondingCurve(mint);
  const global = await online.fetchGlobal();
  const curvePda = bondingCurvePda(mint);
  const vTok = Number(curve.virtualTokenReserves ?? 0);
  const vSol = Number(curve.virtualQuoteReserves ?? 0);
  const solIn = Number(toSol.outAmount || 0);
  const expectedOut = vSol > 0 && vTok > 0 ? Math.floor((vTok * solIn) / (vSol + solIn)) : 0;
  ixs.push(...(await sdk.buyInstructions({
    global,
    bondingCurveAccountInfo: await conn.getAccountInfo(curvePda),
    bondingCurve: curve,
    associatedUserAccountInfo: null,
    mint, user: owner,
    amount: new BN(String(Math.floor(expectedOut * 0.95) || 1)),
    solAmount: new BN(String(solIn)),
    slippage: slippageBps,
    tokenProgram: await tokenProgramOf(conn, mintAddress),
  })));

  ixs.push(paybackIx);

  return {
    ixs,
    mint: mintAddress,
    size_usdc: Number(sizeUsdcRaw) / 1e6,
    fee_usdc: Number(feeAmount ?? 0n) / 1e6,
    sol_in: solIn / 1e9,
    expected_tokens: expectedOut,
    note: 'position held, loan repaid in the same transaction',
  };
}

export async function simulateFlashPump({ identity, plan }) {
  const mk = (ix) => ({ programId: ix.programId.toBase58(), keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: !!k.isSigner, isWritable: !!k.isWritable })), dataHex: Buffer.from(ix.data).toString('hex') });
  const { blockhash, lastValidBlockHeight } = await R.getLatestBlockhash();
  const allow = [...new Set(plan.ixs.flatMap((ix) => ix.keys.map((k) => k.pubkey.toBase58())))];
  const env = await S.signV1({ instructions: plan.ixs.map(mk), blockhash, lastValidBlockHeight, cuLimit: 1_400_000, allowedDestinations: allow, strategy: true });
  const sim = await R.simulate(env.wireBase64, allow);
  return { err: sim.value?.err || null, units: sim.value?.unitsConsumed, logs: (sim.value?.logs || []).slice(-4) };
}
