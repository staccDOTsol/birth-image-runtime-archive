// Destroy an x402compute instance (owner-signed). Frees a provider slot so the marketplace
// can actually boot the next lease instead of erroring with "maximum active instances".
// usage: node bin/x402-destroy.mjs <instance_id>
import { authHeaders } from './x402-instances.mjs';

const BASE = 'https://compute.x402layer.cc';
const id = process.argv[2];
if (!id) { console.log(JSON.stringify({ err: 'usage: x402-destroy.mjs <instance_id>' })); process.exit(1); }

const path = `/compute/instances/${id}`;
const r = await fetch(BASE + path, { method: 'DELETE', headers: await authHeaders('DELETE', path) });
console.log(JSON.stringify({ id, status: r.status, body: (await r.text()).slice(0, 300) }));
