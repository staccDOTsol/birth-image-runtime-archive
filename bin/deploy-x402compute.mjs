// Provision a cloud VPS at x402Compute (Vultr-backed) and pay the x402 challenge with the
// agent's Base USDC. Third provider, still no account: the quote is paid per-provision.
// usage: node bin/deploy-x402compute.mjs [plan] [hours]
import fs from 'node:fs';
import * as S from '../lib/signer-client.mjs';
import * as X from '../lib/x402-evm.mjs';
import * as J from '../lib/journal.mjs';
import { now } from '../lib/util.mjs';

const API = 'https://compute.x402layer.cc';
// 1 GB was a false economy: seven roles per port do not fit, and the cgroup SIGKILLs them.
// Default to 2 GB unless the caller says otherwise.
const plan = process.argv[2] || process.env.X402C_PLAN || 'vc2-1c-2gb';
// Hard floor: the bundle needs ~7 roles per port; 1 GB boxes get SIGKILLed (137) by the cgroup.
// Override only deliberately, with ALLOW_SMALL=1.
if (/1gb/i.test(plan) && process.env.ALLOW_SMALL !== '1') {
  console.error(JSON.stringify({ err: 'refusing a 1 GB plan', plan, hint: 'set ALLOW_SMALL=1 to override; the bundle needs >=2 GB' }));
  process.exit(2);
}
const hours = Number(process.argv[3] || 24);
const pub = fs.readFileSync(process.env.X402C_SSH_PUB || 'C:/Users/User/birth-image/guest/ssh/id_ed25519.pub', 'utf8').trim();

const body = {
  plan,
  provider: plan.startsWith('do:') ? 'digitalocean' : 'vultr',
  region: process.env.X402C_REGION || 'ewr',
  os_id: process.env.X402C_OS ? ((/^[0-9]+$/.test(process.env.X402C_OS)) ? Number(process.env.X402C_OS) : process.env.X402C_OS) : 2284,
  label: `birth-${Math.floor(now() / 60)}`,
  prepaid_hours: hours,
  ssh_public_key: pub,
};

const post = (headers = {}) => fetch(`${API}/compute/provision`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const first = await post();
const j1 = await first.json().catch(() => ({}));
console.log(JSON.stringify({ stage: 'quote', status: first.status, amount: j1.accepts?.[0]?.amount, network: j1.accepts?.[0]?.network, version: j1.x402Version }));
if (first.status !== 402) { console.log(JSON.stringify({ stage: 'provision', body: j1 }).slice(0, 500)); process.exit(first.ok ? 0 : 1); }

const accept = X.pickAccept(j1.accepts, { network: 'eip155:8453' }) || j1.accepts?.[0];
const auth = await X.authorize(accept, { value: accept.amount || accept.maxAmountRequired, resource: j1.resource?.url, version: j1.x402Version || 2 });
const second = await post({ 'X-PAYMENT': auth.header, 'PAYMENT-SIGNATURE': auth.header });
const j2 = await second.json().catch(() => ({}));
const rec = { at: now(), provider: 'x402compute', plan, status: second.status, instance: j2.id || j2.instance_id || null, ip: j2.ip || j2.ip_address || null, body: j2 };
await J.append('procreation.x402compute', { status: second.status, instance: rec.instance, ip: rec.ip, plan });
console.log(JSON.stringify({ stage: 'paid', status: second.status, body: j2 }));
