// Bring every x402compute VPS to a running guest: open :80, install node, drop the bundle, start.
// usage: node bin/vps-fleet.mjs <ip> [ip...]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { now } from '../lib/util.mjs';

const run = promisify(execFile);
const KEY = 'C:/Users/User/birth-image/guest/ssh/id_ed25519';
const BASE_IMG = process.env.AGENT_IMAGE_URL || 'https://raw.githubusercontent.com/staccDOTsol/birth-image-runtime/main/child-image.tgz';
// raw.githubusercontent caches hard: without a nonce a redeploy boots the stale bundle.
const IMG = BASE_IMG + (BASE_IMG.includes('?') ? '&' : '?') + 'v=' + Date.now();
const RPC = process.env.RPC_URL || '';
const ips = process.argv.slice(2);

const clean = (c) => c.split(String.fromCharCode(13)).join('');

const ssh = (ip, cmd, timeout = 420000) => run('ssh', [
  '-i', KEY,
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=/dev/null',
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=15',
  'root@' + ip,
  clean(cmd),
], { timeout, maxBuffer: 16 * 1024 * 1024 });

const script = [
  'set -x',
  'iptables -I INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true',
  'ufw allow 80/tcp >/dev/null 2>&1 || true',
  'command -v node >/dev/null 2>&1 || { curl -fsSL https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.xz -o /tmp/n.tar.xz; tar xf /tmp/n.tar.xz -C /usr/local --strip-components=1; }',
  'mkdir -p /app /var/lib/agent',
  'rm -rf /app && mkdir -p /app && curl -fsSL ' + IMG + ' -o /tmp/i.tgz && tar xzf /tmp/i.tgz -C /app',
  'cd /app',
  "pkill -x node >/dev/null 2>&1 || true",
  'sleep 1',
  'setsid env AGENT_RUNTIME_DIR=/app AGENT_BUNDLE_DIR=/app AGENT_BUNDLE=1 AGENT_BIND=0.0.0.0 AGENT_CLUSTER=mainnet-beta AGENT_HTTP_PORT=80 PORT=80 AGENT_GUEST_ROOT=/var/lib/agent AGENT_IMAGE_URL=' + IMG + ' EARN_MIN_LAUNCH_LAMPORTS=8000000 AGENT_SKIP=strategy AGENT_LOOPS=1 RPC_URL=' + RPC + ' sh ./start.sh > /var/log/agent.log 2>&1 < /dev/null &',
  'sleep 8',
  'curl -s -m 3 http://127.0.0.1/identity >/dev/null && echo LOCAL_UP || { echo LOCAL_DOWN; tail -5 /var/log/agent.log; }',
].join('\n');

const out = await Promise.all(ips.map(async (ip) => {
  const t0 = Date.now();
  try {
    const { stdout } = await ssh(ip, script);
    let birth = null;
    for (let i = 0; i < 10 && !birth; i++) {
      try {
        const r = await fetch('http://' + ip + '/identity', { signal: AbortSignal.timeout(6000) });
        if (r.ok) { const j = await r.json(); birth = j.payload?.birth_id || 'unknown'; }
      } catch {}
      if (!birth) await new Promise((x) => setTimeout(x, 5000));
    }
    return { at: now(), ip, ok: !!birth, birth, local: stdout.includes('LOCAL_UP'), seconds: ((Date.now() - t0) / 1000) | 0 };
  } catch (e) {
    return { at: now(), ip, ok: false, err: String(e.stderr || e.message || e).slice(-140), seconds: ((Date.now() - t0) / 1000) | 0 };
  }
}));
for (const r of out) console.log(JSON.stringify(r));
