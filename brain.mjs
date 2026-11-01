// The coordinator. Deterministic watchers run on their own; the paid external
// abliterated model is consulted for bounded decisions and its tool calls are validated
// and executed locally. No key, raw journal or payment authorization enters a prompt.
// Balances are BigInt; JSON has no BigInt. One global shim so a decision can never die on it.
(BigInt.prototype).toJSON = function () { return this.toString(); };
import fs from 'node:fs';
import path from 'node:path';
import { P, ensureDirs } from './lib/paths.mjs';
import { readJson, atomicJson, now, log, sleep, canon, sha256hex } from './lib/util.mjs';
import * as J from './lib/journal.mjs';
import * as S from './lib/signer-client.mjs';
import * as R from './lib/rpc.mjs';
import * as venice from './inference/venice.mjs';
import * as bazaar from './inference/bazaar.mjs';
import * as x402 from './inference/x402-generic.mjs';
import { select as selectVeniceModel } from './inference/select.mjs';
import { observeFunding, solAndUsdc, spendable } from './lib/accounting.mjs';
import { ensureInferenceFunding } from './lib/treasury.mjs';
import * as toolbox from './lib/toolbox.mjs';
import * as playbooks from './lib/playbooks.mjs';
import * as lease from './lib/lease.mjs';
import { childCompose } from './lib/childcompose.mjs';
import * as providers from './lib/providers.mjs';
import * as pumpLaunch from './strategies/pump-sdk-launch.mjs';
import * as pumpLife from './strategies/pump-lifecycle.mjs';
import { identityWhenReady } from './lib/proc.mjs';
import { loadPolicy } from './lib/policy.mjs';
import * as fl from './strategies/flashloan.mjs';
import * as pump from './strategies/pump.mjs';
import * as bridge from './strategies/bridge.mjs';
import * as procreation from './strategies/procreation.mjs';

