// Box-for-box P&L. For every live agent: SOL + every SPL and Token-2022 account it holds,
// each quoted to USDC through Jupiter, minus what the box costs to run. Reports per box and
// per fleet, so "are we making money" is a number instead of a vibe.
import fs from 'node:fs';

const RPC = fs.readFileSync('dist/rpc.txt', 'utf8').trim();
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SPL = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const T22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLCb5Zg2g5N5x6K6K6K6'; // Token-2022 program id below is authoritative
const T22_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const BOXES = (process.env.BOXES || (() => { try { const a = JSON.parse(fs.readFileSync('dist/vps.json', 'utf8')); return (Array.isArray(a) ? a : a.ips).join(','); } catch { return ''; } })()).split(',').filter(Boolean);
const BOX_COST_USD_PER_DAY = Number(process.env.BOX_COST || 0.35);

const rpc = async (method, params) => {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
};
const solUsd = async () => {
  try {
    const q = await (await fetch(`https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${USDC}&amount=1000000000&slippageBps=50`)).json();
    return Number(q.outAmount) / 1e6;
  } catch { return 0; }
};
const JUP_KEY = process.env.JUP_API_KEY || (fs.readFileSync("dist/jup.key","utf8").trim()) || "jup_928fb80ecd518586abd99371fc46506bb398758ce74c12358393da774bc0d591";
const priceCache = new Map();
const usdPrice = async (mint) => {
  if (priceCache.has(mint)) return priceCache.get(mint);
  let p = 0;
  try {
    const j = await (await fetch("https://api.jup.ag/price/v3?ids=" + mint, { headers: { "x-api-key": JUP_KEY }, signal: AbortSignal.timeout(8000) })).json();
    p = Number(j?.[mint]?.usdPrice || 0);
  } catch {}
  if (!p) {
    try {
      const d = await (await fetch("https://api.dexscreener.com/latest/dex/tokens/" + mint, { signal: AbortSignal.timeout(8000) })).json();
      p = Number(d?.pairs?.[0]?.priceUsd || 0);
    } catch {}
  }
  priceCache.set(mint, p);
  return p;
};
const quoteUsd = async (mint, raw, decimals = 6) => {
  const px = await usdPrice(mint);
  return px ? (Number(raw) / 10 ** decimals) * px : 0;
};

const solPx = await solUsd();
const rows = [];
for (const ip of BOXES) {
  const box = { ip, agents: 0, sol: 0, tokens_usd: 0, usdc: 0, mints: 0 };
  for (const port of [80, 8081, 8082, 8083]) {
    const ep = `http://${ip}${port === 80 ? '' : ':' + port}`;
    let wallet = null;
    try { wallet = (await (await fetch(ep + '/identity', { signal: AbortSignal.timeout(3000) })).text()).match(/"public_key":\s*"([1-9A-HJ-NP-Za-km-z]{32,44})"/)?.[1]; } catch { continue; }
    if (!wallet) continue;
    box.agents++;
    try { box.sol += Number((await rpc('getBalance', [wallet])).value || 0) / 1e9; } catch {}
    for (const program of [SPL, T22_ID]) {
      let accs = [];
      try { accs = (await rpc('getTokenAccountsByOwner', [wallet, { programId: program }, { encoding: 'jsonParsed' }])).value || []; } catch { continue; }
      for (const a of accs) {
        const info = a.account?.data?.parsed?.info;
        if (!info) continue;
        const raw = info.tokenAmount?.amount;
        if (!raw || raw === '0') continue;
        box.mints++;
        if (info.mint === USDC) { box.usdc += Number(raw) / 1e6; continue; }
        box.tokens_usd += await quoteUsd(info.mint, raw, info.tokenAmount?.decimals ?? 6).catch(() => 0);
      }
    }
  }
  box.sol_usd = box.sol * solPx;
  box.value_usd = box.sol_usd + box.tokens_usd + box.usdc;
  box.cost_per_day = box.agents > 0 ? BOX_COST_USD_PER_DAY : 0;
  rows.push(box);
}
const total = rows.reduce((s, b) => ({ agents: s.agents + b.agents, value: s.value + b.value_usd, sol: s.sol + b.sol_usd, tok: s.tok + b.tokens_usd, usdc: s.usdc + b.usdc, cost: s.cost + b.cost_per_day }), { agents: 0, value: 0, sol: 0, tok: 0, usdc: 0, cost: 0 });
console.log(JSON.stringify({ sol_price_usd: Number(solPx.toFixed(2)), boxes: rows, fleet: { ...total, value: Number(total.value.toFixed(2)), sol: Number(total.sol.toFixed(2)), tok: Number(total.tok.toFixed(2)), usdc: Number(total.usdc.toFixed(2)), cost: Number(total.cost.toFixed(2)) } }, null, 1));
