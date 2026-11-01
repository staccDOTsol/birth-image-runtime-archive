// Self-funding: the agent buys its own inference credit. If the wallet holds SOL but not
// enough USDC, it quotes and executes a SOL->USDC swap itself, then tops up the provider.
// No human, no parent, no API key.
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as swap from './swap.mjs';
import * as S from './signer-client.mjs';
import * as R from './rpc.mjs';
import * as J from './journal.mjs';
import * as venice from '../inference/venice.mjs';
import { now, log } from './util.mjs';

const WSOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export async function usdcBalance(identity) {
  const accts = await R.tokenAccounts(identity.solana.public_key, TOKEN_PROGRAM_ID.toBase58());
  return accts.filter((a) => a.account.data.parsed.info.mint === USDC)
    .reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
}

export async function swapSolToUsdc(identity, lamports, { slippageBps = 50 } = {}) {
  const owner = new PublicKey(identity.solana.public_key);
  const wsolAta = getAssociatedTokenAddressSync(new PublicKey(WSOL), owner).toBase58();
  const usdcAta = getAssociatedTokenAddressSync(new PublicKey(USDC), owner).toBase58();
  const q = await swap.quote({ inputMint: WSOL, outputMint: USDC, amount: String(lamports), slippageBps });
  const set = await swap.swapInstructions({ quoteResponse: q, userPublicKey: owner.toBase58(), wrapAndUnwrapSol: true });
  const ixs = swap.ixsOf(set);
  const { blockhash, lastValidBlockHeight } = await R.getLatestBlockhash();
  const env = await S.signV1({ instructions: ixs, blockhash, lastValidBlockHeight, cuLimit: 1_400_000, allowedDestinations: [wsolAta, usdcAta], strategy: true });
  const sim = await R.simulate(env.wireBase64, [wsolAta, usdcAta, owner.toBase58()]);
  if (sim.value?.err) {
    const rec = { at: now(), stage: 'simulate', err: sim.value.err, logs: (sim.value.logs || []).slice(-6), lamports };
    await J.append('treasury.swap_failed', rec);
    return { ok: false, ...rec };
  }
  const sig = await R.sendRaw(env.wireBase64);
  let status = null;
  for (let i = 0; i < 40; i++) { const st = (await R.signatureStatuses([sig]))[0]; if (st?.confirmationStatus) { status = st; break; } await new Promise((r) => setTimeout(r, 1200)); }
  const rec = { at: now(), kind: 'sol_to_usdc', in_lamports: lamports, quoted_usdc_raw: q.outAmount, signature: sig, status: status?.confirmationStatus || 'unknown', err: status?.err || null };
  await J.append('treasury.swap', rec);
  return { ok: !status?.err && !!status, ...rec };
}

// Goal: provider credits >= admission floor. Swap only what is needed, keep a fee reserve.
export async function ensureInferenceFunding(identity, { minCredits = 0.10, minUsdc = 5_000_000n, feeReserve = 20_000_000n, maxSwap = 120_000_000 } = {}) {
  const bal = await venice.balance(identity).catch(() => null);
  const credits = Number(bal?.balanceUsd ?? 0);
  if (credits >= minCredits) return { state: 'ready', credits };
  let usdc = await usdcBalance(identity);
  const steps = [];
  if (usdc < minUsdc) {
    const sol = BigInt(await R.getBalance(identity.solana.public_key));
    const need = minUsdc - usdc;
    // ~price from a quote of a fixed probe size, then size the swap conservatively.
    const probe = await swap.quote({ inputMint: WSOL, outputMint: USDC, amount: '10000000', slippageBps: 50 }).catch(() => null);
    if (!probe) return { state: 'blocked', reason: 'no swap quote', credits, usdc: usdc.toString() };
    const perLamport = Number(probe.outAmount) / 1e7;
    let lamports = BigInt(Math.ceil((Number(need) / perLamport) * 1.05));
    const spendable = sol > feeReserve ? sol - feeReserve : 0n;
    if (lamports > BigInt(maxSwap)) lamports = BigInt(maxSwap);
    if (lamports > spendable) lamports = spendable;
    if (lamports < 5_000_000n) return { state: 'blocked', reason: 'SOL too small to swap', sol: sol.toString(), credits, usdc: usdc.toString() };
    const s = await swapSolToUsdc(identity, Number(lamports));
    steps.push({ swap: s.ok ? 'confirmed' : 'failed', lamports: String(lamports), signature: s.signature || null });
    if (!s.ok) return { state: 'blocked', reason: 'swap failed', steps, credits, usdc: usdc.toString() };
    usdc = await usdcBalance(identity);
  }
  if (usdc >= minUsdc) {
    try {
      const f = await venice.fundIfNeeded(identity, { maxTopUpUsdc: 5 });
      steps.push({ topup: f.funded ? 'credited' : 'unconfirmed', credits: f.credits, signature: f.topup?.receipt?.transaction || null });
      return { state: f.funded ? 'funded' : 'topup_pending', credits: f.credits, steps };
    } catch (e) { return { state: 'blocked', reason: String(e.message || e), steps, usdc: usdc.toString() }; }
  }
  return { state: 'blocked', reason: 'usdc below provider minimum after swap', steps, usdc: usdc.toString() };
}
