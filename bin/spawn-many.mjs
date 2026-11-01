// Spawn N children on the current image, endow each, print birth + wallet + endpoint.
// usage: node bin/spawn-many.mjs <count> [sol_per_child]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { RUNTIME_DIR } from '../lib/paths.mjs';
import * as S from '../lib/signer-client.mjs';
import * as E from '../lib/lease-evm.mjs';
import * as A from './agentgates-auth.mjs';
import { now } from '../lib/util.mjs';

const run = promisify(execFile);
const N = Number(process.argv[2] || 3);
const SOL = Number(process.argv[3] || 0.05);
const IMG = process.env.AGENT_IMAGE_URL || 'https://files.catbox.moe/vy46mz.tgz';
process.env.AGENT_LEASE_NETWORK = process.env.AGENT_LEASE_NETWORK || 'solana';

const env = {
  AGENT_RUNTIME_DIR: '/app',
  AGENT_BUNDLE_DIR: '/app',
  AGENT_BUNDLE: '1',
  AGENT_BIND: '0.0.0.0',
  AGENT_CLUSTER: 'mainnet-beta',
  RPC_URL: 'https://jarrett-solana-7ba9.mainnet.rpcpool.com/6dee9145-f5c7-466c-854e-edd7464c5ea8',
  AGENT_IMAGE_URL: IMG,
  EARN_MIN_LAUNCH_LAMPORTS: '8000000',
};
const identity = await S.identity();

for (let i = 0; i < N; i++) {
  const cmd = `mkdir -p /app && ([ -f /app/agent.mjs ] || (wget -qO /tmp/i.tgz ${IMG} && tar xzf /tmp/i.tgz -C /app)) && exec sh /app/start.sh`;
  const compose = JSON.stringify({ services: { agent: { image: 'node:22-alpine', restart: 'unless-stopped', ports: ['8787:8787'], environment: env, command: ['sh', '-c', cmd] } } }, null, 2);
  const r = await E.paidPostAuto('/api/compute/deployments', { plan: process.env.AGENT_PLAN || 'compute.starter', hours: Number(process.env.AGENT_LEASE_HOURS || 1), compose, name: `s${i}-${Math.floor(now() / 60)}` }, identity, 'procreation.lease')
    .catch((e) => ({ status: 0, json: { error: String(e.message || e) } }));
  const dep = r.json?.deploymentId || null;
  if (!dep) { console.log(JSON.stringify({ i, status: r.status, err: (r.json?.error || '').slice(0, 70) })); continue; }

  let birth = null, address = null, endpoint = null;
  for (let t = 0; t < 40 && !birth; t++) {
    try {
      const d = (await A.ownerGet('https://agentgates-backend.vercel.app', '/api/compute/deployments/' + dep)).body;
      endpoint = d.endpoint || endpoint;
      if (endpoint) {
        const j = await (await fetch(endpoint + '/identity', { signal: AbortSignal.timeout(6000) })).json();
        birth = j.payload?.birth_id || null;
        address = j.payload?.solana?.public_key || null;
      }
    } catch {}
    if (!birth) await new Promise((x) => setTimeout(x, 15000));
  }
  console.log(JSON.stringify({ i, dep, birth, address, endpoint }));
  if (address) {
    const { stdout } = await run(process.execPath, [path.join(RUNTIME_DIR, 'bin', 'fund-child.mjs'), address, String(Math.round(SOL * 1e9))], { cwd: RUNTIME_DIR, timeout: 120000 })
      .catch((e) => ({ stdout: JSON.stringify({ stage: 'fund_error', err: String(e.message || e).slice(0, 90) }) }));
    console.log(stdout.trim().split('\n').pop());
  }
}
