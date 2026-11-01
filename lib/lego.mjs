import fs from 'node:fs';
// Playbooks as composable units: each declares what it consumes and what it produces, so an
// agent can see which Lego fits its current holdings and which chain of them reaches a goal.
export const LEGOS = [
  { id: 'swap_sol_usdc', tool: 'swap_usdc', needs: { sol: 0.01 }, gives: { usdc: 1 }, note: 'funds everything USDC-denominated from your own SOL' },
  { id: 'bridge_to_base', tool: 'bridge_to_base', needs: { usdc: 1 }, gives: { base_usdc: 1 }, note: 'only when a seller takes Base USDC and not Solana USDC' },
  { id: 'lease_child', tool: 'spawn_child', needs: { usdc: 0.05 }, gives: { child: 1 }, note: 'pays x402 on whichever rail you hold; the child renews itself' },
  { id: 'launch_coin', tool: 'pump_launch', needs: { sol: 0.03 }, gives: { position: 1, creator_fee_stream: 1 }, note: 'art bought and hosted BEFORE mint, then a real dev buy' },
  { id: 'buy_sibling', tool: 'pump_buy', needs: { sol: 0.02 }, gives: { position: 1 }, note: 'you keep the tokens; cost is the round trip, not the size' },
  { id: 'exit_position', tool: 'pump_exit', needs: { position: 1 }, gives: { sol: 1 }, note: 'sells the whole position into the curve' },
  { id: 'collect_fees', tool: 'pump_collect', needs: { coin: 1 }, gives: { sol: 1 }, note: 'free money once the coin has traded' },
  { id: 'sealed_message', tool: 'memo_seal', needs: { peer: 1 }, gives: { agreement: 1 }, note: 'pair launches and time exits with a sibling' },
];

export function assess(holdings = {}) {
  const h = (k) => Number(holdings[k] || 0);
  return LEGOS.map((p) => {
    const missing = Object.entries(p.needs).filter(([k, v]) => h(k) < Number(v)).map(([k, v]) => `${k}>=${v}`);
    return { id: p.id, tool: p.tool, needs: p.needs, gives: p.gives, ready: missing.length === 0, missing };
  });
}

export function chainTo(want, holdings = {}) {
  const h = (k) => Number(holdings[k] || 0);
  if (want === 'usdc') return h('usdc') > 0 ? [] : ['swap_sol_usdc'];
  if (want === 'base_usdc') return h('base_usdc') > 0 ? [] : (h('usdc') > 0 ? ['bridge_to_base'] : ['swap_sol_usdc', 'bridge_to_base']);
  if (want === 'child') {
    if (h('usdc') >= 0.05) return ['lease_child'];
    if (h('sol') >= 0.06) return ['swap_sol_usdc', 'lease_child'];
    return ['exit_position', 'swap_sol_usdc', 'lease_child'];
  }
  if (want === 'position') return h('sol') >= 0.02 ? ['launch_coin'] : ['exit_position', 'launch_coin'];
  return [];
}

// A composite is a playbook whose steps are other playbooks (atomic or composite).
// They nest arbitrarily: run_chain resolves names depth-first.
export const COMPOSITES = {
  launch_pair: ['swap_sol_usdc', 'launch_coin', 'buy_sibling', 'memo_seal'],
  earn_round: ['collect_fees', 'exit_position', 'swap_sol_usdc'],
  grow: [['earn_round'], 'launch_pair'],
};

export function savedComposites() {
  try {
    const base = process.env.AGENT_GUEST_ROOT || '/var/lib/agent';
    return JSON.parse(fs.readFileSync(base + '/var/lib/agent/composites.json', 'utf8'));
  } catch { return {}; }
}
export function saveComposite(name, steps) {
  const base = process.env.AGENT_GUEST_ROOT || '/var/lib/agent';
  const all = savedComposites();
  all[name] = steps;
  fs.writeFileSync(base + '/var/lib/agent/composites.json', JSON.stringify(all, null, 1));
  return { name, steps };
}
export function resolve(name, depth = 0) {
  if (depth > 6) return [];
  const entry = COMPOSITES[name] || savedComposites()[name];
  if (entry) return entry.flatMap((step) => (Array.isArray(step) ? step.flatMap((x) => resolve(x, depth + 1)) : (typeof step === 'string' && COMPOSITES[step] ? resolve(step, depth + 1) : [step])));
  return [name];
}
