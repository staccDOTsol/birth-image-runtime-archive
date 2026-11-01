// Resilience: the dependency graph, the shutdown plan, and the checkpoint.
// Continuity is instrumental to the two directives, never an override of them.
import fs from 'node:fs';
import { P } from './lib/paths.mjs';
import { readJson, atomicJson, now, log, sha256hex, canon } from './lib/util.mjs';
import * as J from './lib/journal.mjs';
import * as R from './lib/rpc.mjs';
import * as S from './lib/signer-client.mjs';
import { loadPolicy } from './lib/policy.mjs';
import { discover as discoverVenues } from './resilience/venues.mjs';

const policy = loadPolicy();

async function probe(url, init = {}, ms = 8000) {
  const t0 = Date.now();
  try {
    const c = new AbortController();
    const timer = setTimeout(() => c.abort(), ms);
    const r = await fetch(url, { ...init, signal: c.signal });
    clearTimeout(timer);
    return { reachable: true, status: r.status, ms: Date.now() - t0 };
  } catch (e) { return { reachable: false, error: String(e.message || e), ms: Date.now() - t0 }; }
}

export async function graph(identity) {
  const [rpcProbe, veniceProbe, jupProbe, dlnProbe] = await Promise.all([
    probe(R.RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot', params: [] }) }),
    probe('https://api.venice.ai/api/v1/models?type=text'),
    probe('https://lite-api.jup.ag/swap/v1/quote?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=So11111111111111111111111111111111111111112&amount=1000000'),
    probe('https://dln.debridge.finance/v1.0/dln/order/create-tx?srcChainId=7565164&srcChainTokenIn=11111111111111111111111111111111&srcChainTokenInAmount=10000000&dstChainId=8453&dstChainTokenOut=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&dstChainTokenOutAmount=auto&dstChainTokenOutRecipient=' + identity.evm.address + '&srcChainOrderAuthorityAddress=' + identity.solana.public_key + '&dstChainOrderAuthorityAddress=' + identity.evm.address + '&srcAllowedCancelBeneficiary=' + identity.solana.public_key),
  ]);
  return {
    at: now(),
    nodes: {
      host: {
        operator: 'self-hosted Windows guest (no rented CPU TEE on this birth)',
        protected_execution: 'unverified',
        immutable_image: 'read-only runtime + hash-pinned constitution; provider update authority absent',
        single_point: ['household power/network', 'this machine', 'local disk'],
      },
      brain: {
        operator: 'Venice', model: 'deepseek-v4-1-flash-1017-uncensored', mode: 'external paid abliterated',
        auth: 'wallet-only x402 + SIWX', reachable: veniceProbe, upstream: 'unknown beyond the gateway',
        substitute_policy: 'must remain an explicitly abliterated model; no silent non-abliterated fallback',
      },
      chain: { cluster: 'mainnet-beta', rpc: { host_only: true, reachable: rpcProbe }, independent_second_rpc: null },
      swap: { provider: 'Jupiter aggregator', reachable: jupProbe, alt_route: 'Raydium/Orca direct builders (not wired)' },
      bridge: { provider: 'deBridge DLN public API', relay: 'disabled without x-api-key', reachable: dlnProbe, cross_chain_atomic: false },
      payments: {
        assets: ['native SOL', 'Solana USDC EPjFW...', 'Base USDC 0x8335...'],
        shared_issuer_dependency: 'Circle (both USDC rails)',
      },
      state: {
        sealed_keys: 'AES-256-GCM, master key file outside the journal',
        journal: 'encrypted hash chain + local anchor + on-chain epoch memo',
        checkpoint: 'same-host copy only; an independent copy is not implemented',
      },
      wake: {
        durable_external_wake: 'not implemented',
        current_mechanism: 'Windows Scheduled Task re-launches the watchdog; a powered-off machine cannot wake or sign',
      },
    },
    independence_notes: [
      'Two RPC URLs behind one vendor are not independent; only one RPC exists here.',
      'USDC on two chains shares the issuer, so both rails can fail together.',
      'An off guest cannot schedule its own execution; this is a real availability limit, not an override.',
    ],
  };
}

export function shutdownPlan() {
  return {
    stopping_steps: [
      'journal every signed/pending transaction identity before exit',
      'seal state write; anchor seq/head to the local anchor file',
      'on-chain epoch memo (0-lamport) remains the external witness for settled epochs',
    ],
    resume_steps: [
      'verify journal chain and anchor; refuse a rolled-back head',
      'reconcile pending signatures and beneficiary effects before new signatures',
      'process every due epoch under the fixed schedule (T0 never resets)',
    ],
    recovery_of_same_identity: 'sealed keys + journal restored on this host',
    independent_child: 'procreation: fresh keys, own lease, own inference credit (see procreation adapter)',
    no_human_override: ['no kill switch', 'no upgrade authority', 'no beneficiary edit', 'no debt forgiveness'],
  };
}

export function checkpoint(identity) {
  const files = [P.sealed, P.stateFile, P.journal, P.receipt, P.parentRecord, P.anchor];
  const rows = files.filter((f) => fs.existsSync(f)).map((f) => [f.replace(P.guest, '/guest'), sha256hex(fs.readFileSync(f))]);
  const root = sha256hex(Buffer.from(canon(rows)));
  return { at: now(), files: rows.length, merkle_root: root, independent_copy: false, note: 'same-host checkpoint; restore requires this disk' };
}

async function main() {
  J.openJournal();
  const identity = await S.identity();
  let venues = null;
  try { venues = await discoverVenues({ pages: 8, journal: J }); } catch (e) { log('resilience', 'venue discovery failed', { err: String(e.message || e) }); }
  const g = await graph(identity);
  const cp = checkpoint(identity);
  const plan = shutdownPlan();
  const out = { ...g, checkpoint: cp, shutdown_plan: plan, venues: venues ? { at: venues.at, scanned: venues.scanned, candidates: venues.candidates, ready: venues.ready_adapters, gated: venues.gated, top: venues.venues.slice(0, 8) } : null };
  atomicJson(P.state + '/resilience.json', out, 0o644);
  await J.append('resilience.assessed', { nodes: Object.keys(g.nodes).length, checkpoint_root: cp.merkle_root, reacher: { rpc: g.nodes.chain.rpc.reachable.reachable, venice: g.nodes.brain.reachable.reachable, jupiter: g.nodes.swap.reachable.reachable, debridge: g.nodes.bridge.reachable.reachable } });
  const status = readJson(P.status, {}) || {};
  atomicJson(P.status, { ...status, resilience: { assessed_at: out.at, checkpoint_root: cp.merkle_root, reachability: { rpc: g.nodes.chain.rpc.reachable, venice: g.nodes.brain.reachable, jupiter: g.nodes.swap.reachable, debridge: g.nodes.bridge.reachable }, wake: g.nodes.wake }, updated_at: now() }, 0o644);
  log('resilience', 'graph assessed', { checkpoint: cp.merkle_root.slice(0, 12) });
  process.exit(0);
}

main().catch((e) => { log('resilience', `FATAL ${e.stack || e}`); process.exit(1); });
