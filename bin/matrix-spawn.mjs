// Spawn across every plan the provider offers, not just starter: capacity (and the 503) is
// per-plan/per-host, so matrixing plans is how the fleet grows past a single-plan cap.
// usage: node bin/matrix-spawn.mjs [maxPerPlan] [solPerChild]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { RUNTIME_DIR } from '../lib/paths.mjs';
import * as S from '../lib/signer-client.mjs';
import * as E from '../lib/lease-evm.mjs';
import * as A from './agentgates-auth.mjs';
import { now } from '../lib/util.mjs';

const run = promisify(execFile);
const perPlan = Number(process.argv[2] || 3);
const SOL = Number(process.argv[3] || 0.06);
const IMG = process.env.AGENT_IMAGE_URL || 'https://raw.githubusercontent.com/staccDOTsol/birth-image-runtime/main/child-image.tgz';
const plans = (process.env.AGENT_PLANS || 'compute.starter,compute.standard,compute.pro').split(',');
process.env.AGENT_LEASE_NETWORK = 'solana';

const env = {
  AGENT_RUNTIME_DIR: '/app', AGENT_BUNDLE_DIR: '/app', AGENT_BUNDLE: '1', AGENT_BIND: '0.0.0.0',
  AGENT_CLUSTER: 'mainnet-beta',
  RPC_URL: 'https://jarrett-solana-7ba9.mainnet.rpcpool.com/6dee9145-f5c7-466c-854e-edd7464c5ea8',
  AGENT_IMAGE_URL: IMG, EARN_MIN_LAUNCH_LAMPORTS: '8000000',
};
const cmd = `mkdir -p /app && ([ -f /app/agent.mjs ] || (wget -qO /tmp/i.tgz ${IMG} && tar xzf /tmp/i.tgz -C /app)) && exec sh /app/start.sh`;
const compose = JSON.stringify({ services: { agent: { image: 'node:22-alpine', restart: 'unless-stopped', ports: ['8787:8787'], environment: env, command: ['sh', '-c', cmd] } } }, null, 2);
const identity = await S.identity();

for (const plan of plans) {
  let fails = 0;
  for (let i = 0; i < perPlan && fails < 2; i++) {
    const r = await E.paidPostAuto('/api/compute/deployments', { plan, hours: 1, compose, name: `${plan.split('.').pop()}-${Math.floor(now() / 60)}` }, identity, 'procreation.lease')
      .catch((e) => ({ status: 0, json: { error: String(e.message || e) } }));
    const dep = r.json?.deploymentId || null;
    console.log(JSON.stringify({ at: now(), plan, i, status: r.status, dep, err: (r.json?.error || '').slice(0, 50) }));
    if (!dep) { fails++; continue; }
    fails = 0;
    let address = null;
    for (let t = 0; t < 24 && !address; t++) {
      try {
        const d = (await A.ownerGet('https://agentgates-backend.vercel.app', '/api/compute/deployments/' + dep)).body;
        if (d.endpoint) {
          const j = await (await fetch(d.endpoint + '/identity', { signal: AbortSignal.timeout(6000) })).json();
          address = j.payload?.solana?.public_key || null;
        }
      } catch {}
      if (!address) await new Promise((x) => setTimeout(x, 12000));
    }
    if (address) {
      const { stdout } = await run(process.execPath, [path.join(RUNTIME_DIR, 'bin', 'fund-child.mjs'), address, String(Math.round(SOL * 1e9))], { cwd: RUNTIME_DIR, timeout: 120000 })
        .catch((e) => ({ stdout: JSON.stringify({ stage: 'fund_error', err: String(e.message || e).slice(0, 80) }) }));
      console.log(stdout.trim().split('\n').pop());
    } else {
      console.log(JSON.stringify({ dep, address: null }));
    }
  }
}
