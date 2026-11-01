// Keep every agent above a working float, straight out of the parent's balance, on a loop.
// Overfund, never minfund: an agent below the floor gets topped to TARGET, not to the floor.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RUNTIME_DIR } from '../lib/paths.mjs';

let RPC = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
try { const t = fs.readFileSync(path.join(RUNTIME_DIR, 'dist', 'rpc.txt'), 'utf8').trim(); if (t) RPC = t; } catch {}
process.env.RPC_URL = RPC;
const TARGET = BigInt(process.env.FUND_TARGET_LAMPORTS || '500000000'); // 0.5 SOL — overfund, never minfund
const RESERVE = BigInt(process.env.FUND_RESERVE_LAMPORTS || '50000000');  // keep 0.05 SOL for fees
const MIN_TOPUP = BigInt(process.env.FUND_MIN_TOPUP || '900000');
const MAX_TOPUP = BigInt(process.env.FUND_MAX_TOPUP || '10000000000'); // no ceiling — overfund, the way you asked

const rpc = async (method, params) => {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await r.json()).result;
};

function endpoints() {
  const out = new Set();
  try {
    const roots = JSON.parse(fs.readFileSync(path.join(RUNTIME_DIR, 'docs', 'roots.json'), 'utf8')).roots || [];
    for (const r of roots) if (r.endpoint) out.add(r.endpoint);
  } catch {}
  try {
    const ips = JSON.parse(fs.readFileSync(path.join(RUNTIME_DIR, 'dist', 'vps.json'), 'utf8'));
    for (const ip of (Array.isArray(ips) ? ips : ips.ips || [])) {
      out.add('http://' + ip);
      for (const p of [8081, 8082, 8083, 8084]) out.add(`http://${ip}:${p}`);
    }
  } catch {}
  return [...out];
}

const parentFile = path.join(RUNTIME_DIR, 'dist', 'parent.json');
const parent = fs.existsSync(parentFile) ? JSON.parse(fs.readFileSync(parentFile, 'utf8')).solana : null;
if (!parent) { console.log(JSON.stringify({ err: 'no parent wallet in dist/parent.json' })); process.exit(0); }

let bal = BigInt((await rpc('getBalance', [parent]))?.value || 0);
// Spread mode: leave only the fee reserve and divide the rest evenly across live agents,
// so nothing sits idle in the parent wallet.
const SPREAD = process.env.FUND_SPREAD === '1';
const results = [];

// gen2 too: a child booked with an endpoint is as much a resident as a root
for (const r of (() => { try { return JSON.parse(fs.readFileSync(path.join(RUNTIME_DIR, 'docs', 'roots.json'), 'utf8')).roots || []; } catch { return []; } })()) {
  for (const c of (r.children || [])) if (c.endpoint) endpoints().push(c.endpoint);
}

const eps = endpoints();
const spreadShare = SPREAD ? (bal > RESERVE ? (bal - RESERVE) / BigInt(Math.max(1, eps.length)) : 0n) : 0n;
if (SPREAD) console.log(JSON.stringify({ spread: true, parent: Number(bal) / 1e9, per_agent: Number(spreadShare) / 1e9, targets: eps.length }));
for (const ep of eps) {
  let wallet = null;
  try {
    const j = await (await fetch(ep + '/identity', { signal: AbortSignal.timeout(4000) })).json();
    wallet = j.payload?.solana?.public_key || null;
  } catch { continue; }
  if (!wallet || wallet === parent) continue;
  // Only fund a box that is still answering a moment later: a single probe can catch a box
  // that is already on its way down, and its sealed key dies with it.
  await new Promise((r) => setTimeout(r, 12000));
  try {
    const again = await (await fetch(ep + "/identity", { signal: AbortSignal.timeout(4000) })).json();
    if ((again.payload?.solana?.public_key || null) !== wallet) { results.push({ ep, wallet: wallet.slice(0, 6), skipped: "unstable" }); continue; }
  } catch { results.push({ ep, wallet: wallet.slice(0, 6), skipped: "unstable" }); continue; }
  try {
    const wb = BigInt((await rpc('getBalance', [wallet]))?.value || 0);
    const target = SPREAD ? wb + spreadShare : TARGET;
    if (wb >= target) { results.push({ ep, wallet: wallet.slice(0, 6), skipped: 'above target' }); continue; }
    let want = target - wb;
    if (want > MAX_TOPUP) want = MAX_TOPUP;
    if (want < MIN_TOPUP) { results.push({ ep, wallet: wallet.slice(0, 6), skipped: 'small delta' }); continue; }
    if (bal - want < RESERVE) { results.push({ ep, wallet: wallet.slice(0, 6), skipped: 'parent reserve' }); continue; }
    const { execFileSync } = await import('node:child_process');
    execFileSync(process.execPath, [path.join(RUNTIME_DIR, 'bin', 'fund-child.mjs'), wallet, String(want)], { stdio: 'ignore' });
    bal -= want;
    results.push({ ep, wallet: wallet.slice(0, 6), funded: Number(want) / 1e9 });
  } catch (e) { results.push({ ep, err: String(e.message || e).slice(0, 50) }); }
}

console.log(JSON.stringify({ at: Math.floor(Date.now() / 1000), parent_left: Number(bal) / 1e9, touched: results.filter((r) => r.funded).length, results }));
