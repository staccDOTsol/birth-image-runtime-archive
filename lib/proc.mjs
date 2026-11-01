import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { P, RUNTIME_DIR } from './paths.mjs';
import { sleep } from './util.mjs';

export function spawnChild(script, { env = {}, detach = false } = {}) {
  const out = fs.openSync(path.join(P.state, `child-${path.basename(script)}.log`), 'a');
  const bundled = process.env.AGENT_BUNDLE === '1';
  const role = path.basename(script, '.mjs');
  const child = spawn(process.execPath, bundled ? [process.argv[1]] : [path.join(RUNTIME_DIR, script)], {
    cwd: RUNTIME_DIR,
    env: { ...process.env, AGENT_LOG: P.log, ...(bundled ? { AGENT_ROLE: role } : {}), ...env },
    stdio: ['ignore', out, out],
    detached: detach,
    windowsHide: true,
  });
  child.unref?.();
  return child;
}

export async function waitFor(fn, { timeoutMs = 20000, every = 200, label = 'wait' } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    await sleep(every);
  }
  throw new Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
}

export function signerAlive() {
  try {
    const port = Number(fs.readFileSync(P.signerPort, 'utf8').trim());
    return Number.isFinite(port) && port > 0 && fs.existsSync(P.run + '/signer.token');
  } catch { return false; }
}

// Workers may be launched before the signer socket exists; wait for it instead of
// crash-looping. Bounded, so a real signer failure still surfaces.
export async function identityWhenReady({ timeoutMs = 45000 } = {}) {
  const { identity } = await import('./signer-client.mjs');
  const t0 = Date.now();
  for (;;) {
    try { return await identity(); } catch (e) {
      if (Date.now() - t0 > timeoutMs) throw e;
      await sleep(1000);
    }
  }
}
