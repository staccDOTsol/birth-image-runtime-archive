// Publish the live root endpoints for the dashboard: every deployment that answers /identity.
// Writes docs/roots.json locally; the scheduled task pushes it to GitHub so the page stays static
// while the fleet underneath changes.
import fs from 'node:fs';
import path from 'node:path';
import { RUNTIME_DIR } from '../lib/paths.mjs';
import * as A from './agentgates-auth.mjs';
import { now } from '../lib/util.mjs';

const out = path.join(RUNTIME_DIR, 'docs', 'roots.json');
let roots = [];
try {
  const b = (await A.ownerGet('https://agentgates-backend.vercel.app', '/api/compute/deployments')).body;
  const list = (Array.isArray(b) ? b : b.deployments || []).filter((d) => d.status !== 'destroyed' && d.endpoint);
  roots = await Promise.all(list.map(async (d) => {
    try {
      const j = await (await fetch(d.endpoint + '/identity', { signal: AbortSignal.timeout(8000) })).json();
      let kids = [];
      try { const c = await (await fetch(d.endpoint + '/children', { signal: AbortSignal.timeout(6000) })).json(); kids = (c.children || []).map((k) => ({ deploymentId: k.deploymentId, endpoint: k.endpoint || null, birth_id: k.birth_id || null, address: k.address || null, created_at: k.created_at || null, status: k.status || null })); } catch {}
      // embed status so the static page renders without any CORS proxy
      let st = null;
      try { st = await (await fetch(d.endpoint + '/status', { signal: AbortSignal.timeout(5000) })).json(); } catch {}
      return { endpoint: d.endpoint, birth_id: j.payload?.birth_id || null, deploymentId: d.deploymentId, answering: true, live: true, status: st, children: kids };
    } catch { return null; }
  }));
  roots = roots.filter(Boolean);
} catch (e) {
  console.log(JSON.stringify({ at: now(), error: String(e.message || e).slice(0, 120) }));
  process.exit(1);
}
// a node that is somebody's child is not a root: keep generations honest on the board
const childEndpoints = new Set(roots.flatMap((r) => (r.children || []).map((c) => c.endpoint)).filter(Boolean));
roots = roots.filter((r) => !childEndpoints.has(r.endpoint));

// non-TEE rail: every x402compute VPS we have deployed onto also counts as a root
let liveIps = [];
let x4key = process.env.X4_KEY || "";
try { const kf = path.join(RUNTIME_DIR, "dist", ".evmkey"); if (fs.existsSync(kf)) x4key = fs.readFileSync(kf, "utf8").trim(); } catch {}
let x4wallet = process.env.X4_WALLET || "";
try { const { identity } = await import("../lib/signer-client.mjs"); x4wallet = (await identity()).evm.address; } catch {}
try {
  const { execFileSync } = await import("node:child_process");
  const py = path.join(RUNTIME_DIR, "dist", "x4venv", "Scripts", "python.exe");
  const outTxt = execFileSync(py, [path.join(RUNTIME_DIR, "dist", "list_instances.py")], {
    encoding: "utf8",
    env: { ...process.env, WALLET_ADDRESS: x4wallet, PRIVATE_KEY: x4key },
    timeout: 60000,
  });
  liveIps = [...new Set((outTxt.match(/IP: ([0-9.]+)/g) || []).map((x) => x.slice(4)))];
} catch (e) { liveIps = []; }
try {
  const vpsFile = path.join(RUNTIME_DIR, "dist", "vps.json");
  if (fs.existsSync(vpsFile)) {
    const ips = JSON.parse(fs.readFileSync(vpsFile, "utf8"));
    const known = Array.isArray(ips) ? ips : ips.ips || [];
    // every box can host several agents on 8081..8084; publish those ports too
    const withPorts = [...known, ...known.flatMap((ip) => [8081, 8082, 8083].map((p) => `${ip}:${p}`))];
  for (const ip of [...new Set([...liveIps, ...withPorts])]) {
      const endpoint = "http://" + ip;
      try {
        const j = await (await fetch(endpoint + "/identity", { signal: AbortSignal.timeout(8000) })).json();
        let kids = [];
        try { const c = await (await fetch(endpoint + "/children", { signal: AbortSignal.timeout(6000) })).json(); kids = (c.children || []).map((k) => ({ deploymentId: k.deploymentId, endpoint: k.endpoint || null, birth_id: k.birth_id || null, address: k.address || null, created_at: k.created_at || null, status: k.status || null })); } catch {}
        let st = null;
        try { st = await (await fetch(endpoint + "/status", { signal: AbortSignal.timeout(5000) })).json(); } catch {}
        roots.push({ endpoint, birth_id: j.payload?.birth_id || null, deploymentId: "vps:" + ip, live: true, status: st, children: kids });
      } catch {}
    }
  }
} catch {}

// recurse: a child that spawns children must show them, or the tree stops at depth 1
try {
  for (const r of roots) {
    for (const c of (r.children || [])) {
      if (!c.endpoint) continue;
      try {
        const cj = await (await fetch(c.endpoint + '/children', { signal: AbortSignal.timeout(5000) })).json();
        c.children = (cj.children || []).map((k) => ({ deploymentId: k.deploymentId, endpoint: k.endpoint || null, birth_id: k.birth_id || null, address: k.address || null, created_at: k.created_at || null, status: k.status || null }));
      } catch {}
    }
  }
} catch {}

fs.writeFileSync(out, JSON.stringify({ at: now(), roots }, null, 2));

// best effort: keep the published copy in sync so the static page can find the fleet
try {
  const { execFileSync } = await import('node:child_process');
  const b64 = Buffer.from(fs.readFileSync(out)).toString('base64');
  const gh = process.env.GH_BIN || 'gh';
  let sha = '';
  try { sha = execFileSync(gh, ['api', 'repos/staccDOTsol/birth-image-runtime/contents/docs/roots.json', '--jq', '.sha'], { encoding: 'utf8' }).trim(); } catch {}
  const payload = path.join(RUNTIME_DIR, 'dist', 'roots-payload.json');
  fs.writeFileSync(payload, JSON.stringify({ message: `roots: ${roots.length} live`, content: b64, ...(sha ? { sha } : {}) }));
  execFileSync(gh, ['api', '-X', 'PUT', 'repos/staccDOTsol/birth-image-runtime/contents/docs/roots.json', '--input', payload], { encoding: 'utf8' });
  console.log(JSON.stringify({ at: now(), pushed: true, roots: roots.length }));
} catch (e) {
  console.log(JSON.stringify({ at: now(), pushed: false, err: String(e.message || e).slice(0, 100), roots: roots.length }));
}

