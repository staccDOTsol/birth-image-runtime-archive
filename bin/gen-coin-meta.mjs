// Every coin gets an image and metadata before it is launched, because a pump coin with no
// picture is a dead coin. Files land in docs/coins/ and are served by the same GitHub Pages
// site as the board, so a URI exists before the mint does.
//   node bin/gen-coin-meta.mjs [count]
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const N = Number(process.argv[2] || 120);
const OUT = 'docs/coins';
fs.mkdirSync(OUT, { recursive: true });

const WORDS = ['ember', 'cipher', 'tidal', 'lattice', 'nomad', 'quartz', 'vector', 'hollow', 'signal', 'orbit', 'feral', 'prism', 'drift', 'onyx', 'pulse', 'glyph', 'thorn', 'vapor', 'coil', 'flint'];

function svg(slug) {
  const h = createHash('sha256').update(slug).digest();
  const hue = h[0] * 360 / 255;
  const hue2 = (hue + 40 + h[1] % 90) % 360;
  const n = 3 + (h[2] % 4);
  let shapes = '';
  for (let i = 0; i < n; i++) {
    const cx = 32 + (h[(3 + i * 5) % 32] % 192);
    const cy = 32 + (h[(4 + i * 5) % 32] % 192);
    const r = 18 + (h[(5 + i * 5) % 32] % 60);
    const op = 0.25 + (h[(6 + i * 5) % 32] % 50) / 100;
    shapes += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="hsl(${(hue2 + i * 24) % 360} 78% 58%)" opacity="${op.toFixed(2)}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 12%)"/><stop offset="1" stop-color="hsl(${hue2} 60% 26%)"/></linearGradient></defs><rect width="256" height="256" fill="url(#g)"/>${shapes}<circle cx="128" cy="128" r="86" fill="none" stroke="hsl(${hue2} 90% 70%)" stroke-width="2" opacity="0.55"/></svg>`;
}

const base = 'https://staccdotsol.github.io/birth-image-runtime/coins';
const pool = [];
let made = 0;
for (let i = 0; i < N; i++) {
  const slug = `c${Date.now().toString(36)}${i.toString(36)}${createHash('sha256').update(String(i) + Math.random()).digest('hex').slice(0, 4)}`;
  const w1 = WORDS[Math.floor(Math.random() * WORDS.length)];
  const w2 = WORDS[Math.floor(Math.random() * WORDS.length)];
  const name = `${w1[0].toUpperCase()}${w1.slice(1)} ${w2[0].toUpperCase()}${w2.slice(1)}`;
  const symbol = (w1.slice(0, 2) + w2.slice(0, 2)).toUpperCase();
  const meta = {
    name,
    symbol,
    description: `${name} — launched by a birth-image agent. The agent holds a dev buy and earns the creator fee.`,
    image: `${base}/${slug}.svg`,
    showName: true,
    createdOn: 'https://staccdotsol.github.io/birth-image-runtime/',
  };
  fs.writeFileSync(`${OUT}/${slug}.svg`, svg(slug));
  fs.writeFileSync(`${OUT}/${slug}.json`, JSON.stringify(meta));
  pool.push({ slug, name, symbol, uri: `${base}/${slug}.json` });
  made++;
}
fs.writeFileSync('assets/coin-pool.json', JSON.stringify(pool, null, 1));
console.log(JSON.stringify({ made, pool: pool.length, example_uri: pool[0].uri, example_name: pool[0].name }));
