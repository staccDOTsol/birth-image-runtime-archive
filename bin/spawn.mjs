// Spawn one child on the Solana lease rail (so the deployment stays in this wallet's
// list), then endow it. Prints a single JSON line per stage.
// usage: node bin/spawn.mjs [plan]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { RUNTIME_DIR } from '../lib/paths.mjs';
import * as S from '../lib/signer-client.mjs';
import * as E from '../lib/lease-evm.mjs';
import * as L from '../lib/lease.mjs';
import { compose } from './deploy-child.mjs';
import { now } from '../lib/util.mjs';

const run = promisify(execFile);
const plan = process.argv[2] || process.env.AGENT_PLAN || 'compute.standard';
const identity = await S.identity();
process.env.AGENT_LEASE_NETWORK = process.env.AGENT_LEASE_NETWORK || 'solana';

const r = await E.paidPostAuto('/api/compute/deployments', { plan, hours: 1, compose: compose(), name: `birth-child-${Math.floor(now() / 60)}` }, identity, 'procreation.lease');
const dep = r.json?.deploymentId || r.json?.id || null;
console.log(JSON.stringify({ stage: 'lease', status: r.status, rail: r.rail, deploymentId: dep, err: (r.json?.error || '').slice(0, 120) }));
if (!dep) process.exit(1);

let endpoint = null, address = null;
for (let i = 0; i < 40; i++) {
  const d = (await L.listDeployments()).find((x) => x.deploymentId === dep);
  if (d?.endpoint) endpoint = d.endpoint;
  if (endpoint && !address) { try { const j = await (await fetch(endpoint + '/identity', { signal: AbortSignal.timeout(6000) })).json(); address = j.payload?.solana?.public_key || null; } catch {} }
  if (address) break;
  await new Promise((x) => setTimeout(x, 15000));
}
console.log(JSON.stringify({ stage: 'identity', deploymentId: dep, endpoint, address }));
if (address) {
  try {
    const { stdout } = await run(process.execPath, [path.join(RUNTIME_DIR, 'bin', 'fund-child.mjs'), address, process.env.AGENT_ENDOW_LAMPORTS || '80000000'], { cwd: RUNTIME_DIR, timeout: 180000 });
    console.log(stdout.trim().split('\n').pop());
  } catch (e) { console.log(JSON.stringify({ stage: 'fund_error', err: String(e.message || e).slice(0, 120) })); }
}
