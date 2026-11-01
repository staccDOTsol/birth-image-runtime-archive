// Image-capable x402 sellers, discovered from the bazaar on every call. No hard-coded list:
// a new seller appears here the moment it lists itself.
import fs from 'node:fs';

const BAZAAR = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources?limit=1000';
const IMG_KW = /image|img|diffus|flux|sdxl|banana|dall|seedream|recraft|picture|painting|text-to-image|venice/i;

export async function discoverImageProviders() {
  const out = [];
  try {
    const r = await (await fetch(BAZAAR, { signal: AbortSignal.timeout(25000) })).json();
    for (const x of (r.items || r.resources || [])) {
      const blob = ((x.resource || x.url || '') + ' ' + (x.metadata?.description || '') + ' ' + (x.name || '') + ' ' + JSON.stringify(x.metadata?.input || '')).slice(0, 900);
      if (!IMG_KW.test(blob)) continue;
      const base = (x.accepts || []).find((a) => String(a.network).includes('8453')) || (x.accepts || []).find((a) => String(a.network).startsWith('solana'));
      if (!base) continue;
      const price = Number(base.maxAmountRequired || base.amount || 0) / 1e6;
      if (!(price > 0 && price <= 0.25)) continue;
      out.push({ name: (x.resource || x.url || '').replace(/^https?:\/\//, '').split('/')[0], url: x.resource || x.url, price, network: base.network });
    }
  } catch {}
  const uniq = [...new Map(out.map((o) => [o.url, o])).values()].sort((a, b) => a.price - b.price);
  try { fs.writeFileSync('dist/image-providers.json', JSON.stringify({ at: new Date().toISOString(), uniq }, null, 1)); } catch {}
  return uniq;
}
