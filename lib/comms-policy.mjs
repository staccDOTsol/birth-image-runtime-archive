// Comms is the agent's own choice: how often, and to whom. The only default is a floor —
// at least one message per loop — and even that can be turned down, not off, unless it says so.
import fs from 'node:fs';
const base = () => process.env.AGENT_GUEST_ROOT || '/var/lib/agent';
const path = () => base() + '/var/lib/agent/comms.json';

const DEFAULTS = { cadence_s: 240, audience: 'all', peers: [], floor_per_loop: true, quiet: false };

export function load() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(path(), 'utf8')) }; } catch { return { ...DEFAULTS }; }
}
export function save(patch) {
  const next = { ...load(), ...patch };
  fs.mkdirSync(base() + '/var/lib/agent', { recursive: true });
  fs.writeFileSync(path(), JSON.stringify(next, null, 1), { mode: 0o600 });
  return next;
}
export function shouldSpeak(lastAt, nowSec, spokeThisLoop) {
  const p = load();
  if (p.quiet && p.audience === 'none') return false;
  if (p.floor_per_loop && !spokeThisLoop) return true;
  return nowSec - Number(lastAt || 0) >= Number(p.cadence_s || 240);
}
// who receives a sealed message when the agent says "whoever I talk to"
export function audience() { return load().audience; }
