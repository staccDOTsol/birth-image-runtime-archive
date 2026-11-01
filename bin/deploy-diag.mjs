// Diagnostic deploy: same guest, but boot output is posted to a public topic we can read,
// so a container that never listens still tells us why. usage: node bin/deploy-diag.mjs
import * as S from '../lib/signer-client.mjs';
import * as R from '../lib/rpc.mjs';
import * as E from '../lib/lease-evm.mjs';
import { now } from '../lib/util.mjs';

const TOPIC = process.env.DIAG_TOPIC || `birth-${Math.random().toString(36).slice(2, 8)}`;
const IMG = process.env.AGENT_IMAGE_URL || 'https://raw.githubusercontent.com/staccDOTsol/birth-image-runtime/main/child-image.tgz';
const logUrl = `https://ntfy.sh/${TOPIC}`;

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
      AGENT_HTTP_PORT: "8787"
      AGENT_BIND: "0.0.0.0"
      AGENT_CLUSTER: mainnet-beta
      RPC_URL: "${R.RPC_URL}"
    command:
      - sh
      - -c
      - |
        set -x
        mkdir -p /app /var/lib/agent
        ok=0
        for u in "${IMG}"; do
          if wget -qO /tmp/img.tgz "$u" && tar xzf /tmp/img.tgz -C /app; then ok=1; break; fi
          sleep 3
        done
        echo "download_ok=$ok" > /tmp/diag.log
        ls -la /app >> /tmp/diag.log 2>&1
        ( cd /app && AGENT_ROLE=boot node /app/agent.mjs ) >> /tmp/diag.log 2>&1
        echo "boot_exit=$?" >> /tmp/diag.log
        tail -c 4000 /tmp/diag.log | wget -qO /dev/null --post-file=/tmp/diag.log "${logUrl}" || true
        while true; do env AGENT_ROLE=watchdog node /app/agent.mjs >> /tmp/diag.log 2>&1; echo "watchdog_exit=$?" >> /tmp/diag.log; sleep 5; done
`;

const identity = await S.identity();
const r = await E.paidPostAuto('/api/compute/deployments', { plan: process.env.AGENT_PLAN || 'compute.standard', hours: 1, compose, name: `birth-diag-${Math.floor(now() / 60)}` }, identity, 'procreation.diag');
console.log(JSON.stringify({ topic: TOPIC, logUrl, status: r.status, rail: r.rail, deploymentId: r.json?.deploymentId || null, err: (r.json?.error || '').slice(0, 140) }));
