// Accounting: observe real chain balances, journal deposits as capital (never revenue),
// and expose what is actually spendable after reserved distribution obligations.
import * as R from '../lib/rpc.mjs';
import * as J from '../lib/journal.mjs';
import { now } from '../lib/util.mjs';
import { snapshot, totalByAsset } from './snapshot.mjs';

export async function observeFunding(identity) {
  const st = J.state({});
  const snap = await snapshot(identity.solana.public_key);
  const totals = Object.fromEntries(totalByAsset(snap));
  const prior = st.last_balances || {};
  const deltas = {};
  for (const [asset, raw] of Object.entries(totals)) {
    const d = BigInt(raw) - BigInt(prior[asset] || 0);
    if (d !== 0n) deltas[asset] = d.toString();
  }
  for (const [asset, raw] of Object.entries(prior)) {
    if (!(asset in totals)) { const d = -BigInt(raw); if (d !== 0n) deltas[asset] = d.toString(); }
  }
  const inflow = Object.entries(deltas).filter(([, v]) => BigInt(v) > 0n);
  if (inflow.length) {
    await J.append('funding.observed', {
      at: now(), slot: snap.slot_min, snapshot_hash: snap.evidence_sha256,
      deposits: inflow.map(([asset, raw]) => ({ asset, raw, classification: 'capital_not_revenue' })),
      note: 'endowment and later deposits are capital until disposed by a strategy',
    });
  }
  await J.updateState((cur) => ({ ...cur, last_balances: totals, last_snapshot: { at: now(), slot: snap.slot_min, hash: snap.evidence_sha256 } }));
  return { totals, deltas, snap };
}

export function reservedByAsset() {
  const st = J.state({});
  return st.reserved || {};
}

export function spendable(totalsRaw, reserveFeeLamports = 5_000_000n) {
  const reserved = reservedByAsset();
  const out = {};
  for (const [asset, raw] of Object.entries(totalsRaw)) {
    let v = BigInt(raw) - BigInt(reserved[asset] || 0);
    if (asset === 'native:SOL') v -= reserveFeeLamports;
    out[asset] = v > 0n ? v.toString() : '0';
  }
  return out;
}

export async function solAndUsdc(identity) {
  const sol = BigInt(await R.getBalance(identity.solana.public_key));
  const usdc = (await R.tokenAccounts(identity.solana.public_key, 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'))
    .filter((a) => a.account.data.parsed.info.mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
    .reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
  return { sol_raw: sol.toString(), usdc_raw: usdc.toString() };
}
