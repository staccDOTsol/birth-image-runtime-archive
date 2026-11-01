// Back up every agent's sealed key material to this machine. When a box dies, the only copy
// of its wallet used to die with it — that is how 3.7 SOL got stranded on four dead boxes.
// Copies land in dist/keys-backup/<ip>-<port>/ and are refreshed on every run.
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
const log = (o) => console.log(JSON.stringify(o));
let saved = 0;
for (const [ip, key] of BOXES) {
  for (const port of ['80', '8081', '8082', '8083']) {
    const root = port === '80' ? '/var/lib/agent' : `/var/lib/agent-${port}`;
    const dir = `dist/keys-backup/${ip}-${port}`;
    try {
      const out = execFileSync('ssh', ['-i', key, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', `root@${ip}`,
        `cd ${root}/var/lib/agent 2>/dev/null && tar czf - sealed-keys.enc seal.key identity.log 2>/dev/null | base64 -w0`], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      if (!out) continue;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${dir}/keys-${Date.now()}.tgz.b64`, out);
      saved++;
    } catch {}
  }
}
log({ stage: 'backup', copies: saved, at: new Date().toISOString() });
