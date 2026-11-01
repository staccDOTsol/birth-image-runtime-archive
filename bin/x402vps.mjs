// x402vps.com — Docker containers for agents, paid per hour in USDC on Base. Not in the
// Coinbase bazaar, no signup, no account cap. core = 1 vCPU / 2 GB / internet at $0.08/hr.
//   node bin/x402vps.mjs info
//   node bin/x402vps.mjs create core 2
//   node bin/x402vps.mjs exec ctr_x "uname -a"
//   node bin/x402vps.mjs list | destroy ctr_x
import fs from 'node:fs';
import * as X from '../lib/x402-evm.mjs';
import { identity } from '../lib/signer-client.mjs';

const API = 'https://x402vps.com';
const log = (o) => console.log(JSON.stringify(o));

async function ident() {
  const p = process.env.AGENT_STATE_DIR || 'guest';
  try { const j = JSON.parse(fs.readFileSync(`${p}/identity.json`, 'utf8')); if (j?.evm?.private_key) return j; } catch {}
  return await identity();
}

async function paid(path, body) {
  const post = (h = {}) => fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });
  const first = await post();
  if (first.status !== 402) return { status: first.status, json: await first.json().catch(() => ({})) };
  let quote = {};
  try { quote = JSON.parse(Buffer.from(first.headers.get('payment-required') || '', 'base64').toString('utf8')); }
  catch { quote = await first.clone().json().catch(() => ({})); }
  const accepts = quote.accepts || quote.paymentRequirements || [];
  const rail = (accepts || []).find((a) => String(a.network) === 'eip155:8453') || accepts[0];
  if (!rail) throw new Error('no rail: ' + JSON.stringify(quote).slice(0, 200));
  const id = await ident();
  const auth = await X.authorize(rail, { value: rail.maxAmountRequired || rail.amount, resource: rail.resource || API + path, version: quote.x402Version || 1, identity: id });
  const second = await post({ 'X-PAYMENT': auth.header, 'PAYMENT-SIGNATURE': auth.header });
  const json = await second.json().catch(() => ({}));
  log({ stage: 'paid', path, status: second.status, rail: rail.network, amount_raw: String(rail.maxAmountRequired || rail.amount), id: json.id || json.container?.id || null });
  return { status: second.status, json };
}

const [cmd, a1, a2] = process.argv.slice(2);
try {
  if (cmd === 'info') {
    log(await (await fetch(API + '/api')).json());
  } else if (cmd === 'create') {
    const plan = a1 || 'core', hours = Number(a2 || 1);
    const r = await paid('/api/create', { plan, leaseHours: hours });
    log(r.json);
  } else if (cmd === 'exec') {
    const r = await fetch(API + '/api/exec', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: a1, command: a2 }) });
    log(await r.json().catch(async () => ({ raw: await r.text() })));
  } else if (cmd === 'list') {
    log(await (await fetch(API + '/api/list', { headers: { 'x-wallet': (await ident()).evm?.address } })).json());
  } else if (cmd === 'status') {
    log(await (await fetch(API + '/api/status/' + a1)).json());
  } else if (cmd === 'destroy') {
    log(await (await fetch(API + '/api/destroy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: a1 }) })).json());
  } else {
    log({ usage: 'info | create <plan> <hours> | exec <id> <command> | list | status <id> | destroy <id>' });
  }
} catch (e) { log({ error: String(e.message || e).slice(0, 300) }); process.exit(1); }
