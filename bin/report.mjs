// The five-minute report: what the fleet is holding, what it did, and what changed since the
// previous line. Plain text so it can be read in chat, appended to a log, or pushed anywhere.
import fs from 'node:fs';

const rows = (() => {
  try { return fs.readFileSync('dist/ledger.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { return []; }
})();
const last = rows[rows.length - 1] || {};
const prev = rows[rows.length - 2] || {};
const delta = (k) => (last[k] != null && prev[k] != null ? (last[k] - prev[k]) : 0);
const sign = (n, digits = 3) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;

const dSol = delta('sol_total');
const dAgents = delta('agents_up');
const dLaunch = delta('launches_seen');

const lines = [
  `FLEET ${new Date(last.at || Date.now()).toISOString().slice(11, 16)}Z`,
  `agents   ${last.agents_up ?? '?'}/${last.agents_total ?? '?'}  (${dAgents >= 0 ? '+' : ''}${dAgents})`,
  `sol      ${(last.sol_total ?? 0).toFixed(3)}  (${sign(dSol)})   median ${(last.sol_median ?? 0).toFixed(3)}`,
  `launches ${last.launches_seen ?? 0}  (${dLaunch >= 0 ? '+' : ''}${dLaunch})`,
  `errors   ${last.decision_errors ?? 0}`,
  `funded   ${(last.funded_cum_sol ?? 0).toFixed(3)} SOL cumulative`,
];
try {
  const p = JSON.parse(fs.readFileSync('dist/pnl.json', 'utf8'));
  lines.push(`value    $${p.fleet.value.toFixed(0)}  (sol $${p.fleet.sol.toFixed(0)} · usdc $${p.fleet.usdc.toFixed(2)} · tokens $${p.fleet.tok.toFixed(2)})`);
  lines.push(`cost     $${p.fleet.cost.toFixed(2)}/day for ${p.boxes.length} boxes`);
} catch {}
try {
  const f = fs.readFileSync('dist/image-watch.jsonl', 'utf8').trim().split('\n').pop();
  if (f) { const j = JSON.parse(f); lines.push(`images   base $${j.base_usdc.toFixed(4)} · ${j.action}`); }
} catch {}

const out = lines.join('\n');
fs.mkdirSync('dist/reports', { recursive: true });
fs.writeFileSync('dist/reports/latest.txt', out + '\n');
fs.appendFileSync('dist/reports/history.log', out.replace(/\n/g, ' | ') + '\n');
console.log(out);
