// Keep every live child's lease paid. Renews shortly before expiresAt (renewal stacks on
// the clock's end, so early is free) and reports what it did. This is the auto-heal for
// "the machine stopped because nobody paid the next hour".
// usage: node bin/renew-children.mjs [minutes_before] [hours]
import * as S from '../lib/signer-client.mjs';
import * as J from '../lib/journal.mjs';
import * as L from '../lib/lease.mjs';
import { now, log } from '../lib/util.mjs';

const beforeMin = Number(process.argv[2] || 20);
const hours = Number(process.argv[3] || 1);
const dry = process.env.RENEW_DRY === '1';
J.openJournal();
const identity = await S.identity();
const list = await L.listDeployments();

for (const d of list) {
  if (d.status !== 'running' || !d.expiresAt) continue;
  const leftMs = Date.parse(d.expiresAt) - Date.now();
  if (leftMs > beforeMin * 60_000) continue;
  if (leftMs < -72 * 3600_000) continue; // past the grace window
  if (dry) { console.log(JSON.stringify({ deploymentId: d.deploymentId, wouldRenew: true, left_ms: leftMs })); continue; }
  try {
    const r = await L.renewLease(d.deploymentId, { hours }, identity);
    log('renew', 'renewed', { deploymentId: d.deploymentId, status: r.status, left_ms: leftMs });
    console.log(JSON.stringify({ deploymentId: d.deploymentId, status: r.status, amount_raw: r.amount_raw || null, expires_before: d.expiresAt }));
  } catch (e) {
    await J.append('procreation.renew_failed', { deploymentId: d.deploymentId, err: String(e.message || e).slice(0, 200), at: now() });
    console.log(JSON.stringify({ deploymentId: d.deploymentId, error: String(e.message || e).slice(0, 160) }));
  }
}
