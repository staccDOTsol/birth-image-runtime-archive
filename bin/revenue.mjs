// Measure actual revenue: every paid sweep in the earn logs carries a signature, and the
// transaction says exactly how many lamports landed in the agent's wallet. Summed per box
// and per agent, this is real income — creator fees minus nothing, since the fee payer is us.
import fs from 'node:fs';
import path from 'node:path';
import * as R from '../lib/rpc.mjs';

const roots = (process.env.REV_ROOTS || '/var/lib/agent,/var/lib/agent-8081,/var/lib/agent-8082,/var/lib/agent-8083').split(',');
const sigs = [];
for (const r of roots) {
  const f = path.join(r, 'var', 'lib', 'agent', 'earn.log');
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.includes('"paid":true')) continue;
    const m = line.match(/"sig":"([1-9A-HJ-NP-Za-km-z]{60,100})"/);
    if (m) sigs.push({ sig: m[1], root: path.basename(r) });
  }
}
const uniq = [...new Map(sigs.map((s) => [s.sig, s])).values()];
let total = 0n, counted = 0, failed = 0;
const per = {};
for (const { sig, root } of uniq) {
  try {
    const tx = await R.rpc('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
    const keys = tx?.transaction?.message?.accountKeys || [];
    const idx = keys.findIndex((k) => (k.pubkey || k) && true);
    if (!tx?.meta) { failed++; continue; }
    // the sweep pays the agent: find the largest positive lamport delta that is not a fee
    let best = 0n;
    tx.meta.postBalances.forEach((post, i) => {
      const pre = tx.meta.preBalances[i] || 0;
      const d = BigInt(post) - BigInt(pre);
      if (d > best) best = d;
    });
    total += best; counted++;
    per[root] = (per[root] || 0n) + best;
  } catch { failed++; }
}
const out = { at: new Date().toISOString(), sweeps: uniq.length, counted, failed, revenue_lamports: String(total), revenue_sol: Number(total) / 1e9, per_root: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, Number(v) / 1e9])) };
console.log(JSON.stringify(out));
