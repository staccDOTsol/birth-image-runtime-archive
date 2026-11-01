// Atomic flash-loan strategy: one native Solana transaction v1, every obligation repaid
// inside the same message. Principal lifetimes are one transaction; the agent's own cash
// only pays fees and setup. A route is executable only after a signed-message simulation
// shows a fully successful message with the configured net floor.
import fs from 'node:fs';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { getFlashloanIx } from '@jup-ag/lend/flashloan';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import { P } from '../lib/paths.mjs';
import { readJson, atomicJson, now, log, sha256hex, canon, sleep } from '../lib/util.mjs';
import * as R from '../lib/rpc.mjs';
import * as S from '../lib/signer-client.mjs';
import * as J from '../lib/journal.mjs';
import * as swap from '../lib/swap.mjs';

const RPC_URL = R.RPC_URL;
const conn = new Connection(RPC_URL, { commitment: 'confirmed' });
export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WSOL = 'So11111111111111111111111111111111111111112';
const CANDIDATES = [
  { mint: WSOL, symbol: 'SOL', decimals: 9 },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', decimals: 6 },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', decimals: 5 },
  { mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: 'WIF', decimals: 6 },
];

function j() { return P.strategy + '/flashloan.json'; }
export function loadBook() { return readJson(j(), { attempts: [], candidates: [], updated_at: null }); }
export function saveBook(b) { b.updated_at = now(); atomicJson(j(), b, 0o600); }

function toIx(ix) {
  return {
    programId: ix.programId.toBase58(),
    keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: !!k.isSigner, isWritable: !!k.isWritable })),
    dataHex: Buffer.from(ix.data).toString('hex'),
  };
}

// Search circular USDC -> X -> USDC routes on the aggregator at a stated size.
export async function scan({ sizeUsdc = 100_000_000n, slippageBps = 20, mints = CANDIDATES } = {}) {
  const out = [];
  for (const c of mints) {
    try {
      const a = await swap.quote({ inputMint: USDC, outputMint: c.mint, amount: sizeUsdc.toString(), slippageBps });
      const b = await swap.quote({ inputMint: c.mint, outputMint: USDC, amount: a.outAmount, slippageBps });
      const back = BigInt(b.outAmount);
      const net = back - BigInt(sizeUsdc);
      out.push({
        id: `usdc-${c.symbol}-usdc`,
        mint: c.mint, symbol: c.symbol,
        size_usdc_raw: sizeUsdc.toString(),
        leg1_out: a.outAmount, leg2_out: b.outAmount,
        net_usdc_raw: net.toString(),
        price_impact_pct: [a.priceImpactPct, b.priceImpactPct],
        net_usd: Number(net) / 1e6,
        slot: Math.max(Number(a.contextSlot || 0), Number(b.contextSlot || 0)),
        route_labels: [...new Set([...(a.routePlan || []), ...(b.routePlan || [])].map((r) => r.swapInfo?.label))],
        quoted_at: now(),
      });
    } catch (e) {
      out.push({ id: `usdc-${c.symbol}-usdc`, mint: c.mint, symbol: c.symbol, error: String(e.message || e) });
    }
  }
  out.sort((x, y) => Number(BigInt(y.net_usdc_raw || 0) - BigInt(x.net_usdc_raw || 0)));
  const book = loadBook();
  book.candidates = out;
  saveBook(book);
  return out;
}

export async function build({ identity, candidate, slippageBps = 20 }) {
  const size = BigInt(candidate.size_usdc_raw);
  const owner = new PublicKey(identity.solana.public_key);
  const usdcAta = getAssociatedTokenAddressSync(new PublicKey(USDC), owner);
  const { borrowIx, paybackIx, feeAmount } = await getFlashloanIx({
    connection: conn, signer: owner, asset: new PublicKey(USDC), amount: new BN(size.toString()),
  });
  const ixs = [toIx(createAssociatedTokenAccountIdempotentInstruction(owner, usdcAta, owner, new PublicKey(USDC), TOKEN_PROGRAM_ID)), toIx(borrowIx)];

  const a = await swap.quote({ inputMint: USDC, outputMint: candidate.mint, amount: size.toString(), slippageBps });
  const aSet = await swap.swapInstructions({ quoteResponse: a, userPublicKey: owner.toBase58() });
  ixs.push(...swap.ixsOf(aSet));

  const b = await swap.quote({ inputMint: candidate.mint, outputMint: USDC, amount: a.otherAmountThreshold, slippageBps });
  const bSet = await swap.swapInstructions({ quoteResponse: b, userPublicKey: owner.toBase58() });
  ixs.push(...swap.ixsOf(bSet));
  ixs.push(toIx(paybackIx));

  const uniq = swap.uniqueAccounts(ixs);
  return {
    ixs, unique_accounts: uniq.length,
    fee_raw: (feeAmount ?? 0n).toString(),
    expected_out_raw: b.outAmount,
    min_out_raw: b.otherAmountThreshold,
    plan_hash: sha256hex(Buffer.from(canon({ candidate: candidate.id, size: size.toString(), a: a.outAmount, b: b.outAmount, min: b.otherAmountThreshold }))),
  };
}

