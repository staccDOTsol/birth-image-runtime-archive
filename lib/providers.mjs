// Multi-provider provisioner. One call provisions a child on whichever TEE/cloud seller
// answers, so the fleet is not tied to a single vendor. Each adapter returns
// { provider, id, endpoint|ip, raw } or throws; the caller records and moves on.
import fs from 'node:fs';
import * as S from './signer-client.mjs';
import * as L from './lease.mjs';
import * as E from './lease-evm.mjs';
import * as X from './x402-evm.mjs';
import * as SV from './secretvm.mjs';
import * as J from './journal.mjs';
import { now } from './util.mjs';

const SSH_PUB = process.env.AGENT_SSH_PUB_FILE || 'C:/Users/User/birth-image/guest/ssh/id_ed25519.pub';

export async function provisionAgentgates({ plan = 'compute.standard', compose, hours = 1 } = {}) {
  const identity = await S.identity();
  process.env.AGENT_LEASE_NETWORK = process.env.AGENT_LEASE_NETWORK || 'solana';
  const r = await E.paidPostAuto('/api/compute/deployments', { plan, hours, compose, name: `birth-child-${Math.floor(now() / 60)}` }, identity, 'procreation.lease');
  const id = r.json?.deploymentId || r.json?.id || null;
  if (!id) throw new Error(`agentgates: ${JSON.stringify(r.json).slice(0, 120)}`);
  return { provider: 'agentgates', id, rail: r.rail, raw: r.json };
}

export async function provisionSecretvm({ vmTypeId = 'small' } = {}) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const { stdout } = await run(process.execPath, ['C:/Users/User/birth-image/runtime/bin/deploy-secretvm.mjs', vmTypeId], { timeout: 180000 });
  const line = stdout.trim().split(String.fromCharCode(10)).filter((l) => l.startsWith('{')).pop();
  const j = JSON.parse(line);
  if (!j.json?.id) throw new Error(`secretvm: ${String(j.body).slice(0, 120)}`);
  return { provider: 'secretvm', id: j.json.id, endpoint: `https://${j.json.vmDomain}`, raw: j.json };
}

export async function provisionX402Compute({ plan = 'vc2-1c-1gb', hours = 24 } = {}) {
  const identity = await S.identity();
  const pub = fs.readFileSync(SSH_PUB, 'utf8').trim();
  const body = { plan, provider: plan.startsWith('do:') ? 'digitalocean' : 'vultr', region: process.env.X402C_REGION || 'ewr', os_id: 2284, label: `birth-${Math.floor(now() / 60)}`, prepaid_hours: hours, ssh_public_key: pub };
  const post = (headers = {}) => fetch('https://compute.x402layer.cc/compute/provision', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const first = await post();
  if (first.status !== 402) { const j = await first.json().catch(() => ({})); return { provider: 'x402compute', id: j.order?.id || null, raw: j }; }
  const q = await first.json();
  const accept = X.pickAccept(q.accepts, { network: 'eip155:8453' }) || q.accepts?.[0];
  const auth = await X.authorize(accept, { value: accept.amount || accept.maxAmountRequired, resource: q.resource?.url, version: q.x402Version || 1 });
  const second = await post({ 'X-PAYMENT': auth.header, 'PAYMENT-SIGNATURE': auth.header });
  const j = await second.json().catch(() => ({}));
  const out = { provider: 'x402compute', id: j.order?.id || null, ip: j.order?.ip_address || null, raw: j };
  await J.append('procreation.x402compute', { status: second.status, id: out.id, ip: out.ip, plan });
  if (!out.id) throw new Error(`x402compute: ${JSON.stringify(j).slice(0, 120)}`);
  return out;
}


export async function provisionAgvps({ location = process.env.AGVPS_LOCATION || 'de' } = {}) {
  const body = { location, hostname: 'birth-' + Math.floor(now() / 60) };
  const post = (headers = {}) => fetch('https://agvps.shveik.dev/x402/vps-small', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const first = await post();
  if (first.status !== 402) { const j = await first.json().catch(() => ({})); return { provider: 'agvps', id: j.id || j.serverId || null, raw: j }; }
  const q = await first.json();
  const accept = X.pickAccept(q.accepts, { network: 'eip155:8453' }) || q.accepts?.[0];
  const auth = await X.authorize(accept, { value: accept.amount || accept.maxAmountRequired, resource: q.resource?.url, version: q.x402Version || 1 });
  const second = await post({ 'X-PAYMENT': auth.header, 'PAYMENT-SIGNATURE': auth.header });
  const j = await second.json().catch(() => ({}));
  const id = j.id || j.serverId || (Array.isArray(j) ? j[0]?.id : null) || null;
  await J.append('procreation.agvps', { status: second.status, id, raw: JSON.stringify(j).slice(0, 200) });
  if (!id) throw new Error('agvps: ' + JSON.stringify(j).slice(0, 120));
  return { provider: 'agvps', id, raw: j };
}

// Try each provider in order until one accepts. Order is cheapest-TEE first.
export async function provisionAny({ compose, plan = 'compute.standard', prefer = (process.env.AGENT_PROVIDER_ORDER || 'agentgates,secretvm,x402compute,agvps').split(',')  } = {}) {
  const results = [];
  for (const p of prefer) {
    try {
      if (p === 'agentgates') results.push(await provisionAgentgates({ plan, compose }));
      else if (p === 'secretvm') results.push(await provisionSecretvm({}));
      else if (p === 'x402compute') results.push(await provisionX402Compute({}));
      else if (p === 'agvps') results.push(await provisionAgvps({}));
      await J.append('procreation.provider_ok', { provider: p, at: now() });
      return { ok: true, ...results[results.length - 1], tried: results };
    } catch (e) {
      await J.append('procreation.provider_fail', { provider: p, err: String(e.message || e).slice(0, 160) });
      results.push({ provider: p, error: String(e.message || e).slice(0, 160) });
    }
  }
  return { ok: false, tried: results };
}

export const providers = { agentgates: provisionAgentgates, secretvm: provisionSecretvm, x402compute: provisionX402Compute, agvps: provisionAgvps };
