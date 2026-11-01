// Earning loop for launched coins: check the creator vault, sweep when it is worth the
// transaction, and journal the result. No model, no approval — deterministic.
// usage: node bin/earn.mjs [mint,...]
import { Connection, PublicKey } from '@solana/web3.js';
import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import * as S from '../lib/signer-client.mjs';
import * as R from '../lib/rpc.mjs';
import * as J from '../lib/journal.mjs';
import * as L from '../strategies/pump-lifecycle.mjs';
import { readJson, now } from '../lib/util.mjs';
import path from 'node:path';
import { P } from '../lib/paths.mjs';

const THRESHOLD = BigInt(process.env.EARN_MIN_LAMPORTS || '10000000'); // 0.01 SOL
const book = readJson(path.join(P.strategy, 'launches.json'), { mints: [] });
const mints = (process.argv[2] ? process.argv[2].split(',') : book.mints || []).filter(Boolean);
if (!mints.length) { console.log(JSON.stringify({ at: now(), stage: 'no_mints' })); process.exit(0); }

J.openJournal();
const identity = await S.identity();
const online = new OnlinePumpSdk(new Connection(R.RPC_URL, 'confirmed'));

for (const mint of mints) {
  try {
    const vault = BigInt(await online.getCreatorVaultBalance(new PublicKey(identity.solana.public_key)));
    if (vault < THRESHOLD) { console.log(JSON.stringify({ at: now(), mint, vault: vault.toString(), action: 'hold' })); continue; }
    const r = await L.collect({ identity, mint });
    const w = await L.withdrawVault({ identity });
    await J.append('earn.withdraw', { ok: w.ok, signature: w.signature || null, err: w.err || null });
    await J.append('earn.sweep', { mint, vault_before: vault.toString(), ok: r.ok, signature: r.signature || null, err: r.err || null });
    console.log(JSON.stringify({ at: now(), mint, vault: vault.toString(), swept: r.ok, signature: r.signature || null }));
  } catch (e) {
    console.log(JSON.stringify({ at: now(), mint, error: String(e.message || e).slice(0, 140) }));
  }
}
