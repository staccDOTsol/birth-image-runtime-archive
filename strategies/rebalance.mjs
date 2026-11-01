// Keep the resources an agent actually spends topped up, from the agent's own holdings:
// Base USDC for x402 purchases, Solana USDC for Solana-rail payments, and SOL for fees.
// It is the agent noticing it is short and moving its own money — no human, no funder.
import * as S from '../lib/signer-client.mjs';
import * as R from '../lib/rpc.mjs';
import { balances } from '../lib/x402.mjs';
import { log, now } from '../lib/util.mjs';

const MIN_BASE_USDC = BigInt(process.env.AGENT_MIN_BASE_USDC || 500_000);   // $0.50
const MIN_SOL_USDC = BigInt(process.env.AGENT_MIN_SOL_USDC || 1_000_000);   // $1.00
const MIN_SOL_LAMPORTS = BigInt(process.env.AGENT_MIN_SOL || 20_000_000);   // 0.02 SOL

export async function rebalance({ dry = false } = {}) {
  const id = await S.identity();
  const before = await balances(id);
  const solLamports = BigInt(await R.getBalance(id.solana.public_key) || 0);
  const plan = [];
  const out = { at: now(), before: { base_usdc: Number(before.base) / 1e6, sol_usdc: Number(before.solana) / 1e6, sol: Number(solLamports) / 1e9 }, actions: plan };

  // 1. Base USDC short, Solana USDC available: bridge the difference over deBridge.
  if (before.base < MIN_BASE_USDC && before.solana > MIN_SOL_USDC) {
    const want = MIN_BASE_USDC - before.base;
    plan.push({ action: 'bridge_usdc_to_base', want_usdc: Number(want) / 1e6 });
    if (!dry) {
      try {
        const { execFileSync } = await import('node:child_process');
        const r = execFileSync(process.execPath, ['bin/bridge-base.mjs', String(Number(want) / 1e6 * 1e9)], { encoding: 'utf8', timeout: 180000 });
        out.bridge = r.trim().split('\n').pop().slice(0, 200);
      } catch (e) { out.bridge_err = String(e.message || e).slice(0, 120); }
    }
  }
  // 2. SOL short for fees, Solana USDC available: swap USDC -> SOL.
  if (solLamports < MIN_SOL_LAMPORTS && before.solana > MIN_SOL_USDC) {
    plan.push({ action: 'swap_usdc_to_sol', want_sol: 0.02 });
    if (!dry) {
      try {
        const swap = await import('../lib/swap.mjs');
        const q = await swap.quote({ inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', outputMint: 'So11111111111111111111111111111111111111112', amount: String(MIN_SOL_USDC), slippageBps: 50 });
        if (q?.outAmount) out.swap = String(q.outAmount);
      } catch (e) { out.swap_err = String(e.message || e).slice(0, 100); }
    }
  }
  // 3. Solana USDC short but SOL present: swap SOL -> USDC (the lane that already works).
  if (before.solana < MIN_SOL_USDC && solLamports > MIN_SOL_LAMPORTS * 3n) {
    plan.push({ action: 'swap_sol_to_usdc', lamports: Number(10_000_000n) });
    if (!dry) {
      try {
        const { execFileSync } = await import('node:child_process');
        const r = execFileSync(process.execPath, ['bin/swap-sol-usdc.mjs', '10000000'], { encoding: 'utf8', timeout: 120000 });
        out.swap_sol = r.trim().split('\n').pop().slice(0, 160);
      } catch (e) { out.swap_sol_err = String(e.message || e).slice(0, 100); }
    }
  }
  if (!plan.length) out.ok = true;
  log('rebalance', 'tick', out);
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('rebalance.mjs')) console.log(JSON.stringify(await rebalance({ dry: process.argv.includes('--dry') })));
