// Probe every compute provider the inventory surfaced: ask for a quote and record the
// price, the rails it accepts, and whether the product claims TEE. Read-only: no payments.
// usage: node bin/probe-providers.mjs
import fs from 'node:fs';
import path from 'node:path';

const targets = [
  { name: 'agentgates', url: 'https://agentgates-backend.vercel.app/api/compute/deployments', body: { plan: 'compute.standard', hours: 1, compose: 'services:\n  a:\n    image: node:22-alpine\n', name: 'probe' }, tee: 'dstack TDX' },
  { name: 'x402compute', url: 'https://compute.x402layer.cc/compute/provision', body: { plan: 'vc2-1c-1gb', region: 'ewr', os_id: 2284, label: 'probe', prepaid_hours: 24 }, tee: 'no (Vultr/DO)' },
  { name: 'tendril', url: 'https://tendrilregister.007575.xyz/x402/rent', body: { nodeId: 'probe' }, tee: 'cpu nodes' },
  { name: 'nuza', url: 'https://nuza.io/api/x402/rent', body: {}, tee: 'gpu' },
  { name: 'agvps', url: 'https://agvps.shveik.dev/x402/vps-small', body: {}, tee: 'no (vps)' },
  { name: 'kilawatt', url: 'https://www.kilawattcloud.dev/api/public/x402/exec', body: { cmd: 'true' }, tee: 'unknown' },
  { name: 'jarvisclaw', url: 'https://jarvisclaw.ai/api/compute', body: {}, tee: 'claimed TEE' },
  { name: 'covenant', url: 'https://api.opencovenant.org/compute', body: {}, tee: 'escrow' },
  { name: 'fluence', url: 'https://api.fluence.dev/x402/v1/vm', body: {}, tee: 'wallet CPU VMs' },
  { name: 'phala', url: 'https://cloud-api.phala.network/api/v1/vms', body: {}, tee: 'TDX' },
];

const rows = [];
for (const t of targets) {
  const started = Date.now();
  let status = null, rails = [], amount = null, teeHint = null, note = null;
  try {
    const r = await fetch(t.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(t.body), signal: AbortSignal.timeout(20000) });
    status = r.status;
    const h = r.headers.get('payment-required');
    const j = await r.json().catch(() => ({}));
    const req = h ? JSON.parse(Buffer.from(h, 'base64').toString()) : j;
    const accepts = req.accepts || j.accepts || [];
    rails = accepts.map((a) => `${a.network}:${a.asset ? String(a.asset).slice(0, 10) : '?'}`);
    amount = accepts[0]?.amount || accepts[0]?.maxAmountRequired || null;
    teeHint = String(JSON.stringify(j)).match(/tdx|tee|confidential|enclave/i)?.[0] || null;
    note = (j.error || j.status || '').toString().slice(0, 60);
  } catch (e) { note = String(e.message || e).slice(0, 60); }
  rows.push({ provider: t.name, tee_claim: t.tee, status, amount, rails: rails.join(' | '), teeHint, note, ms: Date.now() - started });
  console.log(JSON.stringify(rows[rows.length - 1]));
}
fs.writeFileSync(path.resolve('dist', 'provider-probe.json'), JSON.stringify(rows, null, 2));
