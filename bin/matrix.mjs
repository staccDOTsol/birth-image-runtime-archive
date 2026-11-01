// Provisioning matrix: try each provider in turn, then probe whether the child actually
// answers. Prints one row per provider with what it cost and whether it came up.
// usage: node bin/matrix.mjs [providers]   e.g. "agentgates,secretvm,x402compute"
import * as P from '../lib/providers.mjs';
import * as L from '../lib/lease.mjs';
import { compose } from './deploy-child.mjs';
import { now } from '../lib/util.mjs';

const order = (process.argv[2] || process.env.AGENT_PROVIDER_ORDER || 'agentgates,secretvm,x402compute').split(',').map((s) => s.trim()).filter(Boolean);
const rows = [];

async function probeHttp(url, tries = 12, waitMs = 15000) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url.replace(/\/$/, '') + '/status', { signal: AbortSignal.timeout(6000) });
      if (r.ok) return { up: true, body: await r.json() };
    } catch {}
    await new Promise((x) => setTimeout(x, waitMs));
  }
  return { up: false };
}

for (const p of order) {
  const started = now();
  let res = null, err = null;
  try {
    if (p === 'agentgates') res = await P.provisionAgentgates({ compose: compose() });
    else if (p === 'secretvm') res = await P.provisionSecretvm({});
    else if (p === 'x402compute') res = await P.provisionX402Compute({});
    else if (p === 'agvps') res = await P.provisionAgvps({});
    else { err = 'unknown provider'; }
  } catch (e) { err = String(e.message || e).slice(0, 160); }

  let live = { up: false }, endpoint = res?.endpoint || null;
  if (res && !err) {
    if (p === 'agentgates') {
      for (let i = 0; i < 30 && !endpoint; i++) {
        const d = (await L.listDeployments()).find((x) => x.deploymentId === res.id);
        if (d?.endpoint) endpoint = d.endpoint;
        else await new Promise((x) => setTimeout(x, 10000));
      }
    }
    if (endpoint) live = await probeHttp(endpoint, 8, 15000);
  }
  rows.push({ provider: p, id: res?.id || null, endpoint, up: !!live.up, credits: live.body?.inference?.credits_usd ?? null, tools: live.body?.last_decision?.tools ?? null, err, seconds: now() - started });
  console.log(JSON.stringify(rows[rows.length - 1]));
}

console.log('MATRIX ' + JSON.stringify(rows.map((r) => ({ p: r.provider, up: r.up, id: r.id }))));