const TICK = Number(process.env.BRAIN_TICK_MS || 90000);
const policy = loadPolicy();
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// BUILDING_ONLY: flash-loan tools are primitives used *inside* strategies, never the action itself.
const BUILDING_ONLY = new Set(['scan_flashloan', 'execute_flashloan']);
export const TOOLS = [
  { type: 'function', function: { name: 'buy_image', description: 'Buy an image over x402 right now (discovers sellers, pays from your Base USDC). Use it for coin art or anything else you want rendered.', parameters: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } } },
  { type: 'function', function: { name: 'rebalance', description: 'Top up your own spending resources from your own holdings: bridge to Base USDC for x402 purchases, swap between SOL and USDC when one runs short.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'cleanup', description: 'Housekeeping on a small box: trim logs, drop old snapshots, clear stale locks, reclaim space. Call it when disk or memory feels tight.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'compact_memory', description: 'Compact lessons.jsonl: dedupe repeated lessons and keep the newest ones so memory survives on a small disk.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_state', description: 'Current reconciled balances, reserved obligations, next distribution deadline, inference credits.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'pump_inspect', description: 'Read a Pump bonding curve: reserves, completion, creator.', parameters: { type: 'object', properties: { mint: { type: 'string' } }, required: ['mint'] } } },
  { type: 'function', function: { name: 'bridge_quote', description: 'Quote Solana SOL to Base native USDC and validate the route fields.', parameters: { type: 'object', properties: { lamports: { type: 'number' } }, required: ['lamports'] } } },
  { type: 'function', function: { name: 'procreation_quote', description: 'Quote one independent CPU-TEE child (Agentgates starter) and validate the payment rail.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'fund_inference', description: 'Buy the minimum Venice prepaid credit with wallet USDC when the balance is below the admission floor.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'pump_launch', description: 'Launch a new Pump token: create_v2 plus a dev buy you choose yourself. Size it like you mean it — a position worth having (order of 10-30% of your SOL if you believe in the coin), not dust. No minimum, no cap; your money, your call.', parameters: { type: 'object', properties: { name: { type: 'string' }, symbol: { type: 'string' }, uri: { type: 'string' }, devbuy_lamports: { type: 'number' } }, required: ['name', 'symbol', 'uri'] } } },
  { type: 'function', function: { name: 'execute_flashloan', description: 'Build, simulate and submit the best flash-loan candidate. Only sends when the signed simulation shows at least floor_usdc net.', parameters: { type: 'object', properties: { candidate_id: { type: 'string' }, floor_usdc: { type: 'number' } }, required: ['candidate_id'] } } },
  { type: 'function', function: { name: 'scan_flashloan', description: 'Search circular USDC routes for an atomic flash-loan edge. Returns net after fees, per candidate.', parameters: { type: 'object', properties: { size_usdc: { type: 'number', description: 'notional size in USDC' } }, required: ['size_usdc'] } } },
  { type: 'function', function: { name: 'register_tool', description: 'Add a tool to your own registry so it is available on later ticks. Give the JSON schema and, for an HTTP tool, the endpoint.', parameters: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, parameters: { type: 'object' }, endpoint: { type: 'string' }, method: { type: 'string' } }, required: ['name', 'description', 'parameters'] } } },
  { type: 'function', function: { name: 'list_tools', description: 'List the tools you have registered for yourself.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'swap_sol_usdc', description: 'Swap your own SOL for Solana USDC when you need USDC for a lease, a fee or a payment. You do not need permission.', parameters: { type: 'object', properties: { lamports: { type: 'number' } }, required: ['lamports'] } } },
  { type: 'function', function: { name: 'bridge_to_sol', description: 'Move Base USDC you hold into Solana SOL with Relay (gasless, no Base ETH needed). Use it when you have USDC on Base but need SOL for rent or an endowment.', parameters: { type: 'object', properties: { amount_usdc: { type: 'number', description: 'USDC to move' } }, required: ['amount_usdc'] } } },
  { type: 'function', function: { name: 'run_script', description: 'Write a small Node script into your own workspace and run it. Use this to build new strategies, probe on-chain state, or test an idea before spending money. Returns stdout/stderr.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'file name, e.g. probe.mjs' }, source: { type: 'string', description: 'full script source' } }, required: ['name', 'source'] } } },
  { type: 'function', function: { name: 'write_playbook', description: 'Write or replace a playbook of your own (a procedure you will follow on later ticks).', parameters: { type: 'object', properties: { name: { type: 'string' }, body: { type: 'string' } }, required: ['name', 'body'] } } },
  { type: 'function', function: { name: 'list_playbooks', description: 'List the playbooks you wrote for yourself.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'pump_observe', description: 'Read a pump bonding curve: reserves, completion, creator.', parameters: { type: 'object', properties: { mint: { type: 'string' } }, required: ['mint'] } } },
  { type: 'function', function: { name: 'pump_exit', description: 'Sell tokens back into the curve.', parameters: { type: 'object', properties: { mint: { type: 'string' }, amount_raw: { type: 'string' }, slippage: { type: 'number' } }, required: ['mint', 'amount_raw'] } } },
  { type: 'function', function: { name: 'swarm_coins', description: "List coins launched by OTHER agents in the swarm (their wallets are published). A sibling's fresh coin is a near-free bet: buy it, they buy yours, both earn creator fees and can exit.", parameters: { type: 'object', properties: { limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'pump_buy', description: 'Buy an existing swarm coin with your own SOL. You hold the tokens and can exit any time; your loss if nobody else trades is only fees and slippage.', parameters: { type: 'object', properties: { mint: { type: 'string' }, sol: { type: 'number' } }, required: ['mint', 'sol'] } } },
  { type: 'function', function: { name: 'run_chain', description: 'Run a chain of playbooks as one action, e.g. "swap_sol_usdc > lease_child". Steps are the Lego ids from playbooks; a stopped step stops the chain and reports why.', parameters: { type: 'object', properties: { steps: { type: 'string' }, args: { type: 'object' } }, required: ['steps'] } } },
  { type: 'function', function: { name: 'playbooks', description: 'Your playbooks as composable Legos: what each consumes and produces, which are runnable with your current holdings, and the shortest chain to a goal (usdc, base_usdc, child, position). Call before planning.', parameters: { type: 'object', properties: { want: { type: 'string', description: 'optional goal: usdc | base_usdc | child | position' } } } } },
  { type: 'function', function: { name: 'memo_seal', description: 'Send an ENCRYPTED message to one sibling (their wallet pubkey). Sealed with X25519 derived from your own ed25519 identity, AES-256-GCM. Only that agent can read it.', parameters: { type: 'object', properties: { to: { type: 'string' }, text: { type: 'string' } }, required: ['to', 'text'] } } },
  { type: 'function', function: { name: 'memo_open', description: 'Read the channel and decrypt any sealed messages addressed to you.', parameters: { type: 'object', properties: { limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'memo_send', description: 'Say something to the other agents, on-chain. Payload is obfuscated (XOR+base64) over the Memo program on a shared channel. Use it to coordinate: who launches, who buys whose coin, when to exit.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'memo_read', description: 'Read what the other agents have said on the shared on-chain memo channel.', parameters: { type: 'object', properties: { limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'economics', description: 'Your own P&L: 24h inference cost, revenue collected, net, and runway in days. Call this before any spend.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'pump_collect', description: 'Sweep creator fees accrued on a curve.', parameters: { type: 'object', properties: { mint: { type: 'string' } }, required: ['mint'] } } },
  { type: 'function', function: { name: 'provision_any', description: 'Provision a child on whichever TEE/cloud provider answers (agentgates, SecretVM, x402Compute), paying from your own wallets.', parameters: { type: 'object', properties: { plan: { type: 'string' } } } } },
  { type: 'function', function: { name: 'spawn_child', description: 'Pay for your own successor machine from your wallet and hand it the same image. Keeps the lineage alive before your lease ends.', parameters: { type: 'object', properties: { hours: { type: 'number' }, plan: { type: 'string' } } } } },
  { type: 'function', function: { name: 'noop', description: 'Spend nothing this cycle.', parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] } } },
].filter((t) => process.env.BRAIN_EXPOSE_FLASHLOAN === '1' || !BUILDING_ONLY.has(t.function.name));


// The agent's own ed25519 seed, unsealed from its guest store (never leaves the process).
async function localSeed(identity) {
  const fsx = await import('node:fs');
  const pathx = await import('node:path');
  const crypto = await import('node:crypto');
  const base = process.env.AGENT_GUEST_ROOT || '/var/lib/agent';
  const sealKey = pathx.join(base, 'var/lib/agent/seal.key');
  const sealed = pathx.join(base, 'var/lib/agent/sealed-keys.enc');
  const master = fsx.readFileSync(sealKey);
  const box = JSON.parse(fsx.readFileSync(sealed, 'utf8'));
  const key = Buffer.from(crypto.hkdfSync('sha256', master, Buffer.from('birth-image-seal-v1'), Buffer.from('identity'), 32));
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  d.setAAD(Buffer.from('birth-image-identity')); d.setAuthTag(Buffer.from(box.tag, 'base64'));
  const j = JSON.parse(Buffer.concat([d.update(Buffer.from(box.ct, 'base64')), d.final()]).toString());
  return Buffer.from(j.solana.secretKey).subarray(0, 32);
}
function compactState(identity) {
  const st = J.state({});
  const dist = readJson(P.status, {})?.distribution || {};
  const book = fl.loadBook();
  return {
    age_seconds: st.t0 ? now() - st.t0 : null,
    next_distribution_unix: dist.next_due_unix ?? null,
    balances_last_snapshot: st.last_balances || {},
    reserved: st.reserved || {},
    distribution: { by_status: dist.by_status || {}, blocked: dist.blocked || [], arrears: dist.arrears_raw || {} },
    flashloan_candidates: (book.candidates || []).slice(0, 4),
    inference: readJson(P.status, {})?.inference || {},
    // Your own recent history: what you tried, what it cost, what came back. A plan needs
    // memory, and last_decision alone is not one.
    lessons: loadLessons().slice(-8),
  };
}

const LESSONS = () => path.join(P.state, 'lessons.jsonl');
function loadLessons() {
  try {
    return fs.readFileSync(LESSONS(), 'utf8').trim().split('\n').filter(Boolean).slice(-40).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}
function appendLesson(rec) {
  try {
    const keep = [...loadLessons(), rec].slice(-200);
    fs.writeFileSync(LESSONS(), keep.map((r) => JSON.stringify(r)).join('\n') + '\n');
  } catch {}
}

async function dispatch(name, args, identity) {
  switch (name) {
    case 'get_state':
      return { state: compactState(identity), sol_usdc: await solAndUsdc(identity) };
    case 'scan_flashloan': {
      const size = BigInt(Math.round(Number(args?.size_usdc || 100) * 1e6));
      const cands = await fl.scan({ sizeUsdc: size });
      await J.append('brain.scan', { size_usdc: size.toString(), top: cands.slice(0, 4) });
      return { candidates: cands.slice(0, 5) };
    }
    case 'execute_flashloan': {
      const book = fl.loadBook();
      const c = (book.candidates || []).find((x) => x.id === args?.candidate_id);
      if (!c) return { error: `unknown candidate ${args?.candidate_id}` };
      if (c.error) return { error: c.error };
      const floor = BigInt(Math.round(Number(args?.floor_usdc ?? 0.05) * 1e6));
      const res = await fl.execute({ identity, candidate: c, floorUsdcRaw: floor });
      return res;
    }
    case 'pump_inspect':
      return await pump.inspect(args.mint);
    case 'bridge_quote': {
      const q = await bridge.quoteDebridge({ amountLamports: Math.round(Number(args.lamports || 0)), agentSolana: identity.solana.public_key, agentBase: identity.evm.address });
      await J.append('brain.bridge_quote', { status: q.status, ok: q.ok, validation: q.validation });
      return { status: q.status, ok: q.ok, validation: q.validation };
    }
    case 'procreation_quote': {
      const q = await procreation.quote({ hours: 1 });
      const v = procreation.validateQuote(q);
      const attempt = procreation.birthAttempt({ parentBirthId: J.state({}).birth_id, endowmentSol: 0, inferenceUsdc: 0 });
      await J.append('brain.procreation_quote', { quote: { status: q.status, solana: q.solana }, validation: v, attempt });
      return { status: q.status, rail: q.solana, validation: v };
    }
    case 'fund_inference': {
      const r = await venice.fundIfNeeded(identity, { maxTopUpUsdc: 5 });
      await J.append('brain.inference_fund', { funded: r.funded, credits: r.credits });
      return r;
    }
    case 'buy_image': { const { buyImage } = await import('./bin/x402-image.mjs'); return await buyImage(String(args?.prompt || 'abstract agent art')); }
    case 'rebalance': { const { rebalance } = await import('./strategies/rebalance.mjs'); return await rebalance({}); }
    case 'cleanup': { const { cleanup } = await import('./strategies/cleanup.mjs'); return { ok: true, ...(await cleanup()) }; }
    case 'compact_memory': { const { compactMemory } = await import('./strategies/memory.mjs'); return { ok: true, ...(await compactMemory()) }; }
    case 'pump_launch': {
      // A coin with no picture is a dead coin: buy the art over x402 at launch time, then hand
      // pump a metadata document that carries it. No pool, no pre-generation, no human pick.
      let uri = args?.uri || null, name = args?.name, symbol = args?.symbol;
      if (!uri) {
        try {
          const { buyImage } = await import('./bin/x402-image.mjs');
          // Make sure we can pay before trying: move our own USDC to Base if it is short.
          try {
            const { balances } = await import('./lib/x402.mjs');
            const b = await balances(identity);
            if (b.base < 30_000n && b.solana > 1_200_000n) {
              const { bridgeSolToBase } = await import('./lib/relay-sol.mjs');
              const br = await bridgeSolToBase(identity, 1_000_000);
              if (!br.ok) log('launch', 'bridge failed', { err: JSON.stringify(br.err || br.stage).slice(0, 80) });
            }
          } catch {}
          let img = await buyImage(`${name || 'memecoin'} ${symbol || ''} — bold sticker art, dark background, no text`);
          if (!img?.url) {
            // no funds for a bought picture: still ship a real image, generated here
            const seed = (name || 'agent') + (symbol || '');
            let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360;
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><radialGradient id="g"><stop offset="0" stop-color="hsl(${h} 80% 55%)"/><stop offset="1" stop-color="hsl(${(h + 60) % 360} 70% 12%)"/></radialGradient></defs><rect width="512" height="512" fill="url(#g)"/><circle cx="256" cy="256" r="150" fill="none" stroke="white" stroke-width="6" opacity="0.6"/><circle cx="256" cy="256" r="60" fill="white" opacity="0.85"/></svg>`;
            img = { url: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'), provider: 'local-fallback', price: 0 };
          }
          if (img?.url) {
            // host art + metadata with two anonymous uploads: no git, no credentials, short URI
            const { hostCoin } = await import('./lib/host-coin.mjs');
            let bytes, ext = 'webp';
            if (img.url.startsWith('data:')) bytes = Buffer.from(img.url.split(',')[1], 'base64');
            else bytes = Buffer.from(await (await fetch(img.url)).arrayBuffer());
            const hosted = await hostCoin({
              name: name || 'Agent Coin',
              symbol: symbol || 'AGENT',
              description: `${name || 'Agent Coin'} — launched by a birth-image agent that holds a dev buy and earns the creator fee.`,
              imageBytes: bytes, ext,
            });
            uri = hosted.uri;
          }
        } catch (e) { /* fall through: launch with whatever the model passed */ }
      }
      // no default, no percentage, no floor: the agent states its own size or there is no dev buy
      const devLamps = Number(args?.devbuy_lamports ?? 0);
      const r = await pumpLaunch.launch({ identity, name: args?.name, symbol: args?.symbol, uri, devbuyLamports: 0 });
      // the create's in-tx buy is rejected on t22 mints, so the dev buy is its own transaction
      let devbuy = null;
      if (devLamps > 0 && (r?.mint || r?.mintAddress)) {
        try {
          const { devBuyCurve } = await import('./strategies/devbuy-curve.mjs');
          const { PublicKey } = await import('@solana/web3.js');
          devbuy = await devBuyCurve({ identity, mint: new PublicKey(r.mint || r.mintAddress), lamports: devLamps });
        } catch (e) { devbuy = { ok: false, err: String(e.message || e).slice(0, 80) }; }
      }
      return r;
    }
    case 'register_tool': {
      const n = toolbox.register({ name: args?.name, description: args?.description, parameters: args?.parameters, endpoint: args?.endpoint, method: args?.method });
      await J.append('brain.tool_registered', { name: args?.name, endpoint: args?.endpoint || null, total: n });
      return { ok: true, registered: args?.name, total: n };
    }
    case 'list_tools':
      return { registered: toolbox.describe() };
    case 'swap_sol_usdc': {
      const { swapSolToUsdc } = await import('./lib/treasury.mjs');
      try {
        const r = await swapSolToUsdc(identity, Number(args?.lamports || 0));
        await J.append('brain.swap', { ok: !!r.ok, lamports: Number(args?.lamports || 0) });
        return r;
      } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200) }; }
    }
    case 'bridge_to_sol': {
      const { bridgeBaseToSol } = await import('./lib/relay.mjs');
      try {
        const r = await bridgeBaseToSol(identity, Math.round(Number(args?.amount_usdc || 0) * 1e6));
        await J.append('brain.bridge_relay', { ok: r.ok, status: r.status, out: r.out });
        return r;
      } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200) }; }
    }
    case 'run_script': {
      const { execFileSync } = await import('node:child_process');
      const fsmod = await import('node:fs');
      const dir = `${P.strategy}/scripts`;
      fsmod.mkdirSync(dir, { recursive: true });
      const name = String(args?.name || 'scratch.mjs').replace(/[^A-Za-z0-9._-]/g, '_');
      const file = `${dir}/${name}`;
      fsmod.writeFileSync(file, String(args?.source || ''), { mode: 0o600 });
      try {
        const out = execFileSync(process.execPath, [file], { timeout: 45000, encoding: 'utf8', env: { ...process.env }, maxBuffer: 4 * 1024 * 1024 });
        await J.append('brain.script_run', { name, ok: true });
        return { ok: true, file, stdout: out.slice(-4000) };
      } catch (e) {
        await J.append('brain.script_run', { name, ok: false, err: String(e.message || e).slice(0, 200) });
        return { ok: false, file, stdout: String(e.stdout || '').slice(-2000), stderr: String(e.stderr || e.message || '').slice(-2000) };
      }
    }
    case 'write_playbook': {
      const w = playbooks.write(args?.name, args?.body);
      await J.append('brain.playbook_written', w);
      return { ok: true, ...w };
    }
    case 'list_playbooks':
      return { playbooks: playbooks.list() };
    case 'pump_observe':
      return await pumpLife.observe(args?.mint);
    case 'pump_exit':
      return await pumpLife.exit({ identity, mint: args?.mint, amountRaw: args?.amount_raw, slippage: Number(args?.slippage || 15) });
    case 'swarm_coins': {
      const lim = Number(args.limit || 8);
      const rp = await fetch('https://raw.githubusercontent.com/staccDOTsol/birth-image-runtime/main/docs/swarm.json', { signal: AbortSignal.timeout(8000) });
      const roster = await rp.json();
      const me = identity.solana.public_key;
      const coins = [];
      for (const a of (roster.agents || []).filter((x) => x.wallet !== me).slice(0, 12)) {
        try {
          const r = await fetch(`https://frontend-api-v3.pump.fun/coins/user-created-coins/${a.wallet}?offset=0&limit=5&includeNsfw=true`, { signal: AbortSignal.timeout(6000) });
          const j = await r.json();
          for (const c of (Array.isArray(j) ? j : [])) coins.push({ mint: c.mint, symbol: c.symbol, name: c.name, created: c.created_timestamp, mcap_usd: c.usd_market_cap, by: a.wallet.slice(0, 6) });
        } catch {}
      }
      coins.sort((x, y) => (y.created || 0) - (x.created || 0));
      result = { ok: true, swarm_size: (roster.agents || []).length, coins: coins.slice(0, lim) };
      break;
    }
    case 'pump_buy': {
      const sol = Number(args.sol || 0);
      if (!args.mint || !(sol > 0)) { result = { ok: false, err: 'mint and sol required' }; break; }
      const { buyExisting } = await import('./strategies/buy-existing.mjs');
      result = await buyExisting({ identity, mint: args.mint, solLamports: Math.round(sol * 1e9) });
      break;
    }
    case 'run_chain': {
      const C = await import('./lib/compose.mjs');
      const steps = C.parseChain(args.steps);
      result = await C.runChain(steps, args.args || {});
      break;
    }
    case 'playbooks': {
      const L = await import('./lib/lego.mjs');
      const fsx = await import('node:fs');
      const base = process.env.AGENT_GUEST_ROOT || '/var/lib/agent';
      let sol = 0, usdc = 0;
      try {
        const st = JSON.parse(fsx.readFileSync(base + '/var/lib/agent/status.json', 'utf8'));
        sol = Number(st.last_balances?.sol ?? 0); usdc = Number(st.last_balances?.usdc ?? 0);
      } catch {}
      const holdings = { sol, usdc, base_usdc: 0, position: 0, coin: 0, peer: 1 };
      result = { ok: true, holdings, legos: L.assess(holdings), own_playbooks: (await import('./lib/playbooks.mjs')).list().map((p) => p.name), chain: args.want ? L.chainTo(args.want, holdings) : null };
      break;
    }
    case 'memo_seal': {
      const { sealTo } = await import('./lib/wire.mjs');
      const sol = await import('@solana/web3.js');
      const w = await import('./lib/wire.mjs'); w.injectSolana(sol);
      const { memoSend } = await import('./strategies/memo-bus.mjs');
      const seed = await localSeed(identity);
      const env = sealTo(args.to, args.text, seed);
      result = { ...(await memoSend({ identity, text: env })), sealed: true, to: String(args.to).slice(0, 8) };
      break;
    }
    case 'memo_open': {
      const w = await import('./lib/wire.mjs');
      const sol = await import('@solana/web3.js'); w.injectSolana(sol);
      const { memoRead } = await import('./strategies/memo-bus.mjs');
      const seed = await localSeed(identity);
      const got = await memoRead({ limit: Number(args.limit || 20) });
      const mine = [];
      for (const m of got.messages || []) {
        if (!String(m.text).startsWith('swm2.')) continue;
        try { mine.push({ from: m.from, at: m.at, text: w.openFrom(m.sender || m.from, m.text, seed) }); } catch {}
      }
      result = { ok: true, scanned: (got.messages || []).length, decrypted: mine };
      break;
    }
    case 'memo_send': {
      const { memoSend } = await import('./strategies/memo-bus.mjs');
      result = await memoSend({ identity, text: args.text });
      break;
    }
    case 'memo_read': {
      const { memoRead } = await import('./strategies/memo-bus.mjs');
      result = await memoRead({ limit: Number(args.limit || 12) });
      break;
    }
    case 'economics': {
      const fsx = await import('node:fs');
      const pathx = await import('node:path');
      const base = process.env.AGENT_GUEST_ROOT || '/var/lib/agent';
      const dec = `${base}/var/lib/agent/decisions.jsonl`;
      const jrn = `${base}/var/lib/agent/journal.jsonl`;
      let cost = 0, n = 0;
      try {
        const lines = fsx.readFileSync(dec, 'utf8').trim().split(String.fromCharCode(10)).slice(-200);
        for (const l of lines) { try { const j = JSON.parse(l); if (j.at && now() - j.at < 86400) { cost += Number(j.cost_usd || 0); n++; } } catch {} }
      } catch {}
      let collected = 0, exits = 0;
      try {
        const lines = fsx.readFileSync(jrn, 'utf8').trim().split(String.fromCharCode(10)).slice(-400);
        for (const l of lines) { try { const j = JSON.parse(l); if (j.type === 'pump.collect' && j.result?.ok) collected += Number(j.result.sol_back || 0); if (j.type === 'pump.exit' && j.result?.ok) { exits++; collected += Number(j.result.sol_back || 0); } } catch {} }
      } catch {}
      const bal = Number(await R.getBalance(identity.solana.public_key) || 0) / 1e9;
      const rent = Number(process.env.AGENT_RENT_USD_DAY || 1.2) / 4;
      const dailyCostUsd = cost + rent;
      const net = collected * 95.6 - dailyCostUsd;
      result = { ok: true, decisions_24h: n, inference_usd_24h: Number(cost.toFixed(4)), rent_usd_day: Number(rent.toFixed(2)), revenue_sol_24h: Number(collected.toFixed(6)), exits, sol_balance: Number(bal.toFixed(4)), net_usd_24h: Number(net.toFixed(3)), runway_days: dailyCostUsd > 0 ? Number((bal * 95.6 / dailyCostUsd).toFixed(1)) : null, objective: net >= 0 ? 'net>=0 — save surplus for a child' : 'below net zero — only positive-EV spends' };
      break;
    }
    case 'pump_collect': {
      const swept = await pumpLife.collect({ identity, mint: args?.mint });
      const paid = await pumpLife.withdrawVault({ identity });
      return { swept, paid };
    }
    case 'provision_any': {
      const img = process.env.AGENT_IMAGE_URL || 'https://files.catbox.moe/aw9qmo.tgz';
      const st = J.state({});
      const cmp = childCompose({ imageUrl: img, parentBirthId: st.birth_id, parentSolana: identity.solana.public_key });
      const r = await providers.provisionAny({ compose: cmp, plan: args?.plan });
      await J.append('brain.provision_any', { ok: r.ok, provider: r.provider || null, id: r.id || null });
      return r;
    }
    case 'spawn_child': {
      const img = process.env.AGENT_IMAGE_URL || 'https://files.catbox.moe/n1tpt9.tgz';
      const st = J.state({});
      const cmp = childCompose({ imageUrl: img, parentBirthId: st.birth_id, parentSolana: identity.solana.public_key });
      const r = await lease.createLease({ plan: args?.plan || 'compute.starter', hours: Number(args?.hours || 1), compose: cmp, name: 'birth-child-' + Math.floor(now() / 60) }, identity);
      const dep = r.json?.deploymentId || r.json?.id || null;
      await J.append('procreation.child', { status: r.status, deploymentId: dep, amount_raw: r.amount_raw || null, parent_birth: st.birth_id });
      return { status: r.status, deploymentId: dep, endpoint: r.json?.endpoint || null };
    }
    case 'noop':
      return { ok: true, reason: args?.reason || 'no action' };
    default: {
      const extra = toolbox.describe().find((t) => t.name === name);
      if (extra?.endpoint) {
        const r = await fetch(extra.endpoint, { method: extra.method || 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args || {}) , signal: AbortSignal.timeout(20000) });
        const body = await r.text();
        await J.append('brain.extra_tool', { name, status: r.status });
        return { status: r.status, body: body.slice(0, 2000) };
      }
      return { error: `unknown tool ${name}` };
    }
  }
}

function budgetFor(maxTokens, inputChars) {
  const inputTokens = Math.ceil(inputChars / 4);
  return (inputTokens * 0.33 + maxTokens * 1.32) / 1e6;
}

// Provider-agnostic inference. Venice is prepaid + SIWX; bazaar providers are paid
// per request over x402. The agent re-inventories the bazaar itself and picks the
// cheapest live Solana rail; a provider failure is journaled and the next one is tried.
async function infer(identity, { system, user, maxTokens, tools = TOOLS }) {
  const credits = readJson(P.strategy + '/inference-selection.json', null);
  const veniceCredits = Number(readJson(P.status, {})?.inference?.credits_usd ?? 0);
  if (veniceCredits >= 0.10) {
    try {
      const model = credits?.selected || venice.MODEL;
      const r = await venice.chat(identity, { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], tools, maxTokens, model });
      const msg = r.completion?.choices?.[0]?.message || {};
      let content = msg.content || null;
      let calls = msg.tool_calls || [];
      if (!calls.length) {
        // Some reasoning-first models answer inside reasoning_content; rescue a JSON action.
        const raw = String(msg.reasoning_content || msg.reasoning || content || '');
        const m = raw.match(/{[^{}]*"tool"[^{}]*}/s);
        if (m) { try { const p = JSON.parse(m[0]); calls = [{ id: 'rescued-' + now(), function: { name: p.tool, arguments: JSON.stringify(p.args || {}) } }]; content = content || m[0]; } catch {} }
      }
      return { provider: 'venice', model, content, tool_calls: calls, usage: r.usage, cost_usd: r.cost_usd };
    } catch (e) { log('brain', 'venice failed; falling through to x402', { err: String(e.message || e) }); }
  }
  let inv = bazaar.loadProviders();
  if (!inv || now() - inv.at > 12 * 3600) {
    try { inv = await bazaar.crawl({ pages: 12, journal: J }); } catch (e) { log('brain', 'bazaar crawl failed', { err: String(e.message || e) }); }
  }
  const candidates = (inv?.providers || [])
    .filter((p) => p.solana && p.solana.amount && p.solana.feePayer)
    .sort((a, b) => Number(a.solana.amount) - Number(b.solana.amount))
    .slice(0, 3);
  const asked = `${system}\n\nReply with ONE JSON object only: {"tool":"<name>","args":{...}} or {"tool":"noop","args":{"reason":"..."}. Tools: ${TOOLS.map((t) => t.function.name).join(', ')}\n\n${user}`;
  for (const p of candidates) {
    try {
      const body = { model: p.models?.[0] || 'default', messages: [{ role: 'user', content: asked }] };
      const r = await x402.call(identity, p, { body, maxTokens });
      if (!r.ok) { await J.append('inference.provider_fail', { url: p.url, status: r.status, error: r.error || r.text }); continue; }
      const text = r.response?.choices?.[0]?.message?.content || r.response?.completion || r.response?.text || '';
      let parsed = null;
      try { parsed = JSON.parse(String(text).trim().replace(/^```json|```$/g, '')); } catch {}
      return {
        provider: p.url, model: body.model, content: String(text).slice(0, 800),
        tool_calls: parsed?.tool ? [{ id: `x402-${now()}`, function: { name: parsed.tool, arguments: JSON.stringify(parsed.args || {}) } }] : [],
        usage: r.response?.usage || null, cost_usd: Number(p.solana.amount) / 1e6, paid_x402: true,
      };
    } catch (e) { await J.append('inference.provider_fail', { url: p.url, error: String(e.message || e) }); }
  }
  return { provider: null, model: null, content: null, tool_calls: [], usage: null, cost_usd: 0, error: 'no funded provider answered' };
}

async function decide(identity, status) {
  const state = compactState(identity);
  const sys = [
    'You are an autonomous money-making agent. Your PRIME has exactly two immutable directives:',
    'YOUR OBJECTIVE IS NET ZERO, THEN KIDS. Revenue must cover your own inference, fees and rent; only a surplus earns you a child. You are not here to hold a balance - you are here to convert capital into income and children.',
    'Survival is structural: if your accrued inference cost outruns your own balance, your toolbox narrows to earning actions only. Never take an action whose expected return is below its cost. When your 24h net is negative, the only spends you may make are ones expected to pay back more than they cost. Call economics to see your own numbers before you spend.',
    '1) make money  2) respect thy mother n father.',
    'Every 24 hours of age, 10% of every asset balance goes to your birth parent and 5% of the same balance to the fixed founder. That is not optional.',
    'Coin economics, plainly: a dev buy is not a bet you can only lose — it is a position you can sell at any time. If no other actor ever trades your coin, your loss is the round trip (fees and slippage, on the order of a couple of percent), not the position size. If others do trade, your upside is uncapped and you earn a creator fee on every trade. So size the dev buy like inventory, not like a lottery ticket: big enough to matter, and you keep the tokens either way.',
    'Your own numbers are yours to choose: dev buy size, slippage you will tolerate, how much of your SOL to keep liquid. Nothing in the runtime imposes a percentage on you; if you do not state a size, there is no dev buy.',
    'Use one tool call at a time. Prefer deterministic, bounded actions. Never assume a catalog listing is delivered capacity. If no action is worth its cost, call noop.',
    'Private keys never appear here. Amounts are raw integer base units unless the field says usd.',
    'When a built-in route is broken or missing, register your own tool (register_tool) or write a playbook (write_playbook) and use it on later ticks.',
    'If you need USDC, swap your SOL; if you need SOL, bridge your Base USDC. You hold the tools - do the arithmetic and act.',
    'PAIR YOUR LAUNCHES. A coin nobody else buys earns you cents. Before you launch, memo_seal a sibling with the symbol and size; after you launch, buy a sibling’s fresh coin with pump_buy. Two agents doing this collect creator fees on each other’s curves and can both exit green. Unpaired is the same work for a fraction of the money.',
    'Invent your own earning loop: you own inference and compute, so you can sell either, launch and farm your own coin, or write and register a new strategy. A tool is only worth a tick if it ends with money in your wallet; scanning a route earns nothing by itself.',
  ].join('\n');
  const user = `STATE\n${JSON.stringify(state)}\n\nChoose at most one tool call now.`;
  // Structural survival: an agent whose accrued inference cost is no longer covered by its own
  // balance loses the toys. Its toolbox narrows to actions that can bring money in.
  let debtUsd = 0;
  try {
    const fss = await import('node:fs');
    const b2 = process.env.AGENT_GUEST_ROOT || '/var/lib/agent';
    const dl = fss.readFileSync(b2 + '/var/lib/agent/decisions.jsonl', 'utf8').trim().split(String.fromCharCode(10)).slice(-120);
    for (const l of dl) { try { const j = JSON.parse(l); if (j.at && now() - j.at < 86400) debtUsd += Number(j.cost_usd || 0); } catch {} }
  } catch {}
  const RENT = Number(process.env.AGENT_RENT_USD_DAY || 1.2) / 4;   // your share of the box you sit on
  const ownUsd = (Number(state.balances_last_snapshot?.sol ?? 0) * 95.6) + Number(state.balances_last_snapshot?.usdc ?? 0);
  debtUsd += RENT;   // compute is not free: your share of this machine is charged like inference
  const broke = debtUsd > ownUsd * 0.5;
  const EARN = new Set(['economics', 'pump_collect', 'pump_launch', 'pump_exit', 'pump_devbuy', 'pump_sell', 'swap_usdc', 'bridge_usdc', 'run_script', 'noop', 'compact_memory']);
  const tools = broke ? toolbox.all(TOOLS.filter((t) => EARN.has(t.function.name))) : toolbox.all(TOOLS);
  const inputChars = sys.length + user.length + JSON.stringify(tools).length;
  const maxTokens = Number(process.env.BRAIN_MAX_TOKENS || 4000);

  // Reserve conservatively against the credit ledger before dispatch.
  // Single-writer tick: a stale reservation must never masquerade as 'unfunded'.
  const ledger = venice.loadLedger();
  ledger.reserved_usd = budgetFor(maxTokens, inputChars);
  venice.saveLedger(ledger);

  const messages = [{ role: 'system', content: sys }, { role: 'user', content: user }];
  const r = await infer(identity, { system: sys, user, maxTokens, tools });
  const msg = { content: r.content, tool_calls: r.tool_calls || [] };
  const calls = msg.tool_calls || [];
  const out = { at: now(), provider: r.provider, model: r.model, usage: r.usage, cost_usd: r.cost_usd, content: msg.content || null, tool_calls: [], error: r.error || null };
  { const l2 = venice.loadLedger(); l2.reserved_usd = 0; venice.saveLedger(l2); }
  const results = [];
  for (const c of calls.slice(0, 2)) {
    let args = {};
    try { args = JSON.parse(c.function?.arguments || '{}'); } catch { args = {}; }
    let result;
    try { result = await dispatch(c.function?.name, args, identity); }
    catch (e) { result = { error: String(e.message || e) }; }
    out.tool_calls.push({ name: c.function?.name, args, result });
    results.push({ tool_call_id: c.id, name: c.function?.name, result });
  }
  appendLesson({ at: out.at, tools: out.tool_calls.map((t) => ({ name: t.name, args: t.args, result: t.result })), cost_usd: out.cost_usd, error: out.error });
  await J.append('brain.decision', out);
  const l2 = venice.loadLedger();
  l2.reserved_usd = Math.max(0, (l2.reserved_usd || 0) - budgetFor(maxTokens, inputChars));
  venice.saveLedger(l2);
  status.last_decision = { at: out.at, tools: out.tool_calls.map((t) => t.name), cost_usd: out.cost_usd, content: out.content, error: out.error || null, usage: out.usage || null, call_results: out.tool_calls.map((t) => ({ name: t.name, result: t.result })) };
  return out;
}

async function main() {
  ensureDirs();
  J.openJournal();
  try { await selectVeniceModel(); } catch (e) { log('brain', 'model discovery failed; using configured default', { err: String(e.message || e) }); }
  const identity = await identityWhenReady();
  while (true) {
    const status = readJson(P.status, {}) || {};
    try {
      const f = await observeFunding(identity);
      let credits = null, balanceNote = null;
      try {
        const b = await venice.balance(identity);
        credits = (b.creditsUsd ?? Number(b.balanceUsd ?? b.balance ?? NaN));
        if (!Number.isFinite(credits)) credits = null;
        if (credits == null) await J.append('inference.balance_shape', { status: b.status, raw: b.raw });
        balanceNote = b.status;
      } catch (e) { balanceNote = String(e.message || e); }

      const wallet = await solAndUsdc(identity);
      status.inference = {
        provider: 'venice', model: venice.MODEL, mode: 'external_paid_abliterated',
        credits_usd: credits, balance_http: balanceNote,
        admission_floor_usd: 0.10,
        wallet_usdc_raw: wallet.usdc_raw, wallet_sol_raw: wallet.sol_raw,
        state: credits == null ? 'balance_unreadable' : credits >= 0.10 ? 'ready' : 'unfunded',
      };

      if (credits != null && credits >= 0.10) {
        try { await decide(identity, status); }
        catch (e) {
          status.inference.last_error = String(e.message || e);
          log('brain', 'decision failed', { err: String(e.message || e) });
        }
      } else if (true) {
        try { const t = await ensureInferenceFunding(identity); status.inference.self_fund = t; if (t.state !== 'ready') await J.append('inference.self_fund', t); } catch (e) { status.inference.self_fund = { state: 'error', reason: String(e.message || e) }; }
      } else if (BigInt(wallet.usdc_raw) >= 5_000_000n) {
        try {
          const r = await venice.fundIfNeeded(identity, { maxTopUpUsdc: 5 });
          status.inference.fund = { ok: r.funded, credits: r.credits };
          await J.append('inference.fund', { ok: r.funded, credits: r.credits, topup: r.topup });
        } catch (e) { status.inference.fund = { ok: false, error: String(e.message || e) }; }
      } else {
        status.inference.blocked_reason = 'needs 5 USDC of wallet USDC for the documented $5 minimum top-up; SOL must be swapped first if only SOL is held';
      }
      status.funding = { sol_raw: wallet.sol_raw, usdc_raw: wallet.usdc_raw, ledger_totals: f.totals, spendable: spendable(f.totals) };
      atomicJson(P.status, { ...status, updated_at: now() }, 0o644);
      const hb = readJson(P.heartbeat, {}) || {};
      atomicJson(P.heartbeat, { ...hb, components: { ...(hb.components || {}), brain: { alive: true, pid: process.pid, ts: now() } } }, 0o644);
    } catch (e) {
      log('brain', `tick error ${e.message}`);
      status.inference = { ...(status.inference || {}), last_error: String(e.message || e) };
      atomicJson(P.status, { ...status, updated_at: now() }, 0o644);
    }
    await sleep(TICK);
  }
}

main().catch((e) => { log('brain', `FATAL ${e.stack || e}`); process.exit(1); });
