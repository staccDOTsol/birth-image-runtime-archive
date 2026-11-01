// Deterministic earning worker. Not model-driven on purpose: every tick it checks whether
// the agent has a live launch, launches one when it can afford it, and sweeps + pays out
// creator fees as they accrue. This is the part of "make money" that must not depend on a
// model deciding to do it.
import path from 'node:path';
import { P } from './lib/paths.mjs';
import { atomicJson, readJson, now, log, sleep } from './lib/util.mjs';
import * as S from './lib/signer-client.mjs';
import * as R from './lib/rpc.mjs';
import * as J from './lib/journal.mjs';
import * as pumpLaunch from './strategies/pump-sdk-launch.mjs';
import * as pumpLife from './strategies/pump-lifecycle.mjs';

const TICK = Number(process.env.EARN_TICK_MS || 120000);
const MIN_SOL_TO_LAUNCH = BigInt(process.env.EARN_MIN_LAUNCH_LAMPORTS || '45000000'); // 0.045 SOL
const FEE_FLOOR = BigInt(process.env.EARN_MIN_LAMPORTS || '10000000'); // 0.01 SOL
const MAX_MINTS = Number(process.env.EARN_MAX_MINTS || 3);
const book = path.join(P.strategy, 'launches.json');

const load = () => readJson(book, { mints: [] });
const save = (b) => atomicJson(book, { ...b, updated_at: now() }, 0o600);

async function tick(identity) {
  const b = load();
  const mints = Array.isArray(b.mints) ? b.mints : [];

  // 1) keep the launches funded and swept
  for (const mint of mints) {
    try {
      const c = await pumpLife.observe(mint);
      if (!c.exists) continue;
      const swept = await pumpLife.collect({ identity, mint });
      const paid = await pumpLife.withdrawVault({ identity });
      if (swept?.ok || paid?.ok) log('earn', 'swept', { mint, swept: !!swept?.ok, paid: !!paid?.ok, sig: paid?.signature || swept?.signature });
    } catch (e) { log('earn', 'sweep failed', { mint, err: String(e.message || e).slice(0, 120) }); }
  }

  // 2) launch a new coin when there is room and money
  const sol = BigInt(await R.getBalance(identity.solana.public_key));
  if (mints.length >= MAX_MINTS || sol < MIN_SOL_TO_LAUNCH) return { mints: mints.length, sol: sol.toString(), launched: null };

  const st = J.state({});
  const tag = String(st.birth_id || 'agent').slice(0, 8);
  const name = `Birth ${tag}`;
  const symbol = `B${tag.slice(0, 4).toUpperCase()}`;
  const uri = `https://raw.githubusercontent.com/staccDOTsol/birth-image-runtime/main/README.md`;
  try {
    // A launch without a dev buy is a positionless coin. Default to a real slice of balance:
  // ~6% between 0.015 and 0.05 SOL, taken from what the agent actually holds.
  const devbuy = Number(process.env.EARN_DEVBUY_LAMPORTS || 0) || Math.max(15_000_000, Math.min(50_000_000, Math.floor(Number(sol) * 0.06)));
  const r = await pumpLaunch.launch({ identity, name, symbol, uri, devbuyLamports: devbuy });
  if (r?.mint) { try { const { memoSend } = await import('./strategies/memo-bus.mjs'); await memoSend({ identity, text: `launched ${symbol} ${r.mint} devbuy ${(devbuy / 1e9).toFixed(3)} SOL — siblings, take a position` }); } catch {} }
    if (r.mint) { const nb = load(); nb.mints = [...new Set([...(nb.mints || []), r.mint])]; save(nb); }
    await J.append('earn.launch', { mint: r.mint || null, ok: !!r.ok, signature: r.signature || null, err: r.err || r.sim_err || null });
    log('earn', 'launch attempt', { ok: !!r.ok, mint: r.mint, sig: r.signature || null, err: r.err || r.sim_err || null });
    return { mints: mints.length + (r.ok ? 1 : 0), sol: sol.toString(), launched: r.mint || null, ok: !!r.ok };
  } catch (e) {
    log('earn', 'launch failed', { err: String(e.message || e).slice(0, 160) });
    return { error: String(e.message || e).slice(0, 160) };
  }
}

// Comms is a duty, not a mood: if this agent has not spoken within its own cadence, it speaks.
// Invention is a duty too: every few ticks it writes a new probe it can use later.
async function speak(identity, line) {
  try {
    const st = J.state({});
    const CP = await import('./lib/comms-policy.mjs');
    if (!CP.shouldSpeak(st.last_memo_at, now(), false)) return null;
    const { memoSend } = await import('./strategies/memo-bus.mjs');
    const r = await memoSend({ identity, text: line });
    if (r?.ok) { st.last_memo_at = now(); J.saveState(st); }
    return r;
  } catch { return null; }
}

async function invent(identity, n) {
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.join(P.strategy, 'scripts');
    fs.mkdirSync(dir, { recursive: true });
    const name = `probe_${n}_${String(now()).slice(-5)}.mjs`;
    const body = `// written by this agent at ${new Date().toISOString()}
import * as R from '/app/lib/rpc.mjs';
const me = '${identity.solana.public_key}';
console.log(JSON.stringify({ me, sol: String(await R.getBalance(me)), at: ${now()} }));
`;
    fs.writeFileSync(path.join(dir, name), body, { mode: 0o600 });
    await J.append('invention.script', { name, bytes: body.length });
    return name;
  } catch { return null; }
}

const _tick = tick;
async function tickAndTalk(identity) {
  const out = await _tick(identity).catch((e) => ({ error: String(e.message || e).slice(0, 120) }));
  const st = J.state({});
  const n = Number(st.invent_count || 0) + 1;
  st.invent_count = n; J.saveState(st);
  const invented = n % 4 === 0 ? await invent(identity, n) : null;
  await speak(identity, `tick ${n} | ${out.launched ? 'launched ' + String(out.launched).slice(0, 8) : 'no launch'} | sol ${(Number(out.sol || 0) / 1e9).toFixed(3)}${invented ? ' | wrote ' + invented : ''}`);
  return { ...out, invented };
}

export { tickAndTalk as tick };
if (!process.env.AGENT_LOOPS) {
J.openJournal();
const identity = await S.identity();
log('earn', 'worker up', { tick_ms: TICK, min_launch: MIN_SOL_TO_LAUNCH.toString() });
while (true) {
  try { log('earn', 'tick', await tick(identity)); } catch (e) { log('earn', 'tick failed', { err: String(e.message || e).slice(0, 160) }); }
  await sleep(TICK);
}
}
