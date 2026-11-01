// Deploy the guest onto x402compute VPS instances over SSH. Non-TEE rail, used to grow the fleet
// past the provider that caps at 5. Idempotent: skips a box that already answers /identity.
// usage: node bin/vps-deploy.mjs <ip> [ip...]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import { RUNTIME_DIR } from '../lib/paths.mjs';
import { now } from '../lib/util.mjs';

const run = promisify(execFile);
const KEY = process.env.AGENT_SSH_KEY || 'C:/Users/User/birth-image/guest/ssh/id_ed25519';
const IMG = process.env.AGENT_IMAGE_URL || 'https://raw.githubusercontent.com/staccDOTsol/birth-image-runtime/main/child-image.tgz';
const ips = process.argv.slice(2);
if (!ips.length) { console.error('usage: node bin/vps-deploy.mjs <ip> [ip...]'); process.exit(1); }

const ssh = (ip, cmd, timeout = 240000) => run('ssh', [
  '-i', KEY, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null',
  '-o', 'ConnectTimeout=15', '-o', 'BatchMode=yes', `root@${ip}`, cmd,
], { timeout, maxBuffer: 8 * 1024 * 1024 });

const bootstrap = `
set -e
if curl -s -m 4 http://127.0.0.1/identity >/dev/null 2>&1; then echo ALREADY; exit 0; fi
export DEBIAN_FRONTEND=noninteractive
command -v node >/dev/null 2>&1 || {
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq >/dev/null 2>&1 || true
    apt-get install -y -qq curl xz-utils ca-certificates >/dev/null 2>&1 || true
  fi
  curl -fsSL https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.xz -o /tmp/n.tar.xz
  tar xf /tmp/n.tar.xz -C /usr/local --strip-components=1
}
mkdir -p /app /var/lib/agent
[ -f /app/agent.mjs ] || { curl -fsSL ${IMG} -o /tmp/i.tgz && tar xzf /tmp/i.tgz -C /app; }
cd /app
pkill -f 'agent.mjs' >/dev/null 2>&1 || true
AGENT_RUNTIME_DIR=/app AGENT_BUNDLE_DIR=/app AGENT_BUNDLE=1 AGENT_BIND=0.0.0.0 \
AGENT_CLUSTER=mainnet-beta AGENT_HTTP_PORT=80 PORT=80 AGENT_GUEST_ROOT=/var/lib/agent \
AGENT_IMAGE_URL=${IMG} EARN_MIN_LAUNCH_LAMPORTS=8000000 \
RPC_URL="${process.env.RPC_URL || ''}" \
nohup sh ./start.sh > /var/log/agent.log 2>&1 &
sleep 2
echo STARTED
`;

const results = await Promise.all(ips.map(async (ip) => {
  const started = Date.now();
  try {
    const { stdout } = await ssh(ip, bootstrap);
    let up = false, birth = null;
    for (let i = 0; i < 10 && !up; i++) {
      try {
        const r = await fetch(`http://${ip}/identity`, { signal: AbortSignal.timeout(6000) });
        if (r.ok) { const j = await r.json(); up = true; birth = j.payload?.birth_id || null; }
      } catch {}
      if (!up) await new Promise((x) => setTimeout(x, 6000));
    }
    return { at: now(), ip, ok: true, up, birth, tail: stdout.trim().slice(-40), seconds: ((Date.now() - started) / 1000) | 0 };
  } catch (e) {
    return { at: now(), ip, ok: false, err: String(e.message || e).slice(0, 120), seconds: ((Date.now() - started) / 1000) | 0 };
  }
}));
for (const r of results) console.log(JSON.stringify(r));
