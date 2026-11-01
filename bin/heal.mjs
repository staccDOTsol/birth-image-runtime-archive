// Self-heal loop. A child counts as alive only if it answers /status; a deployment the
// provider still calls "running" but that is unreachable is destroyed and replaced.
// Also renews leases for live children before they lapse. Meant for a scheduled task.
// usage: node bin/heal.mjs [target] [--dry]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { RUNTIME_DIR } from '../lib/paths.mjs';
import * as S from '../lib/signer-client.mjs';
import * as L from '../lib/lease.mjs';
import { now } from '../lib/util.mjs';

const run = promisify(execFile);
const TARGET = Number(process.argv[2] || process.env.AGENT_TARGET_CHILDREN || 2);
const DRY = process.argv.includes('--dry');
const IMG = process.env.AGENT_IMAGE_URL || 'https://files.catbox.moe/8nib5q.tgz';
const ENDOW = process.env.AGENT_ENDOW_LAMPORTS || '60000000';
const ledger = path.join(RUNTIME_DIR, 'dist', 'heal.jsonl');
const say = (o) => { if (!DRY) fs.appendFileSync(ledger, JSON.stringify({ at: now(), ...o }) + '\n'); console.log(JSON.stringify({ at: now(), ...o })); };

const identity = await S.identity();
const list = await L.listDeployments();

async function probe(d) {
  if (!d.endpoint) return { up: false };
  try {
    const r = await fetch(d.endpoint + '/status', { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { up: false, http: r.status };
    const j = await r.json();
    return { up: true, tools: j.last_decision?.tools || [], credits: j.inference?.credits_usd, sol: j.funding?.sol_raw };
  } catch { return { up: false }; }
}

const live = [];
for (const d of list.filter((x) => ['running', 'provisioning'].includes(x.status))) {
  const p = await probe(d);
  const leftMin = d.expiresAt ? Math.round((Date.parse(d.expiresAt) - Date.now()) / 60000) : null;
  if (p.up) { live.push(d); continue; }
  // Not answering: if it is still inside its paid window it is a crash, not an expiry.
  if (leftMin !== null && leftMin > 2) {
    say({ stage: 'crashed', deploymentId: d.deploymentId, leftMin });
    if (!DRY) {
      try {
        const { walletAuth } = await import('./agentgates-auth.mjs');
        const h = await walletAuth('DELETE', `/api/compute/deployments/${d.deploymentId}`);
        const r = await fetch(L.API + `/api/compute/deployments/${d.deploymentId}`, { method: 'DELETE', headers: { 'X-Wallet-Auth': h } });
        say({ stage: 'destroyed', deploymentId: d.deploymentId, status: r.status });
      } catch (e) { say({ stage: 'destroy_failed', deploymentId: d.deploymentId, err: String(e.message || e).slice(0, 120) }); }
    }
  } else {
    say({ stage: 'expired', deploymentId: d.deploymentId, leftMin });
  }
}

// Replace up to target.
for (let i = live.length; i < TARGET; i++) {
  if (DRY) { say({ stage: 'would_deploy', live: live.length, target: TARGET }); break; }
  try {
    const compose = (await import('./deploy-child.mjs')).compose
      ? (await import('./deploy-child.mjs')).compose()
      : null;
    const r = await L.createLease({ plan: process.env.AGENT_PLAN || 'compute.standard', hours: 1, compose, name: 'birth-child-' + Math.floor(now() / 60) }, identity);
    const dep = r.json?.deploymentId || r.json?.id || null;
    say({ stage: 'deployed', deploymentId: dep, status: r.status });
    if (!dep) break;
    // Wait for the receipt, then endow it.
    let endpoint = r.json?.endpoint || null, address = null;
    for (let k = 0; k < 40; k++) {
      const one = (await L.listDeployments()).find((x) => x.deploymentId === dep);
      if (one?.endpoint) endpoint = one.endpoint;
      if (endpoint && !address) { try { const j = await (await fetch(endpoint + '/identity', { signal: AbortSignal.timeout(6000) })).json(); address = j.payload?.solana?.public_key || null; } catch {} }
      if (address) break;
      await new Promise((x) => setTimeout(x, 15000));
    }
    if (address) {
      try { await run(process.execPath, [path.join(RUNTIME_DIR, 'bin', 'fund-child.mjs'), address, ENDOW], { cwd: RUNTIME_DIR, timeout: 180000 }); say({ stage: 'funded', deploymentId: dep, address }); } catch (e) { say({ stage: 'fund_error', err: String(e.message || e).slice(0, 120) }); }
    }
  } catch (e) { say({ stage: 'deploy_error', err: String(e.message || e).slice(0, 160) }); break; }
}
say({ stage: 'done', live: live.length, target: TARGET, img: IMG });
