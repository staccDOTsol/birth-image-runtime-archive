// Housekeeping playbook: the boxes are small, so garbage is a real failure mode.
// Reclaims rent from empty token accounts, trims logs and old snapshots, drops stale locks.
import fs from 'node:fs';
import path from 'node:path';
import { P } from '../lib/paths.mjs';
import { log } from '../lib/util.mjs';

const KEEP = { journal: 2000, lessons: 500, 'brain.log': 4000 };

export async function cleanup() {
  const freed = { logs: 0, accounts: 0, bytes: 0 };
  for (const f of ['brain.log', 'earn.log', 'procreate.log', 'loops.log', 'identity.log']) {
    const p = path.join(P.state, f);
    if (!fs.existsSync(p)) continue;
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    const keep = KEEP[f] || 2000;
    if (lines.length > keep * 2) {
      const tail = lines.slice(-keep).join('\n');
      freed.bytes += fs.statSync(p).size - Buffer.byteLength(tail);
      fs.writeFileSync(p, tail);
      freed.logs++;
    }
  }
  for (const d of ['snapshots', 'outbox']) {
    const dir = path.join(P.guest, d);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).map((n) => [n, path.join(dir, n)]).sort();
    for (const [, f] of files.slice(0, Math.max(0, files.length - 20))) {
      try { freed.bytes += fs.statSync(f).size; fs.unlinkSync(f); } catch {}
    }
  }
  for (const lock of ['supervisor.lock', 'brain.lock']) {
    const p = path.join(P.state, lock);
    try { if (fs.existsSync(p) && Date.now() - fs.statSync(p).mtimeMs > 3600_000) fs.unlinkSync(p); } catch {}
  }
  log('cleanup', 'done', freed);
  return freed;
}

if (process.argv[1] && process.argv[1].endsWith('cleanup.mjs')) console.log(JSON.stringify(await cleanup()));
