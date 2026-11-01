// Prove a TEE child is working: wait for its receipt, endow it if it has never been
// funded, then require a real model decision carrying a tool call. Prints one JSON verdict.
// usage: node bin/verify-child.mjs <deploymentId> [lamports]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { RUNTIME_DIR } from '../lib/paths.mjs';
import { now, readJson } from '../lib/util.mjs';

const run = promisify(execFile);
const id = process.argv[2];
const lamports = Number(process.argv[3] || 70_000_000);
const API = 'https://agentgates-backend.vercel.app';
const { ownerGet } = await import('./agentgates-auth.mjs');

let funded = false, address = null, dep = null, last = null;
for (let i = 0; i < 60; i++) {
  dep = (await ownerGet(API, `/api/compute/deployments/${id}`)).body;
  if (dep.status === 'failed' || dep.status === 'destroyed') { console.log(JSON.stringify({ ok: false, stage: dep.status, id })); process.exit(1); }
  if (dep.endpoint) {
    try {
      const j = await (await fetch(dep.endpoint + '/identity', { signal: AbortSignal.timeout(6000) })).json();
      address = j.payload?.solana?.public_key || null;
    } catch {}
  }
  if (address && !funded) {
    const { stdout } = await run(process.execPath, [path.join(RUNTIME_DIR, 'bin', 'fund-child.mjs'), address, String(lamports)], { cwd: RUNTIME_DIR, timeout: 120000 });
    funded = true;
    console.log(JSON.stringify({ stage: 'funded', address, tx: JSON.parse(stdout.trim().split('\n').pop()).signature }));
  }
  if (address) {
    try {
      const s = await (await fetch(dep.endpoint + '/status', { signal: AbortSignal.timeout(6000) })).json();
      last = { credits: s.inference?.credits_usd, decision: s.last_decision || null, components: Object.fromEntries(Object.entries(s.components || {}).map(([k, v]) => [k, !!v?.pid])) };
      const tools = last.decision?.tools || [];
      if (tools.length) {
        console.log(JSON.stringify({ ok: true, address, endpoint: dep.endpoint, credits: last.credits, decision: last.decision, components: last.components, at: now() }));
        process.exit(0);
      }
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 15000));
}
console.log(JSON.stringify({ ok: false, stage: 'no_decision', address, endpoint: dep?.endpoint || null, last }));
