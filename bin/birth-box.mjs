// Birth a real child: provision a box through the API that actually works, bootstrap the
// agent onto it over SSH, then adopt it into a parent's own book.
// The marketplace lease only takes money and returns 202; this path returns a machine.
// usage: node bin/birth-box.mjs <parent_endpoint> [region]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { listInstances } from './x402-instances.mjs';

const PARENT = process.argv[2] || 'http://140.82.12.62:8082';
const REGION = process.argv[3] || process.env.BIRTH_REGION || 'nyc1';
// DO rejects a key it already has on the account, so every birth gets its own keypair
const uniqueKey = `dist/keys/b-${Date.now()}`;
try { if (!fs.existsSync(uniqueKey)) execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', uniqueKey, '-C', `birth-${Date.now()}`], { stdio: 'ignore' }); } catch {}
const KEY = process.env.BIRTH_SSH_KEY || uniqueKey;
const IMG = process.env.BIRTH_IMAGE || 'https://cdn.jsdelivr.net/gh/staccDOTsol/birth-image-runtime@6b492c518b74f5c2e577ad96ec7d7c0d41bac959/child-image.tgz';
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 540000, ...opts });

const log = (o) => console.log(JSON.stringify(o));

// 1. provision from account credits — no facilitator, no payment verification, and the
// Vultr side has slots now (DO is at its droplet limit, so default to vc2 on Vultr).
let prov;
try {
  prov = sh(process.execPath, ['bin/provision-credits.mjs', process.env.BIRTH_PLAN || 'vc2-1c-1gb', REGION, '24']);
} catch (e) { log({ stage: 'provision', err: String(e.message || e).slice(0, 200) }); process.exit(1); }
const provLines = prov.trim().split('\n');
log({ stage: 'provision', out: provLines[provLines.length - 1].slice(0, 200) });
const provJson = JSON.parse(provLines[provLines.length - 1]);
if (!provJson.ip) { log({ stage: 'abort', why: 'no ip' }); process.exit(1); }
const IP = provJson.ip;
const inst = { id: provJson.id };
const BOXKEY = provJson.key.replace(/\.pub$/, '');
log({ stage: 'up', ip: IP, id: inst.id });

// 3. bootstrap: ship a script and run it (node from the official tarball; apt/nodesource
// proved unreliable on a fresh 1 GB box)
const sshBase = ['-i', BOXKEY, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=25'];
sh('scp', [...sshBase, 'dist/boot.sh', `root@${IP}:/root/boot.sh`]);
const ssh = (cmd) => sh('ssh', [...sshBase, `root@${IP}`, cmd]);
const bootOut = ssh('chmod +x /root/boot.sh; IMG=' + IMG + ' /root/boot.sh');
log({ stage: 'bootstrap', out: String(bootOut).slice(-160) });

// 4. adopt into the parent's book with the newborn's own wallet
const idJson = JSON.parse(ssh('curl -s --max-time 8 http://127.0.0.1/identity'));
const p = idJson.payload || idJson;
const wallet = p.solana.public_key;
const birth = p.birth_id;
const adopt = `curl -s --max-time 30 -X POST ${PARENT}/adopt -H 'content-type: application/json' -d '${JSON.stringify({ deploymentId: inst.id, address: wallet, endpoint: 'http://' + IP, birth_id: birth })}'`;
let adopted;
try { adopted = sh('curl', ['-s', '--max-time', '30', '-X', 'POST', `${PARENT}/adopt`, '-H', 'content-type: application/json', '-d', JSON.stringify({ deploymentId: inst.id, address: wallet, endpoint: 'http://' + IP, birth_id: birth })]); }
catch (e) { adopted = String(e.message).slice(0, 160); }
log({ stage: 'adopted', parent: PARENT, wallet, birth, ip: IP, resp: String(adopted).trim().slice(0, 200) });

// register in the fleet so the board and the funder see it
try {
  const f = 'dist/vps.json';
  const a = JSON.parse(fs.readFileSync(f, 'utf8'));
  const arr = Array.isArray(a) ? a : (a.ips = a.ips || []);
  if (!arr.includes(IP)) { arr.push(IP); fs.writeFileSync(f, JSON.stringify(arr)); }
  execFileSync(process.execPath, ['bin/publish-roots.mjs'], { stdio: 'ignore', timeout: 300000 });
  log({ stage: 'registered', ip: IP, seeds: arr.length });
} catch (e) { log({ stage: 'register-failed', err: String(e.message || e).slice(0, 120) }); }
