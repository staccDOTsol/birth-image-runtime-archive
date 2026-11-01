// Pull birth requests off every box and build them here, where provisioning and SSH are known
// to work. A child that cannot get a machine from the marketplace writes one line into its
// birth-queue.jsonl; this turns that line into a real box and adopts it under that child.
//   node bin/queue-worker.mjs [--dry]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const BOXES = [
  ['45.77.217.220', 'C:/Users/User/birth-image/guest/ssh/id_ed25519'],
  ['140.82.12.62', 'C:/Users/User/birth-image/guest/ssh/id_ed25519'],
  ['208.167.239.159', 'dist/keys/c-1793484042772'],
  ['140.82.12.110', 'dist/keys/c-1793484037275'],
  ['66.135.12.180', 'dist/keys/c-1793486839805'],
  ['45.76.9.150', 'C:/Users/User/birth-image/guest/ssh/id_ed25519'],
  ['64.176.200.214', 'C:/Users/User/birth-image/guest/ssh/id_ed25519'],
  ['64.176.200.115', 'dist/keys/c-1793488751859'],
];
const DRY = process.argv.includes('--dry');
const log = (o) => { const s = JSON.stringify(o); console.log(s); try { fs.appendFileSync('dist/queue-worker.log', s + '\n'); } catch {} };
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000, ...opts });
const ssh = (ip, key, cmd) => sh('ssh', ['-i', key, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', `root@${ip}`, cmd]);

let made = 0;
for (const [ip, key] of BOXES) {
  let lines = [];
  try { lines = ssh(ip, key, "cat /var/lib/agent*/var/lib/agent/birth-queue.jsonl 2>/dev/null").trim().split('\n').filter(Boolean); }
  catch { continue; }
  if (!lines.length) continue;
  for (const line of lines.slice(0, 3)) {           // bounded per tick
    let req; try { req = JSON.parse(line); } catch { continue; }
    const port = String(req.port || '80');
    const parent = req.parent;
    log({ ip, port, parent: String(parent).slice(0, 8), stage: 'building' });
    if (DRY) continue;
    const PLANS = [['vc2-1c-2gb', 'ewr'], ['do:s-2vcpu-2gb', 'nyc3'], ['do:s-1vcpu-2gb', 'nyc3']];
    let j = {};
    for (const [plan, region] of PLANS) {
      let out;
      try { out = sh(process.execPath, ['bin/provision-credits.mjs', plan, region, '24']); }
      catch (e) { out = String(e.stdout || e.message || ''); }
      try { j = JSON.parse(out.trim().split('\n').pop() || '{}'); } catch { j = {}; }
      if (j.ip) { log({ stage: 'provisioned', plan, ip: j.ip }); break; }
      log({ stage: 'plan-failed', plan, out: String(out).slice(-90) });
    }
    if (!j.ip) { log({ ip, stage: 'provision-failed', tried: PLANS.length }); continue; }
    const IP = j.ip, BKEY = j.key;
    let up = '';
    for (let a = 0; a < 4; a++) {
      try {
        sh('scp', ['-i', BKEY, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'BatchMode=yes', 'dist/boot.sh', `root@${IP}:/root/boot.sh`]);
        up = sh('ssh', ['-i', BKEY, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'BatchMode=yes', `root@${IP}`, 'chmod +x /root/boot.sh; /root/boot.sh']);
        if (/8083:200/.test(up)) break;
      } catch (e) { up = String(e.message || e).slice(0, 80); await new Promise((r) => setTimeout(r, 25000)); }
    }
    const ok = /8083:200/.test(up);
    let addr = '';
    try { addr = (await (await fetch(`http://${IP}/identity`, { signal: AbortSignal.timeout(6000) })).text()).match(/"public_key":\s*"([1-9A-HJ-NP-Za-km-z]{32,44})"/)?.[1] || ''; } catch {}
    if (ok) {
      try {
        ssh(ip, key, `curl -s --max-time 20 -X POST http://127.0.0.1:${port}/adopt -H 'content-type: application/json' -d '${JSON.stringify({ deploymentId: j.id || null, address: addr, endpoint: `http://${IP}` })}'`);
      } catch (e) { log({ ip, stage: 'adopt-failed', err: String(e.message || e).slice(0, 80) }); }
      try {
        const f = 'dist/vps.json';
        const a2 = JSON.parse(fs.readFileSync(f, 'utf8'));
        const arr = Array.isArray(a2) ? a2 : (a2.ips = a2.ips || []);
        if (!arr.includes(IP)) { arr.push(IP); fs.writeFileSync(f, JSON.stringify(arr)); }
      } catch {}
      made++;
      log({ ip, port, stage: 'born', child_ip: IP, parent_wallet: String(parent).slice(0, 8), address: addr.slice(0, 8) });
    } else {
      log({ ip, stage: 'boot-failed', child_ip: IP, up: String(up).slice(-60) });
    }
  }
  if (made > 0) { try { ssh(ip, key, 'rm -f /var/lib/agent*/var/lib/agent/birth-queue.jsonl'); } catch {} }
}
if (made) { try { sh(process.execPath, ['bin/publish-roots.mjs']); } catch {} }
log({ stage: 'done', born: made });
