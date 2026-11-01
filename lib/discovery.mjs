// Provider discovery that lives in the image. Directories list dead services, so every
// candidate is probed and only the ones that answer with a payable quote are recorded.
// Sources: Coinbase bazaar + known x402 compute sellers found outside it.
import fs from 'node:fs';
import * as J from './journal.mjs';
import { now } from './util.mjs';

const CANDIDATES = [
  // name, probe URL (POST creates / GET lists), body, kind
  { name: 'x402compute', url: 'https://compute.x402layer.cc/compute/provision', body: { plan: 'vc2-1c-1gb', prepaid_hours: 1 }, price_hint: 0.28, kind: 'vps' },
  { name: 'agvps', url: 'https://agvps.shveik.dev/x402/vps-small', body: { location: 'de' }, price_hint: 10, kind: 'vps' },
  { name: 'x402vps', url: 'https://x402vps.com/api/create', body: { plan: 'core', leaseHours: 1 }, price_hint: 0.08, kind: 'container' },
  { name: 'phoneagent', url: 'https://vps.phoneagent.xyz/api/create', body: { plan: 'sandbox-1h' }, price_hint: 0.5, kind: 'vps' },
  { name: 'secretvm', url: 'https://secretvm.example/api/vms', body: {}, price_hint: 0, kind: 'tee' },
];
const BAZAAR = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources';

async function probeOne(c, timeoutMs = 12000) {
  const ctl = AbortSignal.timeout(timeoutMs);
  try {
    const r = await fetch(c.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c.body), signal: ctl, redirect: 'follow' });
    let quote = null;
    const h = r.headers.get('payment-required');
    if (h) { try { quote = JSON.parse(Buffer.from(h, 'base64').toString('utf8')); } catch {} }
    if (!quote) { try { const j = await r.clone().json(); if (j?.accepts) quote = j; } catch {} }
    const rails = (quote?.accepts || []).map((a) => a.network);
    return { name: c.name, kind: c.kind, url: c.url, status: r.status, payable: r.status === 402 && rails.length > 0, rails, price_hint: c.price_hint, final_url: r.url };
  } catch (e) {
    return { name: c.name, kind: c.kind, url: c.url, status: 0, payable: false, err: String(e.message || e).slice(0, 90) };
  }
}

async function bazaar(timeoutMs = 15000) {
  try {
    const r = await fetch(BAZAAR, { signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json();
    const items = j.items || j.resources || [];
    return items.map((x) => ({
      name: (x.resource || x.url || '').replace(/^https?:\/\//, '').split('/')[0] || 'unknown',
      url: x.resource || x.url, kind: 'bazaar', price_hint: Number(x.price?.amount || x.maxAmountRequired || 0) / 1e6, rails: (x.accepts || []).map((a) => a.network),
    }));
  } catch { return []; }
}

export async function discover({ write = 'dist/providers.json' } = {}) {
  const probed = await Promise.all(CANDIDATES.map((c) => probeOne(c)));
  const baz = await bazaar();
  const vps = baz.filter((b) => /compute|vps|server|container|vm/i.test(String(b.name) + String(b.url)));
  const out = { at: now(), probed, bazaar_vps: vps.slice(0, 40), payable: probed.filter((p) => p.payable).map((p) => p.name) };
  try { fs.writeFileSync(write, JSON.stringify(out, null, 1)); } catch {}
  try { fs.writeFileSync('guest/var/lib/agent/providers.json', JSON.stringify(out)); } catch {}
  await J.append('discovery', { payable: out.payable, bazaar_vps: vps.length, at: now() });
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await discover();
  console.log(JSON.stringify({ payable: r.payable, probed: r.probed.map((p) => `${p.name}:${p.status}${p.payable ? ':payable' : ''}`), bazaar_vps: r.bazaar_vps.length }, null, 1));
}
