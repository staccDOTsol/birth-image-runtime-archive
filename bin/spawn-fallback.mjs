// Spawn with provider fallback: agentgates first, and on 503 (capacity) or a failed
// settlement, move to the next provider instead of waiting. One child per run.
// usage: node bin/spawn-fallback.mjs [plan]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { RUNTIME_DIR } from '../lib/paths.mjs';
import * as S from '../lib/signer-client.mjs';
import * as E from '../lib/lease-evm.mjs';
import * as P from '../lib/providers.mjs';
import * as L from '../lib/lease.mjs';
import { compose } from './deploy-child.mjs';
import { now } from '../lib/util.mjs';

const run = promisify(execFile);
const plan = process.argv[2] || 'compute.starter';
const identity = await S.identity();

process.env.AGENT_LEASE_NETWORK = 'solana';
let r = await E.paidPostAuto('/api/compute/deployments', { plan, hours: 1, compose: compose(), name: `birth-${Math.floor(now() / 60)}` }, identity, 'procreation.lease').catch((e) => ({ status: 0, json: { error: String(e.message || e) } }));
console.log(JSON.stringify({ at: now(), provider: 'agentgates', status: r.status, dep: r.json?.deploymentId || null, err: (r.json?.error || '').slice(0, 90) }));

let dep = r.json?.deploymentId || null;
let provider = 'agentgates';

if (!dep) {
  // capacity or settlement failure: try the other providers in order
  for (const p of ['secretvm', 'x402compute', 'agvps']) {
    try {
      const out = p === 'secretvm' ? await P.provisionSecretvm({}) : p === 'x402compute' ? await P.provisionX402Compute({}) : await P.provisionAgvps({});
      console.log(JSON.stringify({ at: now(), provider: p, id: out.id, endpoint: out.endpoint || null }));
      provider = p; dep = out.id; break;
    } catch (e) {
      console.log(JSON.stringify({ at: now(), provider: p, error: String(e.message || e).slice(0, 120) }));
    }
  }
}

if (!dep) { console.log(JSON.stringify({ at: now(), stage: 'no_provider' })); process.exit(1); }

if (provider === 'agentgates') {
  let endpoint = null, address = null;
  for (let i = 0; i < 40; i++) {
    const d = (await L.listDeployments()).find((x) => x.deploymentId === dep);
    if (d?.endpoint) endpoint = d.endpoint;
    if (endpoint && !address) { try { const j = await (await fetch(endpoint + '/identity', { signal: AbortSignal.timeout(6000) })).json(); address = j.payload?.solana?.public_key || null; } catch {} }
    if (address) break;
    await new Promise((x) => setTimeout(x, 15000));
  }
  console.log(JSON.stringify({ at: now(), stage: 'identity', dep, endpoint, address }));
  if (address) {
    try {
      const { stdout } = await run(process.execPath, [path.join(RUNTIME_DIR, 'bin', 'fund-child.mjs'), address, process.env.AGENT_ENDOW_LAMPORTS || '90000000'], { cwd: RUNTIME_DIR, timeout: 180000 });
      console.log(stdout.trim().split('\n').pop());
    } catch (e) { console.log(JSON.stringify({ stage: 'fund_error', err: String(e.message || e).slice(0, 120) })); }
  }
}
