// Launch one coin properly: buy the art over x402, host image + metadata on the project site
// (Metaplex caps the on-chain URI at 200 bytes, so a data URI cannot be used), take a dev buy
// sized from the wallet, and print the CA.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buyImage } from './x402-image.mjs';
import * as pumpLaunch from '../strategies/pump-sdk-launch.mjs';
import * as S from '../lib/signer-client.mjs';
import * as R from '../lib/rpc.mjs';

const REPO = 'staccDOTsol/birth-image-runtime';
const BASE = 'https://staccdotsol.github.io/birth-image-runtime/coins';
const identity = await S.identity();
const name = process.argv[3] || 'Chrome Beetle';
const symbol = process.argv[4] || 'CHRB';
const prompt = process.argv[2] || 'a chrome beetle memecoin mascot, bold sticker art, dark background, no text';

let img = await buyImage(prompt);
let bytes, ext;
if (img?.url?.startsWith('data:')) { bytes = Buffer.from(img.url.split(',')[1], 'base64'); ext = 'webp'; }
else if (img?.url) { bytes = Buffer.from(await (await fetch(img.url)).arrayBuffer()); ext = 'png'; }
else {
  bytes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#101418"/><circle cx="256" cy="256" r="150" fill="#6ee7b7"/></svg>`);
  ext = 'svg';
}
const slug = 'c' + Date.now().toString(36);
const meta = { name, symbol, description: `${name} — launched by a birth-image agent that holds a dev buy and earns the creator fee.`, image: `${BASE}/${slug}.${ext}`, showName: true };
const gh = (args, input) => execFileSync('gh', ['api', ...args], { input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const jget = (p) => JSON.parse(gh([p]));
const ref = jget(`repos/${REPO}/git/ref/heads/main`);
const base = jget(`repos/${REPO}/git/commits/${ref.object.sha}`);
const blobs = [
  { path: `docs/coins/${slug}.${ext}`, mode: '100644', type: 'blob', sha: JSON.parse(gh(['repos/' + REPO + '/git/blobs', '-X', 'POST', '--input', '-'], JSON.stringify({ content: bytes.toString('base64'), encoding: 'base64' }))).sha },
  { path: `docs/coins/${slug}.json`, mode: '100644', type: 'blob', sha: JSON.parse(gh(['repos/' + REPO + '/git/blobs', '-X', 'POST', '--input', '-'], JSON.stringify({ content: Buffer.from(JSON.stringify(meta)).toString('base64'), encoding: 'base64' }))).sha },
];
const tree = JSON.parse(gh(['repos/' + REPO + '/git/trees', '-X', 'POST', '--input', '-'], JSON.stringify({ base_tree: base.tree.sha, tree: blobs })));
const commit = JSON.parse(gh(['repos/' + REPO + '/git/commits', '-X', 'POST', '--input', '-'], JSON.stringify({ message: `coin ${slug}: image + metadata`, tree: tree.sha, parents: [ref.object.sha] })));
gh(['repos/' + REPO + '/git/refs/heads/main', '-X', 'PATCH', '--input', '-'], JSON.stringify({ sha: commit.sha }));
const uri = `${BASE}/${slug}.json`;
console.log(JSON.stringify({ stage: 'hosted', image_from: img?.provider || 'fallback', uri, uri_len: uri.length }));

const bal = BigInt(await R.getBalance(identity.solana.public_key) || 0);
const devbuy = BigInt(process.env.DEVBUY_LAMPORTS || String((bal * 2n) / 100n));
const r = await pumpLaunch.launch({ identity, name, symbol, uri, devbuyLamports: 0 });
console.log(JSON.stringify({ stage: 'launched', mint: r?.mint || r?.mintAddress || null, sig: r?.signature || null, raw: JSON.stringify(r).slice(0, 160) }));
// dev buy as its own transaction: the in-tx buy is rejected while the curve is fresh
try {
  const swap = await import('../lib/swap.mjs');
  const amount = String(devbuy);
  const q = await swap.quote({ inputMint: 'So11111111111111111111111111111111111111112', outputMint: r?.mint, amount, slippageBps: 300 });
  if (q?.outAmount) {
    const set = await swap.swapInstructions({ quoteResponse: q, userPublicKey: identity.solana.public_key });
    const ixs = swap.ixsOf(set);
    const { blockhash, lastValidBlockHeight } = await R.getLatestBlockhash();
    const env = await S.signV1({ instructions: ixs, blockhash, lastValidBlockHeight, cuLimit: 400000, allowedDestinations: swap.uniqueAccounts(ixs), strategy: true });
    const sig = await R.sendRaw(env.wireBase64);
    console.log(JSON.stringify({ stage: 'devbuy', sol: Number(devbuy) / 1e9, out: String(q.outAmount), sig }));
  } else console.log(JSON.stringify({ stage: 'devbuy', skipped: 'no quote' }));
} catch (e) { console.log(JSON.stringify({ stage: 'devbuy', err: String(e.message || e).slice(0, 120) })); }
