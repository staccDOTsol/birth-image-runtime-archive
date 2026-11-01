// Build a provider registry from the bundle's own x402 inventory: every inference-shaped
// resource with a live accepts[] rail becomes a candidate brain provider. Venice stays a
// separate adapter because it meters prepaid credits + SIWX instead of per-request 402.
import fs from 'node:fs';
import { canon, sha256hex, atomicJson } from '../lib/util.mjs';

const src = JSON.parse(fs.readFileSync(new URL('../../bazaar-inventory/inference-shortlist.json', import.meta.url)));
const out = [];
const seen = new Set();
for (const e of src) {
  const url = e.resource || e.url || e.endpoint || e.extensions?.bazaar?.info?.input?.url;
  if (!url || seen.has(url)) continue;
  const accepts = (e.accepts || []).filter((a) => a && a.scheme === 'exact' && /^https:\/\//.test(String(a.resource || url)));
  const solana = accepts.find((a) => String(a.network).includes('solana'));
  const base = accepts.find((a) => String(a.network).includes('8453'));
  if (!solana && !base) continue;
  const bodyFields = e.extensions?.bazaar?.info?.input?.bodyFields || e.extensions?.bazaar?.info?.input?.body || {};
  const models = bodyFields?.model?.enum || bodyFields?.model?.examples || null;
  out.push({
    id: e.id || sha256hex(Buffer.from(url)).slice(0, 12),
    name: e.name || e.title || null,
    url,
    description: (e.description || '').slice(0, 240),
    solana: solana ? { asset: solana.asset, payTo: solana.payTo, amount: solana.maxAmountRequired || solana.amount, feePayer: solana.extra?.feePayer || null } : null,
    base: base ? { asset: base.asset, payTo: base.payTo, amount: base.maxAmountRequired || base.amount } : null,
    models,
    curated: !!e.curated,
    verified_wallet_x402: false,
    note: 'listed rail from the catalog, not a paid fulfillment test',
  });
  seen.add(url);
}
out.sort((a, b) => Number(!!b.solana) - Number(!!a.solana) || Number(!!b.curated) - Number(!!a.curated));
atomicJson(new URL('../inference/providers.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), {
  at: Math.floor(Date.now() / 1000),
  source: 'bazaar-inventory/inference-shortlist.json',
  count: out.length,
  providers: out,
}, 0o644);
console.log(JSON.stringify({ count: out.length, solana: out.filter((p) => p.solana).length, sample: out.slice(0, 3).map((p) => ({ url: p.url, solana: !!p.solana, models: p.models })) }, null, 1));
