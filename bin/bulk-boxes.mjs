// Provision N boxes from credits and bootstrap each one. Sequential on purpose: each box
// must be verified 4/4 before the next is counted. usage: node bin/bulk-boxes.mjs [n] [plan] [region]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const N = Number(process.argv[2] || 4);
const PLAN = process.argv[3] || 'vc2-1c-1gb';
const REGION = process.argv[4] || 'ewr';
const log = (o) => { const s = JSON.stringify(o); console.log(s); try { fs.appendFileSync('dist/bulk-boxes.log', s + '\n'); } catch {} };
const run = (cmd, args, env = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 480000, env: { ...process.env, ...env } });

const made = [];
for (let i = 0; i < N; i++) {
  let prov;
  try { prov = run(process.execPath, ['bin/provision-credits.mjs', PLAN, REGION, '24']); }
  catch (e) { log({ box: i, stage: 'provision-failed', err: String(e.message || e).slice(0, 120) }); break; }
  const lines = prov.trim().split('\n');
  let j;
  try { j = JSON.parse(lines[lines.length - 1]); } catch { log({ box: i, stage: 'bad-json', out: lines.slice(-1)[0].slice(0, 120) }); break; }
  if (!j.ip) { log({ box: i, stage: 'no-ip', out: lines.slice(-2).join(' | ').slice(0, 200) }); continue; }
  const IP = j.ip, KEY = j.key.replace(/\.pub$/, '');
  const ssh = ['-i', KEY, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=25'];
  let up = '';
  for (let a = 0; a < 4; a++) {
    try {
      run('scp', [...ssh, 'dist/boot.sh', `root@${IP}:/root/boot.sh`]);
      up = run('ssh', [...ssh, `root@${IP}`, 'chmod +x /root/boot.sh; /root/boot.sh']);
      break;
    } catch (e) { up = String(e.message || e).slice(0, 100); await new Promise((r) => setTimeout(r, 20000)); }
  }
  const ok = /80:200\s+8081:200\s+8082:200\s+8083:200/.test(String(up));
  log({ box: i, ip: IP, ok, tail: String(up).trim().split('\n').pop().slice(-60) });
  if (ok) {
    made.push(IP);
    try {
      const f = 'dist/vps.json';
      const a = JSON.parse(fs.readFileSync(f, 'utf8'));
      const arr = Array.isArray(a) ? a : (a.ips = a.ips || []);
      if (!arr.includes(IP)) { arr.push(IP); fs.writeFileSync(f, JSON.stringify(arr)); }
    } catch {}
  }
}
if (made.length) { try { run(process.execPath, ['bin/publish-roots.mjs'], { stdio: 'ignore' }); } catch {} }
log({ stage: 'done', made });
