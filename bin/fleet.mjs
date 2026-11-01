// Durable fleet keeper. Every run: count live TEE children, deploy replacements on the
// fixed image until the target is met, endow each new one, and record what happened.
// Runs unattended from a Windows scheduled task, so a dead child is replaced without a human.
// usage: node bin/fleet.mjs [target]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { RUNTIME_DIR } from '../lib/paths.mjs';
import { now } from '../lib/util.mjs';

const run = promisify(execFile);
const API = 'https://agentgates-backend.vercel.app';
const IMG = process.env.AGENT_IMAGE_URL || 'https://files.catbox.moe/pgiir0.tgz';
const TARGET = Number(process.argv[2] || process.env.AGENT_TARGET_CHILDREN || 2);
const ENDOW = process.env.AGENT_ENDOW_LAMPORTS || '60000000';
const ledger = path.join(RUNTIME_DIR, 'dist', 'fleet.jsonl');
const say = (o) => fs.appendFileSync(ledger, JSON.stringify({ at: now(), ...o }) + '\n');
const { ownerGet } = await import('./agentgates-auth.mjs');

async function liveChildren() {
  const b = (await ownerGet(API, '/api/compute/deployments')).body;
  const list = Array.isArray(b) ? b : (b.deployments || b.data || []);
  return list.filter((d) => ['running', 'provisioning'].includes(d.status));
}

async function deploy() {
  try {
    const { stdout } = await run(process.execPath, [path.join(RUNTIME_DIR, 'bin', 'deploy-child.mjs'), '1', 'compute.standard'], { cwd: RUNTIME_DIR, timeout: 600000, env: { ...process.env, AGENT_IMAGE_FORMAT: 'tgz', AGENT_IMAGE_URL: IMG } });
    const line = stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
    return JSON.parse(line);
  } catch (e) {
    const t = String(e.stdout || '');
    const line = t.trim().split(String.fromCharCode(10)).filter((l) => l.startsWith('{')).pop();
    try { return JSON.parse(line); } catch { return { stage: 'error' }; }
  }
}

async function fundWhenReady(depId) {
  let endpoint = null, address = null;
  for (let i = 0; i < 40; i++) {
    const d = (await ownerGet(API, `/api/compute/deployments/${depId}`)).body;
    if (d.endpoint) endpoint = d.endpoint;
    if (endpoint && !address) { try { const j = await (await fetch(endpoint + '/identity', { signal: AbortSignal.timeout(6000) })).json(); address = j.payload?.solana?.public_key || null; } catch {} }
    if (address) break;
    await new Promise((r) => setTimeout(r, 15000));
  }
  if (address) {
    try { await run(process.execPath, [path.join(RUNTIME_DIR, 'bin', 'fund-child.mjs'), address, ENDOW], { cwd: RUNTIME_DIR, timeout: 180000 }); say({ stage: 'funded', depId, address }); } catch (e) { say({ stage: 'fund_error', depId, err: String(e.message || e).slice(0, 120) }); }
  }
  return { depId, address, endpoint };
}

const live = await liveChildren();
say({ stage: 'scan', live: live.length, target: TARGET });
for (let i = live.length; i < TARGET; i++) {
  const j = await deploy();
  if (!j.deploymentId) { say({ stage: 'capacity_or_error', detail: j }); break; }
  say({ stage: 'deployed', depId: j.deploymentId });
  const r = await fundWhenReady(j.deploymentId);
  say({ stage: 'child_up', ...r });
}
say({ stage: 'done', live: (await liveChildren()).length });
