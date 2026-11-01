// Keep the fleet alive: extend any active instance that expires within WINDOW_H hours.
// Runs unattended; each extension is a real x402 payment, so it stops when USDC runs out.
import { execFileSync } from 'node:child_process';
import { listInstances } from './x402-instances.mjs';

const WINDOW_H = Number(process.env.KEEPALIVE_WINDOW_H || 12);
const HOURS = Number(process.env.KEEPALIVE_EXTEND_H || 24);

const now = Date.now();
const list = await listInstances();
const active = list.filter((i) => i.status === 'active' && i.ip_address && i.ip_address !== 'pending');
const due = active.filter((i) => {
  const t = Date.parse(i.expires_at);
  return Number.isFinite(t) && (t - now) / 3.6e6 < WINDOW_H;
});

const out = [];
for (const i of due) {
  try {
    const r = execFileSync(process.execPath, ['bin/x402-extend.mjs', i.id, String(HOURS)], { encoding: 'utf8' });
    out.push({ ip: i.ip_address, ok: true, tail: r.trim().split('\n').pop().slice(0, 140) });
  } catch (e) {
    out.push({ ip: i.ip_address, ok: false, err: String(e.message || e).slice(0, 90) });
  }
}
console.log(JSON.stringify({ at: new Date().toISOString(), active: active.length, due: due.length, extended: out.filter((x) => x.ok).length, out }));
