// Lease N deployments on the rail that provisions (Base), then hand each to a child to adopt:
// the child endows it from its own SOL and writes it into its own children book, which is what
// makes it a generation-2 node rather than another box of mine.
// usage: node bin/gen2-batch.mjs <count> <childUrl>
import * as S from '../lib/signer-client.mjs';
import * as E from '../lib/lease-evm.mjs';
import * as A from './agentgates-auth.mjs';
import { now } from '../lib/util.mjs';

const COUNT = Number(process.argv[2] || 2);
const CHILD = (process.argv[3] || 'http://140.82.12.62').replace(/\/$/, '');
const IMG = process.env.AGENT_IMAGE_URL || 'https://cdn.jsdelivr.net/gh/staccDOTsol/birth-image-runtime@a377bd5cf7bd46a19aa22a496e3fe325e06437e3/child-image.tgz';

const compose = (tag) => JSON.stringify({ services: { agent: { image: 'node:22-alpine', restart: 'unless-stopped', ports: ['8787:8787'],
  environment: { AGENT_RUNTIME_DIR: '/app', AGENT_BUNDLE_DIR: '/app', AGENT_BUNDLE: '1', AGENT_BIND: '0.0.0.0', AGENT_CLUSTER: 'mainnet-beta', AGENT_IMAGE_URL: IMG, EARN_MIN_LAUNCH_LAMPORTS: '8000000' },
  command: ['sh', '-c', `mkdir -p /app && ([ -f /app/agent.mjs ] || (wget -qO /tmp/i.tgz ${IMG} && tar xzf /tmp/i.tgz -C /app)) && exec sh /app/start.sh`] } } }, null, 2);

const id = await S.identity();
process.env.AGENT_LEASE_NETWORK = 'base';
const made = [];

for (let i = 0; i < COUNT; i++) {
  const r = await E.paidPostAuto('/api/compute/deployments', { plan: 'compute.starter', hours: 1, compose: compose(i), name: `g2-${now()}-${i}` }, id, 'procreation.lease')
    .catch((e) => ({ status: 0, json: { error: String(e.message || e) } }));
  const dep = r.json?.deploymentId || null;
  if (!dep) { console.log(JSON.stringify({ i, status: r.status, err: (r.json?.error || '').slice(0, 60) })); continue; }

  let endpoint = null, address = null, birth = null;
  for (let t = 0; t < 20 && !address; t++) {
    const d = (await A.ownerGet('https://agentgates-backend.vercel.app', '/api/compute/deployments/' + dep).catch(() => ({ body: {} }))).body;
    endpoint = d?.endpoint || endpoint;
    if (endpoint) {
      try {
        const j = await (await fetch(endpoint + '/identity', { signal: AbortSignal.timeout(8000) })).json();
        address = j.payload?.solana?.public_key || null;
        birth = j.payload?.birth_id || null;
      } catch {}
    }
    if (!address) await new Promise((s) => setTimeout(s, 6000));
  }

  let adopted = null;
  if (address) {
    adopted = await fetch(CHILD + '/adopt', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deploymentId: dep, address, endpoint, birth_id: birth }),
    }).then(async (x) => ({ status: x.status, body: (await x.text()).slice(0, 120) })).catch((e) => ({ status: 0, err: String(e.message).slice(0, 60) }));
  }
  made.push({ dep, endpoint, address, birth, adopted });
  console.log(JSON.stringify({ i, dep, birth, endpoint: endpoint ? endpoint.slice(0, 40) : null, adopted: adopted?.status }));
}
console.log(JSON.stringify({ kind: 'gen2_batch', made: made.length, child: CHILD }));
