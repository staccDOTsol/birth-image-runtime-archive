// Instruction-level Legos: a playbook can hand back its INSTRUCTIONS, so another playbook can
// splice them inside its own transaction. This is what makes a flashloan useful — the borrow and
// repay wrap a real action (a swap, a pump buy) in one atomic v1 transaction.
import { Connection, PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PumpSdk, OnlinePumpSdk, bondingCurvePda } from '@pump-fun/pump-sdk';
import { getFlashloanIx } from '@jup-ag/lend/flashloan';
import BN from 'bn.js';
import * as swap from './swap.mjs';
import * as R from './rpc.mjs';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WSOL = 'So11111111111111111111111111111111111111112';

export async function fragAta({ owner, mint }) {
  const o = new PublicKey(owner);
  const m = new PublicKey(mint);
  const ata = getAssociatedTokenAddressSync(m, o);
  return { ixs: [createAssociatedTokenAccountIdempotentInstruction(o, ata, o, m, TOKEN_PROGRAM_ID)], gives: { ata: ata.toBase58() } };
}

// borrow: returns the borrow ixs AND the repay ixs, to be spliced around whatever you insert.
export async function fragFlashBorrow({ owner, asset = USDC, amountRaw }) {
  const o = new PublicKey(owner);
  const conn = new Connection(R.RPC_URL, 'confirmed');
  const { borrowIx, paybackIx, feeAmount } = await getFlashloanIx({ connection: conn, signer: o, asset: new PublicKey(asset), amount: new BN(String(amountRaw)) });
  return { ixs: [borrowIx], repay: [paybackIx], fee_raw: String(feeAmount ?? 0n), gives: { usdc: Number(amountRaw) / 1e6 } };
}

export async function fragSwap({ owner, inputMint, outputMint, amountRaw, slippageBps = 300 }) {
  const o = new PublicKey(owner);
  const q = await swap.quote({ inputMint, outputMint, amount: String(amountRaw), slippageBps });
  const set = await swap.swapInstructions({ quoteResponse: q, userPublicKey: o.toBase58(), wrapAndUnwrapSol: true });
  return { ixs: swap.ixsOf(set), quote: { in: String(amountRaw), out: String(q.outAmount), min: String(q.otherAmountThreshold) } };
}

export async function fragPumpBuy({ owner, mint, solLamports, slippage = 300 }) {
  const o = new PublicKey(owner);
  const m = new PublicKey(mint);
  const conn = new Connection(R.RPC_URL, 'confirmed');
  const online = new OnlinePumpSdk(conn);
  const sdk = new PumpSdk();
  const curve = await online.fetchBondingCurve(m);
  const global = await online.fetchGlobal();
  const curvePda = bondingCurvePda(m);
  const vTok = Number(curve.virtualTokenReserves ?? 0);
  const vSol = Number(curve.virtualQuoteReserves ?? 0);
  const solIn = Number(solLamports);
  const expected = vSol > 0 && vTok > 0 ? Math.floor((vTok * solIn) / (vSol + solIn)) : 0;
  const ownerProgram = (await conn.getAccountInfo(m))?.owner;
  const ixs = await sdk.buyInstructions({
    global,
    bondingCurveAccountInfo: await conn.getAccountInfo(curvePda),
    bondingCurve: curve,
    associatedUserAccountInfo: null,
    mint: m,
    user: o,
    amount: new BN(String(Math.floor(expected * 0.95) || 1)),
    solAmount: new BN(String(solIn)),
    slippage,
    tokenProgram: ownerProgram ? new PublicKey(ownerProgram) : new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),
  });
  return { ixs, gives: { position: 1 }, expected_tokens: expected };
}

// Normalise whatever shape a fragment hands back (web3 Instruction, Jupiter's {programId,accounts,data},
// pump's object) into a real TransactionInstruction.
function norm(x) {
  const pk = (v) => (typeof v === 'string' ? new PublicKey(v) : v);
  // never early-return: Jupiter hands back string pubkeys, which compileToV0Message rejects
  const programId = pk(x.programId || x.program_id);
  const keys = (x.keys || x.accounts || []).map((k) => ({
    pubkey: pk(k.pubkey || k.pubKey || k.publicKey),
    isSigner: !!(k.isSigner || k.is_signer || k.signer),
    isWritable: !!(k.isWritable || k.is_writable || k.writable),
  }));
  const data = x.dataHex ? Buffer.from(x.dataHex, 'hex') : (x.data ? (Buffer.isBuffer(x.data) ? x.data : Buffer.from(x.data, x.dataEncoding === 'base64' ? 'base64' : undefined)) : Buffer.alloc(0));
  return { programId, keys, data };
}

// splice: build one transaction out of legos, in the order given; a fragment that returns `repay`
// has those instructions appended at the end (that is the flashloan sandwich).
export async function buildFromLegos(owner, specs) {
  const parts = [];
  const reps = [];
  for (const s of specs) {
    const [kind, ...rest] = String(s).split(':');
    if (kind === 'flashBorrow') {
      const [asset, amountRaw] = rest;
      const f = await fragFlashBorrow({ owner, asset, amountRaw });
      parts.push(...f.ixs); reps.push(...(f.repay || []));
    } else if (kind === 'swap') {
      const [inputMint, outputMint, amountRaw] = rest;
      const f = await fragSwap({ owner, inputMint, outputMint, amountRaw });
      parts.push(...f.ixs);
    } else if (kind === 'pumpBuy') {
      const [mint, solRaw] = rest;
      const f = await fragPumpBuy({ owner, mint, solLamports: Number(solRaw) });
      parts.push(...f.ixs);
    } else if (kind === 'ata') {
      const f = await fragAta({ owner, mint: rest[0] });
      parts.push(...f.ixs);
    } else {
      throw new Error(`unknown lego ${kind}`);
    }
  }
  return [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...[...parts, ...reps].map(norm)];
}
