// Extend an x402compute instance: pay the 402 challenge on Base and sign the management
// request with X402-COMPUTE-AUTH. Without this the fleet dies when the prepaid hours run out.
// usage: node bin/x402-extend.mjs <instance_id> [hours]
import * as X from '../lib/x402-evm.mjs';
import { authHeaders, listInstances } from './x402-instances.mjs';

const BASE = 'https://compute.x402layer.cc';
const id = process.argv[2];
const hours = Number(process.argv[3] || 24);
if (!id) { console.log(JSON.stringify({ err: 'usage: x402-extend.mjs <instance_id> [hours]' })); process.exit(1); }

const path = `/compute/instances/${id}/extend`;
const body = JSON.stringify({ extend_hours: hours });

const post = async (extra = {}) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeaders('POST', path, body)), ...extra },
    body,
  });

let r = await post();
let j = await r.json().catch(() => ({}));
console.log(JSON.stringify({ stage: 'quote', status: r.status, amount: j.accepts?.[0]?.amount, network: j.accepts?.[0]?.network }));

if (r.status === 402) {
  const accept = X.pickAccept(j.accepts, { network: 'eip155:8453' }) || j.accepts?.[0];
  const auth = await X.authorize(accept, { value: accept.amount || accept.maxAmountRequired, resource: j.resource?.url, version: j.x402Version || 2 });
  r = await post({ 'X-PAYMENT': auth.header, 'PAYMENT-SIGNATURE': auth.header });
  j = await r.json().catch(() => ({}));
}

console.log(JSON.stringify({ stage: 'extended', status: r.status, body: j }).slice(0, 400));
try {
  const l = await listInstances();
  const me = l.find((x) => x.id === id);
  if (me) console.log(JSON.stringify({ stage: 'verify', id, status: me.status, ip: me.ip_address, expires: me.expires_at }));
} catch {}
