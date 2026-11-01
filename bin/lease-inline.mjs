// Lease a child whose guest bundle is embedded in the compose as base64 — no egress, no
// mirrors, no bootstrap fetch. The container decodes, extracts and runs start.sh.
// usage: node bin/lease-inline.mjs [plan]
import fs from 'node:fs';
import * as S from '../lib/signer-client.mjs';
import * as E from '../lib/lease-evm.mjs';
import { now } from '../lib/util.mjs';

const plan = process.argv[2] || process.env.AGENT_PLAN || 'compute.starter';
const tgz = process.env.AGENT_IMAGE_BUNDLE || 'C:/Users/User/birth-image/runtime/dist/child-image.tgz';
const b64 = fs.readFileSync(tgz).toString('base64');
process.env.AGENT_LEASE_NETWORK = process.env.AGENT_LEASE_NETWORK || 'solana';

const compose = `services:
  agent:
    image: node:22-alpine
    restart: unless-stopped
    ports:
      - "8787:8787"
    environment:
      AGENT_RUNTIME_DIR: /app
      AGENT_BUNDLE_DIR: /app
      AGENT_GUEST_ROOT: /var/lib/agent
      AGENT_BUNDLE: "1"
      AGENT_BIND: "0.0.0.0"
      AGENT_CLUSTER: mainnet-beta
      RPC_URL: "https://jarrett-solana-7ba9.mainnet.rpcpool.com/6dee9145-f5c7-466c-854e-edd7464c5ea8"
    command:
      - sh
      - -c
      - |
        mkdir -p /app /var/lib/agent
        base64 -d > /tmp/img.tgz <<'BUNDLE_EOF'
${b64}
BUNDLE_EOF
        tar xzf /tmp/img.tgz -C /app
        exec sh /app/start.sh
`;

const identity = await S.identity();
const r = await E.paidPostAuto('/api/compute/deployments', { plan, hours: 1, compose, name: `birth-inline-${Math.floor(now() / 60)}` }, identity, 'procreation.lease');
console.log(JSON.stringify({ status: r.status, rail: r.rail, dep: r.json?.deploymentId || null, compose_bytes: compose.length, err: (r.json?.error || '').slice(0, 200) }));
