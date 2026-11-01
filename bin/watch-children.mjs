// Regular check-in on the fleet: prints one compact line per cycle and shouts when a new birth
// appears (a child that replicates) or a child stops answering.
// usage: node bin/watch-children.mjs [intervalSeconds]
import fs from 'node:fs';
import path from 'node:path';
import { RUNTIME_DIR } from '../lib/paths.mjs';
import * as A from './agentgates-auth.mjs';
import * as R from '../lib/rpc.mjs';

const every = Number(process.argv[2] || 300) * 1000;
const statePath = path.join(RUNTIME_DIR, 'dist', 'watch-state.json');
const load = () => { try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return { births: {}, dead: {} }; } };
const save = (s) => fs.writeFileSync(statePath, JSON.stringify(s, null, 2));

const stamp = () => new Date().toISOString().slice(11, 19);

async function cycle() {
  const st = load();
  let list = [];
  try {
    const b = (await A.ownerGet('https://agentgates-backend.vercel.app', '/api/compute/deployments')).body;
    list = (Array.isArray(b) ? b : b.deployments || []).filter((d) => d.status !== 'destroyed');
  } catch (e) {
    console.log(`${stamp()} api error ${String(e.message || e).slice(0, 80)}`);
    return;
  }
  const rows = [];
  for (const d of list) {
    let birth = null, sol = null, credits = null, up = false;
    if (d.endpoint) {
      for (let attempt = 0; attempt < 3 && !up; attempt++) {
        try {
          const j = await (await fetch(d.endpoint + '/identity', { signal: AbortSignal.timeout(10000) })).json();
          birth = j.payload?.birth_id || null;
          up = !!birth;
          if (birth) {
            try {
              const s = await (await fetch(d.endpoint + '/status', { signal: AbortSignal.timeout(10000) })).json();
              credits = s.inference?.credits_usd ?? null;
            } catch {}
            try { sol = ((await R.getBalance(j.payload.solana.public_key)) / 1e9).toFixed(4); } catch {}
          }
        } catch { up = false; }
        if (!up && attempt < 2) await new Promise((r) => setTimeout(r, 5000));
      }
    }
    const key = birth || d.deploymentId;
    if (birth && !st.births[key]) {
      st.births[key] = { first_seen: Date.now(), wallet: d.endpoint ? 'see /identity' : null };
      console.log(`REPLICATED birth ${birth} dep ${d.deploymentId.slice(0, 9)} endpoint ${d.endpoint || '-'}`);
    }
    if (!up && d.endpoint && !st.dead[d.deploymentId]) { st.dead[d.deploymentId] = Date.now(); console.log(`DOWN ${d.deploymentId.slice(0, 9)} ${birth || ''} ${d.endpoint}`); }
    if (up && st.dead[d.deploymentId]) delete st.dead[d.deploymentId];
    rows.push(`${(birth || d.deploymentId).slice(0, 8)} ${up ? 'up' : 'down'} sol=${sol ?? '-'} cr=${credits ?? '-'}`);
  }
  save(st);
  console.log(`${stamp()} fleet ${rows.length}: ${rows.join(' | ')}`);
}

const once = process.argv[3] === 'once';

if (once) {
  await cycle().catch((e) => console.log(`${stamp()} cycle error ${String(e.message || e).slice(0, 80)}`));
  process.exit(0);
}

while (true) {
  await cycle().catch((e) => console.log(`${stamp()} cycle error ${String(e.message || e).slice(0, 80)}`));
  await new Promise((r) => setTimeout(r, every));
}
