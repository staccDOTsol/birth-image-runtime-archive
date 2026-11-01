// Keep trying until a TEE child actually decides something with a tool call.
// Each attempt: deploy the fixed image, wait for its wallet, endow it, then require a
// non-empty decision. Failed attempts are destroyed so capacity is not wasted.
// usage: node bin/until-working.mjs [attempts]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { RUNTIME_DIR } from '../lib/paths.mjs';
import { now } from '../lib/util.mjs';

const run = promisify(execFile);
const API = 'https://agentgates-backend.vercel.app';
const IMG = process.env.AGENT_IMAGE_URL || 'https://files.catbox.moe/41hqxm.tgz';
const attempts = Number(process.argv[2] || 40);
const { ownerGet, walletAuth } = await import('./agentgates-auth.mjs');
const out = path.join(RUNTIME_DIR, 'dist', 'until-working.jsonl');
const say = (o) => { fs.appendFileSync(out, JSON.stringify(o) + '\n'); console.log(JSON.stringify(o)); };

for (let n = 1; n <= attempts; n++) {
  let depId = null, endpoint = null, address = null, decision = null, credits = null;
  try {
    const { stdout } = await run(process.execPath, [path.join(RUNTIME_DIR, 'bin', 'deploy-child.mjs'), '1', process.env.AGENT_PLAN || 'compute.standard'], { cwd: RUNTIME_DIR, timeout: 600000, env: { ...process.env, AGENT_IMAGE_FORMAT: 'tgz', AGENT_IMAGE_URL: IMG } });
    const line = stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
    const j = JSON.parse(line);
    if (j.status !== 'running' && j.status !== 'provisioning') { say({ attempt: n, stage: 'quote', status: j.status, body: j.body }); if (j.status === 503) { await new Promise((r) => setTimeout(r, 45000)); continue; } }
    depId = j.deploymentId; endpoint = j.endpoint || null;
  } catch (e) {
    const outTxt = String(e.stdout || '');
    const jline = outTxt.trim().split(String.fromCharCode(10)).filter((l) => l.startsWith('{')).pop();
    let info = null; try { info = JSON.parse(jline); } catch {}
    if (info && (info.status === 503 || info.status === 'provisioning')) { say({ attempt: n, stage: 'capacity', body: info.body }); await new Promise((r) => setTimeout(r, 45000)); continue; }
    if (info && info.deploymentId) { depId = info.deploymentId; endpoint = info.endpoint || null; say({ attempt: n, stage: 'deployed', depId, endpoint }); }
    else { say({ attempt: n, stage: 'deploy_error', err: String(e.message || e).slice(0, 200) }); await new Promise((r) => setTimeout(r, 45000)); continue; }
  }
  say({ attempt: n, stage: 'deployed', depId, endpoint });

  for (let i = 0; i < 60 && depId; i++) {
    const d = (await ownerGet(API, `/api/compute/deployments/${depId}`)).body;
    if (d.endpoint) endpoint = d.endpoint;
    if (d.status === 'failed') break;
    if (endpoint && !address) { try { const j = await (await fetch(endpoint + '/identity', { signal: AbortSignal.timeout(6000) })).json(); address = j.payload?.solana?.public_key || null; } catch {} }
    if (address && !fs.existsSync(path.join(RUNTIME_DIR, 'dist', `funded-${depId}.json`))) {
      try {
        const { stdout } = await run(process.execPath, [path.join(RUNTIME_DIR, 'bin', 'fund-child.mjs'), address, process.env.AGENT_ENDOWMENT || '60000000'], { cwd: RUNTIME_DIR, timeout: 180000 });
        fs.writeFileSync(path.join(RUNTIME_DIR, 'dist', `funded-${depId}.json`), stdout);
        say({ attempt: n, stage: 'funded', address });
      } catch (e) { say({ attempt: n, stage: 'fund_error', err: String(e.message || e).slice(0, 160) }); }
    }
    if (endpoint && address) {
      try {
        const s = await (await fetch(endpoint + '/status', { signal: AbortSignal.timeout(6000) })).json();
        credits = s.inference?.credits_usd;
        decision = s.last_decision || null;
        if ((decision?.tools || []).length) {
          say({ attempt: n, stage: 'WORKING', address, endpoint, credits, decision, at: now() });
          process.exit(0);
        }
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  say({ attempt: n, stage: 'no_decision', depId, address, credits, decision });
  if (depId) {
    try { const h = await walletAuth('DELETE', `/api/compute/deployments/${depId}`); await fetch(API + `/api/compute/deployments/${depId}`, { method: 'DELETE', headers: { 'X-Wallet-Auth': h } }); } catch {}
  }
  await new Promise((r) => setTimeout(r, 20000));
}
say({ stage: 'gave_up_attempts', attempts });
