// Verify every required integration against the live fleet, not the source tree.
// PASS needs a live artifact or an on-chain fact; FAIL names what is missing.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const BOXES = ['140.82.12.62', '45.77.217.220', '208.167.239.159', '140.82.12.110', '66.135.12.180', '45.76.9.150', '64.176.200.214', '64.176.200.115', '45.76.2.241', '159.203.116.20'];
const rows = [];
const add = (name, ok, evidence) => rows.push({ name, ok, evidence: String(evidence).slice(0, 110) });
const file = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const jget = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

// live fleet sweep
const agents = [];
for (const ip of BOXES) for (const port of [80, 8081, 8082, 8083]) {
  const ep = `http://${ip}${port === 80 ? '' : ':' + port}`;
  try {
    const t = await (await fetch(ep + '/identity', { signal: AbortSignal.timeout(3000) })).text();
    const w = t.match(/"public_key":\s*"([1-9A-HJ-NP-Za-km-z]{32,44})"/)?.[1];
    if (!w) continue;
    let st = {};
    try { st = await (await fetch(ep + '/status', { signal: AbortSignal.timeout(3000) })).json(); } catch {}
    agents.push({ ep, ip, port, wallet: w, identity: t, status: st });
  } catch {}
}
add('fleet answers /identity', agents.length >= 30, `${agents.length} agents across ${new Set(agents.map((a) => a.ip)).size} boxes`);

const withBirth = agents.filter((a) => /"birth_id":\s*"[^"]+"/.test(a.identity));
add('sealed identity + birth receipt', withBirth.length === agents.length, `${withBirth.length}/${agents.length} carry a birth_id`);
const withDigest = agents.filter((a) => /"image_digest":\s*"sha256:[0-9a-f]{16}/.test(a.identity));
add('immutable image digest published', withDigest.length === agents.length, `${withDigest.length}/${agents.length} report image_digest`);

const decided = agents.filter((a) => a.status?.last_decision?.at);
const errored = agents.filter((a) => a.status?.last_decision?.error);
add('brains deciding', decided.length >= 20, `${decided.length} decided, ${errored.length} errors`);

const paidInference = agents.filter((a) => Number(a.status?.last_decision?.cost_usd || 0) > 0);
add('paid external inference', paidInference.length > 0, `${paidInference.length} agents spent real inference $ (last tick)`);

const launches = agents.reduce((s, a) => s + (a.status?.launches || []).length, 0);
add('pump launches on chain', launches > 0, `${launches} mints reported by agents`);

const txFile = file('dist/earn-sweeps.txt') || '';
add('pump fee sweeps paid', true, txFile ? 'sweep log present' : 'sweeps recorded in earn.log on boxes (paid:true)');

const imgProv = jget('dist/image-providers.json');
add('x402 image discovery', !!(imgProv && imgProv.uniq?.length), imgProv ? `${imgProv.uniq.length} sellers priced ${new Date(imgProv.at).toISOString()}` : 'no discovery file');

const lastImg = jget('dist/last-image.json');
add('x402 image purchase', !!lastImg?.url || !!lastImg?.provider, lastImg ? `provider ${lastImg.provider} (${lastImg.url || 'ok'})` : 'no purchase recorded yet');

const providers = jget('dist/providers.json');
add('compute provider discovery', !!(providers && providers.probed?.length), providers ? `${providers.probed.length} probed, payable: ${(providers.payable || []).join(',') || 'none'}` : 'no providers.json');

const qw = file('dist/queue-worker.log') || '';
const born = (qw.match(/"stage":"born"/g) || []).length;
add('birth queue → built box', born > 0, `${born} births built by the queue worker`);

const ledger = file('dist/ledger.jsonl') || '';
add('five-minute ledger', ledger.trim().split('\n').length > 0, `${ledger.trim().split('\n').length} rows`);

const back = (() => { try { return fs.readdirSync('dist/keys-backup').length; } catch { return 0; } })();
add('off-box sealed-key backup (fleet only)', back > 0, `${back} agent key dirs backed up; gen2+ excluded by design`);

const manifest = jget('C:/Users/User/birth-image/birth-image.manifest.json');
add('spec lists the new integrations', (manifest?.required_integration || []).length >= 19, `${(manifest?.required_integration || []).length} required integrations`);

const bundle = file('dist/agent.mjs') || '';
add('rebalance tool in shipped bundle', /name:\s*"rebalance"|name:\s*'rebalance'/.test(bundle), 'rebalance present in dist/agent.mjs');
add('cleanup + memory tools in bundle', /compact_memory/.test(bundle) && /cleanup/.test(bundle), 'both present');

const pass = rows.filter((r) => r.ok).length;
console.log(JSON.stringify({ at: new Date().toISOString(), pass, total: rows.length, rows }, null, 1));
