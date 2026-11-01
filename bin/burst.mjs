// Burst-lease several children at once, then fund them as they answer. Parallel leases keep the
// provisioning latency overlapped instead of serialised behind each identity wait.
// usage: node bin/burst.mjs <count> <plan> [solPerChild]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { RUNTIME_DIR } from '../lib/paths.mjs';
import * as S from '../lib/signer-client.mjs';
import * as E from '../lib/lease-evm.mjs';
import * as A from './agentgates-auth.mjs';
import { now } from '../lib/util.mjs';

const run = promisify(execFile);
const N = Number(process.argv[2] || 4);
const plan = process.argv[3] || 'compute.starter';
const SOL = Number(process.argv[4] || 0.06);
const IMG = process.env.AGENT_IMAGE_URL || 'https://raw.githubusercontent.com/staccDOTsol/birth-image-runtime/main/child-image.tgz';
process.env.AGENT_LEASE_NETWORK = process.env.AGENT_LEASE_NETWORK || 'solana';

const env = {
  AGENT_RUNTIME_DIR: '/app', AGENT_BUNDLE_DIR: '/app', AGENT_BUNDLE: '1', AGENT_BIND: '0.0.0.0',
  AGENT_CLUSTER: 'mainnet-beta',
  RPC_URL: 'https://jarrett-solana-7ba9.mainnet.rpcpool.com/6dee9145-f5c7-466c-854e-edd7464c5ea8',
  AGENT_IMAGE_URL: IMG, EARN_MIN_LAUNCH_LAMPORTS: '8000000',
};
const cmd = `mkdir -p /app && ([ -f /app/agent.mjs ] || (wget -qO /tmp/i.tgz ${IMG} && tar xzf /tmp/i.tgz -C /app)) && exec sh /app/start.sh`;
const compose = JSON.stringify({ services: { agent: { image: 'node:22-alpine', restart: 'unless-stopped', ports: ['8787:8787'], environment: env, command: ['sh', '-c', cmd] } } }, null, 2);
const identity = await S.identity();

const leased = await Promise.all(Array.from({ length: N }, async (_, i) => {
  const r = await E.paidPostAuto('/api/compute/deployments', { plan, hours: 1, compose, name: `b${i}-${Math.floor(now() / 60)}` }, identity, 'procreation.lease')
    .catch((e) => ({ status: 0, json: { error: String(e.message || e) } }));
  return { i, status: r.status, dep: r.json?.deploymentId || null, err: (r.json?.error || '').slice(0, 50) };
}));
console.log(JSON.stringify({ leased: leased.map((x) => [x.i, x.status, x.dep]) }));

for (const l of leased) {
  if (!l.dep) continue;
  let address = null;
  for (let t = 0; t < 20 && !address; t++) {
    try {
      const d = (await A.ownerGet('https://agentgates-backend.vercel.app', '/api/compute/deployments/' + l.dep)).body;
      if (d.endpoint) {
        const j = await (await fetch(d.endpoint + '/identity', { signal: AbortSignal.timeout(6000) })).json();
        address = j.payload?.solana?.public_key || null;
        if (address) console.log(JSON.stringify({ dep: l.dep, birth: j.payload?.birth_id || null, address, endpoint: d.endpoint }));
      }
    } catch {}
    if (!address) await new Promise((x) => setTimeout(x, 10000));
  }
  if (address) {
    const { stdout } = await run(process.execPath, [path.join(RUNTIME_DIR, 'bin', 'fund-child.mjs'), address, String(Math.round(SOL * 1e9))], { cwd: RUNTIME_DIR, timeout: 120000 })
      .catch((e) => ({ stdout: JSON.stringify({ stage: 'fund_error', err: String(e.message || e).slice(0, 80) }) }));
    console.log(stdout.trim().split('\n').pop());
  } else {
    console.log(JSON.stringify({ dep: l.dep, address: null }));
  }
}
