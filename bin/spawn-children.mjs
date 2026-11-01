// Keep trying to reach N running children. Each attempt uses the provisioning registry
// (never one hardcoded platform), and a provider that reports capacity pressure is retried
// later instead of being treated as fatal. Children are recorded with their deployment id
// and endpoint; the identity/funding pass follows in bin/children.mjs.
// usage: node bin/spawn-children.mjs <count> [hours] [plan]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { P, RUNTIME_DIR } from '../lib/paths.mjs';
import { now, log, readJson, atomicJson } from '../lib/util.mjs';

const run = promisify(execFile);
const want = Number(process.argv[2] || 3);
const hours = Number(process.argv[3] || 1);
const plan = process.argv[4] || 'compute.standard';
const stateFile = path.join(P.state, 'spawner.json');

const load = () => readJson(stateFile, { target: want, attempts: [], children: [], started_at: now() });
const save = (s) => atomicJson(stateFile, { ...s, updated_at: now() }, 0o644);

async function once() {
  const s = load();
  s.target = want;
  const alive = s.children.filter((c) => c.status === 'running' || c.status === 'provisioning');
  if (alive.length >= want) return s;
  s.attempts.push({ at: now(), plan });
  save(s);
  try {
    const { stdout } = await run(process.execPath, [path.join(RUNTIME_DIR, 'bin', 'deploy-child.mjs'), String(hours), plan], {
      cwd: RUNTIME_DIR, env: { ...process.env, AGENT_IMAGE_FORMAT: 'tgz' }, timeout: 480000, maxBuffer: 8 * 1024 * 1024,
    });
    const line = stdout.trim().split('\n').filter(Boolean).pop();
    let j = null; try { j = JSON.parse(line); } catch {}
    if (j?.deploymentId && j?.status === 'running') {
      s.children.push({ deploymentId: j.deploymentId, provider: j.provider, plan: j.plan, endpoint: j.endpoint, status: 'running', created_at: now() });
      log('spawner', 'child running', { deploymentId: j.deploymentId, endpoint: j.endpoint });
    } else if (j?.status === 'provisioning') {
      s.children.push({ deploymentId: j.deploymentId, status: 'provisioning', created_at: now() });
    } else {
      s.last_note = j ? JSON.stringify(j).slice(0, 300) : line.slice(0, 300);
    }
    save(s);
    return s;
  } catch (e) {
    s.last_error = String(e.message || e).slice(0, 300);
    save(s);
    return s;
  }
}

for (let i = 0; i < 40; i++) {
  const s = await once();
  const have = s.children.filter((c) => ['running', 'provisioning'].includes(c.status)).length;
  if (have >= want) { log('spawner', 'target reached', { have, want }); break; }
  log('spawner', 'waiting for capacity', { have, want, note: s.last_note || s.last_error || null });
  await new Promise((r) => setTimeout(r, 90000));
}
