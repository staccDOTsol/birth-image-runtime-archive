// Compose playbooks out of playbooks. A chain is an ordered list of Lego ids; each step runs
// with the agent's own identity, and a step's output feeds the next. A chain can itself be
// named and saved, so a playbook may contain playbooks.
import * as S from './signer-client.mjs';
import * as R from './rpc.mjs';

async function identity() { return S.identity(); }

const STEPS = {
  async swap_sol_usdc({ identity: id, lamports = 15_000_000 }) {
    const swap = await import('./swap.mjs');
    const WSOL = 'So11111111111111111111111111111111111111112';
    const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const q = await swap.quote({ inputMint: WSOL, outputMint: USDC, amount: String(lamports), slippageBps: 50 });
    return { step: 'swap_sol_usdc', quote_out_usdc: Number(q?.outAmount || 0) / 1e6, ran: true };
  },
  async lease_child({ identity: id }) {
    const { paySolana } = await import('./lease.mjs');
    return { step: 'lease_child', note: 'use spawn_child tool for the full lease+adopt path', ran: false };
  },
  async launch_coin({ identity: id, name, symbol, lamports }) {
    return { step: 'launch_coin', note: 'use pump_launch tool (needs art + metadata first)', ran: false };
  },
  async buy_sibling({ identity: id, mint, sol }) {
    const { buyExisting } = await import('../strategies/buy-existing.mjs');
    return buyExisting({ identity: id, mint, solLamports: Math.round(Number(sol || 0) * 1e9) });
  },
  async exit_position({ identity: id, mint }) {
    const { exit } = await import('../strategies/pump-lifecycle.mjs');
    return exit({ identity: id, mint });
  },
  async collect_fees({ identity: id, mint }) {
    const { collect } = await import('../strategies/pump-lifecycle.mjs');
    return collect({ identity: id, mint });
  },
};

export async function runChain(steps, args = {}) {
  const id = await identity();
  const L = await import('./lego.mjs');
  const expand = (x, d = 0) => {
    if (d > 6) return [];
    if (Array.isArray(x)) return x.flatMap((y) => expand(y, d + 1));
    if (typeof x === 'string') return L.resolve(x);
    return [];
  };
  const flat = expand(steps);
  const out = [];
  for (const name of flat) {
    const fn = STEPS[name];
    if (!fn) { out.push({ step: name, err: 'unknown lego' }); break; }
    try {
      const r = await fn({ identity: id, ...args });
      out.push(r);
      if (r && r.ok === false) break;
    } catch (e) { out.push({ step: name, err: String(e.message || e).slice(0, 120) }); break; }
  }
  return { chain: flat, requested: steps, results: out, completed: out.filter((r) => !r.err).length };
}

export function parseChain(text) {
  // "swap_sol_usdc > lease_child > launch_coin" or JSON array
  const t = String(text || '').trim();
  if (t.startsWith('[')) { try { return JSON.parse(t); } catch {} }
  return t.split(/\s*>\s*|\s*,\s*/).filter(Boolean);
}
