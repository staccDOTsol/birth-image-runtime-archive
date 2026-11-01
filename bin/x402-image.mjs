// Buy an image over x402 through the universal payer. The bazaar is rescanned on every call,
// image endpoints are extracted and sorted by price, and each is tried until one settles.
// Sellers return either a URL or base64 bytes; both end up as a usable image reference.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { discoverImageProviders } from '../lib/discovery-image.mjs';
import { paidRequest } from '../lib/x402.mjs';
import { identity } from '../lib/signer-client.mjs';

const MODELS = ['venice-sd35', 'nano-banana-2', 'gpt-image-1-5', 'flux-2-pro', 'sdxl'];

function pickImage(j) {
  if (!j) return null;
  if (j.url || j.image_url) return j.url || j.image_url;
  if (typeof j.image === 'string') return j.image;
  const b64 = j.images?.[0] || j.data?.[0]?.b64_json || j.data?.[0]?.url;
  if (typeof b64 === 'string' && b64.length > 200) return 'data:image/webp;base64,' + b64;
  return null;
}

export async function buyImage(prompt, { maxProviders = 5 } = {}) {
  const id = await identity();
  const providers = await discoverImageProviders();
  const tried = [];
  for (const p of providers.slice(0, maxProviders)) {
    for (const body of [{ prompt, n: 1, size: '1024x1024' }, ...MODELS.map((model) => ({ prompt, model, n: 1, size: '1024x1024' }))]) {
      let r;
      try { r = await paidRequest(p.url, body, { identity: id }); } catch (e) { r = { status: 0, tried: [{ err: String(e.message || e).slice(0, 60) }] }; }
      const img = pickImage(r.json);
      if (img) {
        const out = { provider: p.name, price: r.paid || 0, rail: r.rail, url: img.slice(0, 200000), prompt, discovered: providers.length };
        try { fs.writeFileSync('dist/last-image.json', JSON.stringify({ ...out, url: out.url.slice(0, 120) + '…' }, null, 1)); } catch {}
        return out;
      }
      if (r.status && r.status !== 402) { tried.push({ provider: p.name, status: r.status }); break; }
    }
    tried.push({ provider: p.name, err: 'no image' });
  }
  return { error: 'no image provider settled', tried, discovered: providers.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prompt = process.argv[2] || 'memecoin mascot, sticker art, dark background';
  const r = await buyImage(prompt);
  console.log(JSON.stringify({ ...r, url: r.url ? r.url.slice(0, 80) + '…' : undefined }).slice(0, 500));
}