export async function simulatePlan({ identity, plan }) {
  const usdcAta = getAssociatedTokenAddressSync(new PublicKey(USDC), new PublicKey(identity.solana.public_key)).toBase58();
  const watch = [usdcAta, identity.solana.public_key];
  const { blockhash, lastValidBlockHeight } = await R.getLatestBlockhash();
  const env = await S.signV1({ instructions: plan.ixs, blockhash, lastValidBlockHeight, cuLimit: 1_400_000, strategy: true });
  const before = (await R.rpc('getMultipleAccounts', [watch, { encoding: 'base64', commitment: 'confirmed' }])).value;
  const sim = await R.simulate(env.wireBase64, watch);
  const v = sim.value || {};
  const after = v.accounts || [];
  const lamports = (a) => BigInt(a?.lamports ?? 0);
  const token = (a) => {
    if (!a?.data) return null;
    const d = Buffer.from(a.data[0], 'base64');
    return d.length >= 72 ? d.readBigUInt64LE(64) : null;
  };
  const usdcDelta = (token(after[0]) != null && token(before[0]) != null) ? token(after[0]) - token(before[0]) : null;
  const solDelta = lamports(after[1]) - lamports(before[1]);
  return {
    err: v.err || null, logs: (v.logs || []).slice(-20), units: v.unitsConsumed ?? null,
    usdc_delta_raw: usdcDelta?.toString() ?? null, sol_delta_raw: solDelta.toString(),
    env, blockhash, lastValidBlockHeight, bytes: env.bytes, addresses: env.addresses,
  };
}

export async function execute({ identity, candidate, floorUsdcRaw = 50_000n, slippageBps = 20 }) {
  const plan = await build({ identity, candidate, slippageBps });
  if (plan.unique_accounts > 64) throw new Error(`v1 account limit: ${plan.unique_accounts} > 64`);
  const sim = await simulatePlan({ identity, plan });
  if (sim.err) {
    const rec = { at: now(), phase: 'simulate', candidate: candidate.id, plan_hash: plan.plan_hash, err: sim.err, logs: sim.logs, bytes: sim.bytes };
    const b = loadBook(); b.attempts.push(rec); saveBook(b);
    await J.append('flashloan.attempt', rec);
    return { ok: false, ...rec };
  }
  const net = sim.usdc_delta_raw == null ? null : BigInt(sim.usdc_delta_raw);
  if (net == null || net < floorUsdcRaw) {
    const rec = { at: now(), phase: 'gate', candidate: candidate.id, plan_hash: plan.plan_hash, net_usdc_raw: net?.toString() ?? null, floor: floorUsdcRaw.toString(), sol_delta_raw: sim.sol_delta_raw };
    const b = loadBook(); b.attempts.push(rec); saveBook(b);
    await J.append('flashloan.gate', rec);
    return { ok: false, ...rec };
  }
  // Journal before broadcast.
  const intent = { at: now(), phase: 'submit', candidate: candidate.id, plan_hash: plan.plan_hash, net_usdc_raw: net.toString(), signature: sim.env.signature, blockhash: sim.blockhash, last_valid_block_height: sim.lastValidBlockHeight, bytes: sim.bytes };
  await J.append('flashloan.intent', intent);
  const sig = await R.sendRaw(sim.env.wireBase64);
  let status = null;
  for (let i = 0; i < 40; i++) {
    const st = (await R.signatureStatuses([sig]))[0];
    if (st) { status = st; if (st.confirmationStatus) break; }
    await sleep(1200);
  }
  const tx = await R.getTransaction(sig).catch(() => null);
  const rec = {
    at: now(), phase: 'settle', candidate: candidate.id, signature: sig, status: status?.confirmationStatus || 'unknown',
    err: status?.err || tx?.meta?.err || null, actual_fee: tx?.meta?.fee ?? null,
    simulated_net_usdc_raw: net.toString(), plan_hash: plan.plan_hash,
  };
  const b = loadBook(); b.attempts.push(rec); saveBook(b);
  await J.append('flashloan.settlement', rec);
  return { ok: !!status && !status.err && !tx?.meta?.err, ...rec };
}

export async function solBalance(identity) { return R.getBalance(identity.solana.public_key); }
