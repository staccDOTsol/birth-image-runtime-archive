// Lease until a slot opens, then endow and report. Capacity comes and goes by the minute,
// so this retries the cheap quote first and only pays when a 202 is actually accepted.
// usage: node bin/lease-until-ready.mjs [plan] [minutes]
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
const plan = process.argv[2] || 'compute.standard';
const minutes = Number(process.argv[3] || 30);
const deadline = Date.now() + minutes * 60_000;
process.env.AGENT_LEASE_NETWORK = 'solana';
const identity = await S.identity();

while (Date.now() < deadline) {
  const r = await E.paidPostAuto('/api/compute/deployments', { plan, hours: 1, compose: compose(), name: `birth-child-${Math.floor(now() / 60)}` }, identity, 'procreation.lease').catch((e) => ({ status: 0, json: { error: String(e.message || e).slice(0, 100) } }));
  const dep = r.json?.deploymentId || r.json?.id || null;
  console.log(JSON.stringify({ at: now(), plan, status: r.status, deploymentId: dep, err: (r.json?.error || '').slice(0, 80) }));
  if (dep) {
    let endpoint = null, address = null;
    for (let i = 0; i < 60; i++) {
      const d = (await L.listDeployments()).find((x) => x.deploymentId === dep);
      if (d?.endpoint) endpoint = d.endpoint;
      if (endpoint && !address) { try { const j = await (await fetch(endpoint + '/identity', { signal: AbortSignal.timeout(6000) })).json(); address = j.payload?.solana?.public_key || null; } catch {} }
      if (address) break;
      await new Promise((x) => setTimeout(x, 15000));
    }
    console.log(JSON.stringify({ at: now(), stage: 'identity', deploymentId: dep, endpoint, address }));
    if (address) {
      try {
        const { stdout } = await run(process.execPath, [path.join(RUNTIME_DIR, 'bin', 'fund-child.mjs'), address, process.env.AGENT_ENDOW_LAMPORTS || '90000000'], { cwd: RUNTIME_DIR, timeout: 180000 });
        console.log(stdout.trim().split('\n').pop());
      } catch (e) { console.log(JSON.stringify({ stage: 'fund_error', err: String(e.message || e).slice(0, 120) })); }
    }
    process.exit(0);
  }
  await new Promise((x) => setTimeout(x, 20000));
}
console.log(JSON.stringify({ at: now(), stage: 'deadline', plan }));
process.exit(1);
