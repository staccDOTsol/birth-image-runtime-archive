// Provider-specific paid renewal: top each lease up before it expires, with the agent's own wallet.
// This is the half of spec item 7 that runs on a provider with an extend/renew endpoint.
// usage: node bin/renew.mjs [minHoursLeft]
import * as S from '../lib/signer-client.mjs';
import * as E from '../lib/lease-evm.mjs';
import * as A from './agentgates-auth.mjs';
import * as J from '../lib/journal.mjs';
import { now } from '../lib/util.mjs';

const THRESHOLD_MS = Number(process.argv[2] || 25) * 60 * 1000;
const identity = await S.identity();
process.env.AGENT_LEASE_NETWORK = process.env.AGENT_LEASE_NETWORK || 'base'; // renewals come out of the Base USDC pot, which is where the float actually sits

const list = (await A.ownerGet('https://agentgates-backend.vercel.app', '/api/compute/deployments')).body;
const deployments = (Array.isArray(list) ? list : list.deployments || []).filter((d) => d.status !== 'destroyed');

let renewed = 0, skipped = 0, failed = 0;
for (const d of deployments) {
  const expires = Date.parse(d.expiresAt || 0);
  if (!expires) { skipped++; continue; }
  const left = expires - Date.now();
  if (left > THRESHOLD_MS) { skipped++; continue; }
  const r = await E.paidPostAuto(`/api/compute/deployments/${d.deploymentId}/renew`, { hours: 1 }, identity, 'procreation.renew')
    .catch((e) => ({ status: 0, json: { error: String(e.message || e) } }));
  const ok = r.status === 200;
  if (ok) renewed++; else failed++;
  await J.append('lease.renew', { deploymentId: d.deploymentId, status: r.status, hoursLeft: Math.round(left / 60000), ok, err: (r.json?.error || '').slice(0, 80) });
  console.log(JSON.stringify({ at: now(), deploymentId: d.deploymentId.slice(0, 9), hoursLeft: +(left / 3600000).toFixed(2), status: r.status, ok }));
}
console.log(JSON.stringify({ at: now(), kind: 'renew_pass', deployments: deployments.length, renewed, skipped, failed }));
