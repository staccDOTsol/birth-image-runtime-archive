// The fleet can only buy an image when the payer holds Base USDC. Watch for the top-up and,
// the moment it clears the cheapest seller, buy one and record it — no human in the loop.
import fs from 'node:fs';
import { balances } from '../lib/x402.mjs';
import { buyImage } from './x402-image.mjs';
import { identity } from '../lib/signer-client.mjs';

const id = await identity();
const b = await balances(id);
const usd = Number(b.base) / 1e6;
const row = { at: new Date().toISOString(), base_usdc: usd };
if (usd < 0.02) {
  row.action = 'waiting';
} else {
  const r = await buyImage('a memecoin mascot, bold sticker art, dark background, no text');
  row.action = 'bought';
  row.result = { provider: r.provider, price: r.price, url: r.url ? String(r.url).slice(0, 60) : null, error: r.error };
}
fs.appendFileSync('dist/image-watch.jsonl', JSON.stringify(row) + '\n');
console.log(JSON.stringify(row).slice(0, 300));
