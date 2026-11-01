// Solana RPC surface used by every adapter. One endpoint, retried, no hidden wallet.
import fs from 'node:fs';
import os from 'node:os';
import { retry, sleep } from './util.mjs';

// The RPC is a hard dependency of almost every worker. A guest without RPC_URL must still boot,
// so fall back to the public endpoint rather than throwing ENOENT on a dev-box key file.
export const RPC_URL = process.env.RPC_URL
  || (() => { try { return fs.readFileSync(`${os.homedir()}/Documents/triton_api_key.txt`, 'utf8').trim(); } catch { return 'https://api.mainnet-beta.solana.com'; } })();

// Free public RPCs rate-limit hard once twenty agents poll them. Rotate and back off instead
// of hammering one endpoint until it 429s the whole fleet.
// Flux first (both keys), then api.mainnet-beta. Never publicnode: it rejects
// getTokenAccountsByOwner with "Request blocked", which killed the brain worker.
const ENDPOINTS = [
  RPC_URL,
  'https://eu.fluxrpc.com?key=671302ff-6865-4139-80ae-1d9e07fb6e6a',
  'https://api.mainnet-beta.solana.com',
].filter(Boolean);
let epi = 0;
// 24 agents polling balances burn a free RPC quota in minutes. Cache the reads that
// dominate: balances for 8s, token accounts for 20s.
const CACHE_TTL = { getBalance: 8000, getTokenAccountsByOwner: 20000 };
const cache = new Map();
const ckey = (m, p) => m + ':' + JSON.stringify(p);
async function cached(method, params, fn) {
  const ttl = CACHE_TTL[method] || 0;
  if (!ttl) return fn();
  const k = ckey(method, params);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < ttl) return hit.v;
  const v = await fn();
  cache.set(k, { at: Date.now(), v });
  return v;
}
let idc = 0;
export async function rpc(method, params = [], { attempts = 6 } = {}) {
  return cached(method, params, () => retry(async () => {
    const target = ENDPOINTS[epi++ % ENDPOINTS.length] || RPC_URL;
    const r = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++idc, method, params }),
      signal: AbortSignal.timeout(15000),
    });
    if (r.status === 429) { await sleep(400 * (1 + Math.random() * 3)); throw new Error('429 rate limit'); }
    if (!r.ok) throw new Error(`${method}: http ${r.status}`);
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch { throw new Error(`${method}: non-json (${text.slice(0, 60)})`); }
    // Only a valid JSON-RPC envelope counts. A missing/blank result is a failure to answer,
    // not an answer: rotate to the next endpoint and retry instead of returning undefined.
    if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error).slice(0, 120)}`);
    if (j.jsonrpc !== '2.0' || !('result' in j)) throw new Error(`${method}: malformed (${text.slice(0, 60)})`);
    if (j.result === null && method !== 'getBlockTime') throw new Error(`${method}: null result`);
    return j.result;
  }, { attempts, label: method }));
}

export const getBalance = async (pubkey) => (await rpc('getBalance', [pubkey, { commitment: 'confirmed' }])).value;
export const getSlot = async (commitment = 'confirmed') => rpc('getSlot', [{ commitment }]);
export const getBlockTime = async (slot) => rpc('getBlockTime', [slot]).catch(() => null);
export const getLatestBlockhash = async () => (await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value;
export const getGenesisHash = async () => rpc('getGenesisHash', []);
export const getAccountInfo = async (pubkey, encoding = 'base64') => (await rpc('getAccountInfo', [pubkey, { encoding, commitment: 'confirmed' }])).value;

export async function tokenAccounts(owner, programId) {
  const r = await rpc('getTokenAccountsByOwner', [owner, { programId }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  return r.value;
}

export async function mintInfo(mint) {
  return rpc('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]).then((r) => r.value);
}

export async function simulate(wireBase64, watch = []) {
  return rpc('simulateTransaction', [wireBase64, {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
    commitment: 'confirmed', innerInstructions: true,
    accounts: { encoding: 'base64', addresses: watch },
  }]);
}

export async function sendRaw(wire) {
  const b64 = typeof wire === 'string' ? wire : Buffer.from(wire).toString('base64');
  return rpc('sendTransaction', [b64, {
    encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0,
  }]);
}

export async function signatureStatuses(sigs) {
  return (await rpc('getSignatureStatuses', [sigs, { searchTransactionHistory: true }])).value;
}

export async function getTransaction(sig) {
  return rpc('getTransaction', [sig, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }]);
}

export async function getSignaturesForAddress(addr, limit = 20) { return rpc('getSignaturesForAddress', [addr, { limit }]); }

export async function blockHeight() { return rpc('getBlockHeight', [{ commitment: 'confirmed' }]); }
