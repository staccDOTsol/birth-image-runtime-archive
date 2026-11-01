// Wait for the newest non-destroyed deployment to answer /status, then endow it.
// Prints one line per state change and exits as soon as the child is LIVE and funded.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { RUNTIME_DIR } from '../lib/paths.mjs';
import * as A from './agentgates-auth.mjs';
import * as L from '../lib/lease.mjs';
import { now } from '../lib/util.mjs';

const run = promisify(execFile);
const deadline = Date.now() + Number(process.env.WAIT_MINUTES || 9) * 60_000;
let last = '';

while (Date.now() < deadline) {
  const live = (await L.listDeployments()).filter((x) => x.status !== 'destroyed');
  for (const d of live) {
    let state = d.status;
    let body = null;
    if (d.endpoint) {
      try {
        const r = await fetch(d.endpoint + '/status', { signal: AbortSignal.timeout(6000) });
        if (r.status === 200) { body = await r.json(); state = 'LIVE'; }
        else state = 'http' + r.status;
      } catch { state = 'dead'; }
    }
    const line = `${d.deploymentId.slice(0, 9)} ${state}`;
    if (line !== last) { console.log(JSON.stringify({ at: now(), ...{ id: d.deploymentId, state } })); last = line; }
    if (state === 'LIVE' && body) {
      const addr = body.solana;
      console.log(JSON.stringify({ at: now(), stage: 'live', id: d.deploymentId, endpoint: d.endpoint, solana: addr, credits: body.inference?.credits_usd, tools: body.last_decision?.tools || [] }));
      if (addr && !process.env.SKIP_FUND) {
        try {
          const { stdout } = await run(process.execPath, [path.join(RUNTIME_DIR, 'bin', 'fund-child.mjs'), addr, process.env.AGENT_ENDOW_LAMPORTS || '90000000'], { cwd: RUNTIME_DIR, timeout: 180000 });
          console.log(stdout.trim().split('\n').pop());
        } catch (e) { console.log(JSON.stringify({ stage: 'fund_error', err: String(e.message || e).slice(0, 120) })); }
      }
      process.exit(0);
    }
  }
  await new Promise((r) => setTimeout(r, 15000));
}
console.log(JSON.stringify({ at: now(), stage: 'timeout' }));
process.exit(1);
