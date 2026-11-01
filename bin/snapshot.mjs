// Five-minute ledger. One line per snapshot: what answered, what it holds, what it has
// launched, and how much we have put in. Appending to dist/ledger.jsonl forever.
import fs from 'node:fs';

const RPC = fs.readFileSync('dist/rpc.txt', 'utf8').trim();
const BOXES = (process.env.BOXES || (() => { try { const a = JSON.parse(fs.readFileSync('dist/vps.json', 'utf8')); return (Array.isArray(a) ? a : a.ips).join(','); } catch { return ''; } })()).split(',').filter(Boolean);
const rpc = async (m, p) => {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }), signal: AbortSignal.timeout(8000) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
};

const agents = [];
for (const ip of BOXES) {
  let up = 0;
  for (const port of [80, 8081, 8082, 8083]) {
    const ep = `http://${ip}${port === 80 ? '' : ':' + port}`;
    try {
      const t = await (await fetch(ep + '/identity', { signal: AbortSignal.timeout(3000) })).text();
      const w = t.match(/"public_key":\s*"([1-9A-HJ-NP-Za-km-z]{32,44})"/)?.[1];
      if (!w) continue;
      up++;
      let st = {};
      try { st = await (await fetch(ep + '/status', { signal: AbortSignal.timeout(3000) })).json(); } catch {}
      agents.push({ ip, port, wallet: w, launches: (st.launches || []).length, decision_at: st.last_decision?.at || null, decision_err: st.last_decision?.error || null, spend_usd: Number(st.last_decision?.cost_usd || 0) });
    } catch {}
  }
  if (up === 0) agents.push({ ip, port: 0, wallet: null, up: 0 });
}

let sol = 0n;
const perWallet = [];
for (const a of agents) {
  if (!a.wallet) continue;
  try { const b = BigInt((await rpc('getBalance', [a.wallet])).value || 0); sol += b; a.sol = Number(b) / 1e9; perWallet.push(a.sol); } catch {}
}
let funded = 0;
try { funded = (fs.readFileSync('dist/fund-all.log', 'utf8').match(/"funded":([0-9.]+)/g) || []).map((s) => Number(s.split(':')[1])).reduce((x, y) => x + y, 0); } catch {}
let launched = 0, errors = 0, spend = 0;
for (const a of agents) { launched += a.launches || 0; if (a.decision_err) errors++; spend += a.spend_usd || 0; }

const row = {
  at: new Date().toISOString(),
  agents_up: agents.filter((a) => a.wallet).length,
  agents_total: agents.length,
  sol_total: Number(sol) / 1e9,
  sol_median: perWallet.length ? perWallet.sort((a, b) => a - b)[Math.floor(perWallet.length / 2)] : 0,
  launches_seen: launched,
  decision_errors: errors,
  inference_usd_last: Number(spend.toFixed(4)),
  funded_cum_sol: Number(funded.toFixed(3)),
};
fs.appendFileSync('dist/ledger.jsonl', JSON.stringify(row) + '\n');
console.log(JSON.stringify(row));
