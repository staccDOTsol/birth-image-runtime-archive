// Canvas every compute seller on the x402 bazaar (Coinbase discovery index), so we are not
// siloed on one marketplace. Writes dist/bazaar.json and prints a short table.
import fs from 'node:fs';

const BASE = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources';
const KEY = process.env.BAZAAR_URL || BASE;
const out = [];
let url = KEY;
for (let page = 0; page < 40 && url; page++) {
  let j;
  try { j = await (await fetch(url, { signal: AbortSignal.timeout(20000) })).json(); } catch { break; }
  const items = j.items || j.resources || [];
  for (const it of items) {
    const text = JSON.stringify(it).toLowerCase();
    if (!/(compute|vps|vm |droplet|instance|server|gpu|tee|container|deploy)/.test(text)) continue;
    const acc = (it.accepts || [])[0] || {};
    out.push({
      resource: it.resource || it.url,
      description: it.description || it.metadata?.description || '',
      network: acc.network || '',
      amount: acc.amount || acc.maxAmountRequired || '',
      payTo: acc.payTo || '',
      mime: it.mimeType || '',
    });
  }
  url = j.nextPageUrl || j.next || null;
}

fs.writeFileSync('dist/bazaar.json', JSON.stringify(out, null, 1));
const byPrice = out
  .map((x) => ({ ...x, usd: Number(x.amount) / 1e6 }))
  .filter((x) => x.network.includes('8453') || x.network.includes('solana'))
  .sort((a, b) => a.usd - b.usd);
console.log(JSON.stringify({ at: new Date().toISOString(), found: out.length, affordableBase: byPrice.filter((x) => x.network.includes('8453')).slice(0, 15) }, null, 1));
