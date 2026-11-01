// Diagnostic deploy #2: an inline HTTP server owns :8787 and serves /tmp/diag.log, while the
// agent runs on :8788. A container that never boots still answers, so the boot log is readable
// from the deployment endpoint. usage: node bin/deploy-diag2.mjs
import * as S from '../lib/signer-client.mjs';
import * as R from '../lib/rpc.mjs';
import * as E from '../lib/lease-evm.mjs';
import { compose as realCompose } from './deploy-child.mjs';
import { now } from '../lib/util.mjs';

process.env.AGENT_LEASE_NETWORK = process.env.AGENT_LEASE_NETWORK || 'solana';
const IMG = process.env.AGENT_IMAGE_URL || 'https://files.catbox.moe/aw9qmo.tgz';

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
      AGENT_HTTP_PORT: "8788"
      AGENT_BIND: "0.0.0.0"
      AGENT_CLUSTER: mainnet-beta
      RPC_URL: "${R.RPC_URL}"
    command:
      - sh
      - -c
      - |
        echo "start $(date -u)" > /tmp/diag.log
        node -e 'require("http").createServer((q,r)=>{require("fs").readFile("/tmp/diag.log",(e,d)=>{r.writeHead(200,{"content-type":"text/plain"});r.end(d||"")})}).listen(8787,"0.0.0.0")' >> /tmp/diag.log 2>&1 &
        mkdir -p /app /var/lib/agent
        for u in "${IMG}" "https://raw.githubusercontent.com/staccDOTsol/birth-image-runtime/main/child-image.tgz"; do
          echo "fetch $u" >> /tmp/diag.log
          if wget -qO /tmp/img.tgz "$u"; then echo "downloaded $(wc -c < /tmp/img.tgz) bytes" >> /tmp/diag.log; tar xzf /tmp/img.tgz -C /app >> /tmp/diag.log 2>&1 && echo "extracted: $(ls /app)" >> /tmp/diag.log && break; fi
          sleep 3
        done
        cd /app && AGENT_ROLE=boot node /app/agent.mjs >> /tmp/diag.log 2>&1
        echo "boot_exit=$?" >> /tmp/diag.log
        while true; do env AGENT_ROLE=watchdog node /app/agent.mjs >> /tmp/diag.log 2>&1; echo "watchdog_exit=$?" >> /tmp/diag.log; sleep 5; done
`;

const identity = await S.identity();
const r = await E.paidPostAuto('/api/compute/deployments', { plan: process.env.AGENT_PLAN || 'compute.standard', hours: 1, compose, name: `birth-diag2-${Math.floor(now() / 60)}` }, identity, 'procreation.diag');
console.log(JSON.stringify({ status: r.status, rail: r.rail, body: r.json }));
