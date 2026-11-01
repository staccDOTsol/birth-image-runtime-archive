// Provision from account credits instead of a live x402 payment. Every failed provision
// tonight was credited back, so this path needs no facilitator and cannot fail verification.
// usage: node bin/provision-credits.mjs [plan] [region] [hours]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { authHeaders, listInstances } from './x402-instances.mjs';

const BASE = 'https://compute.x402layer.cc';
const plan = process.argv[2] || 'do:s-1vcpu-1gb';
const region = process.argv[3] || 'nyc1';
const hours = Number(process.argv[4] || 24);
const key = `dist/keys/c-${Date.now()}`;
execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', key, '-C', `credits-${Date.now()}`], { stdio: 'ignore' });
const pub = fs.readFileSync(key + '.pub', 'utf8').trim();

const path = '/compute/provision';
const body = JSON.stringify({
  plan,
  provider: plan.startsWith('do:') ? 'digitalocean' : 'vultr',
  region,
  os_id: plan.startsWith('do:') ? 'ubuntu-24-04-x64' : 2284,
  label: `credits-${Math.floor(Date.now() / 1000)}`,
  prepaid_hours: hours,
  ssh_public_key: pub,
  use_credits: true,
});

const before = new Set((await listInstances()).map((i) => i.id));
const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeaders('POST', path, body)) }, body });
const j = await r.json().catch(() => ({}));
console.log(JSON.stringify({ status: r.status, key, order: j.order?.id || null, err: j.error || null, details: JSON.stringify(j.details || {}).slice(0, 220) }));

let inst = null;
for (let i = 0; i < 20 && !inst; i++) {
  await new Promise((res) => setTimeout(res, 15000));
  const list = await listInstances();
  inst = list.find((x) => !before.has(x.id) && x.ip_address && x.ip_address !== 'pending') || null;
}
console.log(JSON.stringify({ ip: inst?.ip_address || null, id: inst?.id || null, key }));
