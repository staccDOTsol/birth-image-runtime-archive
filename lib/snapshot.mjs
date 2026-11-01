// Coherent all-asset balance snapshot for one chain at one cutoff.
// Records the context slot of every read. A single equal slot across all reads is
// `coherent_at_slot`; otherwise the range is recorded and reported as coverage debt
// rather than relabelled as one atomic snapshot.
import { rpc } from './rpc.mjs';
import { canon, sha256hex, atomicJson, now } from './util.mjs';
import { P } from './paths.mjs';
import path from 'node:path';

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export async function snapshot(owner) {
  const reads = [];
  const bal = await rpc('getBalance', [owner, { commitment: 'confirmed' }]);
  reads.push(bal.context.slot);
  const assets = [{
    chain: 'solana', asset: 'native:SOL', mint: null, program: 'system', decimals: 9,
    raw: BigInt(bal.value).toString(), owner,
  }];

  for (const program of [TOKEN_PROGRAM, TOKEN_2022]) {
    const r = await rpc('getTokenAccountsByOwner', [owner, { programId: program }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    reads.push(r.context.slot);
    for (const a of r.value) {
      const info = a.account.data.parsed.info;
      const raw = BigInt(info.tokenAmount.amount);
      if (raw === 0n) continue;
      assets.push({
        chain: 'solana',
        asset: `${program === TOKEN_2022 ? 't22' : 'spl'}:${info.mint}`,
        mint: info.mint,
        program,
        decimals: info.tokenAmount.decimals,
        raw: raw.toString(),
        ui: info.tokenAmount.uiAmountString,
        tokenAccount: a.pubkey,
        state: info.state,
        owner: info.owner,
      });
    }
  }

  // Extension check for Token-2022 mints: a nonzero transfer fee makes an ordinary
  // gross transfer ambiguous, so the asset is flagged rather than silently netted.
  for (const a of assets) {
    if (a.program !== TOKEN_2022) continue;
    try {
      const mint = await rpc('getAccountInfo', [a.mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
      reads.push(mint.context.slot);
      const ext = mint.value?.data?.parsed?.info?.extensions || [];
      const tf = ext.find((e) => e.extension === 'transferFeeConfig');
      if (tf) {
        const newer = tf.state?.newerTransferFee?.transferFeeBasisPoints ?? 0;
        const older = tf.state?.olderTransferFee?.transferFeeBasisPoints ?? 0;
        if (newer || older) a.blocked = { reason: 'token2022_transfer_fee', basis_points: Math.max(newer, older) };
      }
      const frozen = mint.value?.data?.parsed?.info?.freezeAuthority;
      if (frozen && a.state === 'frozen') a.blocked = { reason: 'frozen_account' };
    } catch (e) { a.coverage = `mint_read_failed:${e.message}`; }
  }

  const slotMin = Math.min(...reads), slotMax = Math.max(...reads);
  const snap = {
    chain: 'solana',
    owner,
    captured_at: now(),
    slots: reads,
    slot_min: slotMin,
    slot_max: slotMax,
    coherence: slotMin === slotMax ? 'coherent_at_slot' : 'multi_call_range',
    assets,
    coverage: { token_programs: [TOKEN_PROGRAM, TOKEN_2022], native: true },
  };
  snap.evidence_sha256 = sha256hex(Buffer.from(canon(snap)));
  try {
    atomicJson(path.join(P.snapshots, `snap-${snap.captured_at}-${slotMin}-${process.pid}-${Math.random().toString(16).slice(2, 8)}.json`), snap, 0o644);
  } catch { /* concurrent writers must not fail a snapshot */ }
  return snap;
}

export function totalByAsset(snap) {
  const m = new Map();
  for (const a of snap.assets) m.set(a.asset, (BigInt(m.get(a.asset) || 0n) + BigInt(a.raw)).toString());
  return m;
}
