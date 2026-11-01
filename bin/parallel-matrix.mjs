// Fire every provisioning rail at once and report whatever answers. Whatever comes up gets funded
// by the caller; this script only races the providers.
// usage: node bin/parallel-matrix.mjs
import * as P from '../lib/providers.mjs';
import * as S from '../lib/signer-client.mjs';
import * as E from '../lib/lease-evm.mjs';
import { now } from '../lib/util.mjs';

const IMG = process.env.AGENT_IMAGE_URL || 'https://raw.githubusercontent.com/staccDOTsol/birth-image-runtime/main/child-image.tgz';
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

const jobs = [];
for (const plan of ['compute.starter', 'compute.standard', 'compute.pro']) {
  jobs.push(['agentgates:' + plan, () => E.paidPostAuto('/api/compute/deployments', { plan, hours: 1, compose, name: `pm-${plan.split('.')[1]}-${Math.floor(now() / 60)}` }, identity, 'procreation.lease').then((r) => ({ status: r.status, id: r.json?.deploymentId, err: r.json?.error }))]);
}
jobs.push(['secretvm', () => P.provisionSecretvm({})]);
jobs.push(['x402compute', () => P.provisionX402Compute({})]);
jobs.push(['agvps', () => P.provisionAgvps({})]);

const results = await Promise.all(jobs.map(async ([name, fn]) => {
  const started = Date.now();
  try { const r = await fn(); return { name, ok: !!(r?.id || r?.deploymentId), seconds: ((Date.now() - started) / 1000) | 0, r }; }
  catch (e) { return { name, ok: false, seconds: ((Date.now() - started) / 1000) | 0, err: String(e.message || e).slice(0, 120) }; }
}));

for (const r of results) console.log(JSON.stringify(r).slice(0, 300));
console.log(JSON.stringify({ at: now(), up: results.filter((r) => r.ok).map((r) => r.name) }));
