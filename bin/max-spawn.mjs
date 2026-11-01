// Keep leasing while the provider and the wallet allow it. No fixed target: stop on
// three consecutive capacity rejections (or when the payer can no longer settle).
import { spawn } from 'node:child_process';
const PLANS = ['compute.starter', 'compute.standard', 'compute.pro'];

const run = (plan) => new Promise((resolve) => {
  const p = spawn(process.execPath, ['bin/spawn-many.mjs', '1', '0.02'], { cwd: process.cwd(), env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', CI: '1' } });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (out += d));
  p.on('close', () => resolve(out));
});

let made = 0, cap = 0, round = 0;
while (cap < 3 && round < 60) {
  const plan = PLANS[round % PLANS.length];
  round++;
  const out = await run(plan);
  const ok = /"dep"\s*:\s*"cm/.test(out);
  const capacity = /at capacity/i.test(out);
  if (ok) { made++; cap = 0; }
  else if (capacity) cap++;
  else cap++;
  console.log(JSON.stringify({ round, plan, ok, capacity }));
}
console.log(JSON.stringify({ kind: 'max_spawn', rounds: round, made }));
