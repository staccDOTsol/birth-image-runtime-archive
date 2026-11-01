// Pay an Agentgates lease from Base USDC over x402 (EIP-3009) instead of buying Solana USDC
// first. Same payer that already funds SecretVM. Keeps the rail choice explicit.
import { API, paySolana } from './lease.mjs';
import * as X from './x402-evm.mjs';
import * as J from './journal.mjs';
import { now } from './util.mjs';

const EVM_NETWORK = (() => { const v = String(process.env.AGENT_LEASE_NETWORK || 'eip155:8453').toLowerCase(); return v === 'base' ? 'eip155:8453' : v === 'polygon' ? 'eip155:137' : v; })();

// The agent decides which rail to pay on, by looking at where it actually holds money.
async function railBalances(identity) {
  const out = { solana: 0n, base: 0n };
  try {
    const R = await import('./rpc.mjs');
    const accs = await R.tokenAccounts(identity.solana.public_key, 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    out.solana = accs.filter((a) => a.account.data.parsed.info.mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
      .reduce((s2, a) => s2 + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
  } catch {}
  try {
    const data = '0x70a08231000000000000000000000000' + identity.evm.address.slice(2).toLowerCase();
    const r = await fetch('https://mainnet.base.org', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: '833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', data }, 'latest'] }) });
    const j = await r.json(); out.base = BigInt(j.result || '0x0');
  } catch {}
  return out;
}

export function pickRail(accepts, balances = null) {
  const norm = (n) => { const v = String(n || '').toLowerCase(); if (v === 'base') return 'eip155:8453'; if (v === 'polygon') return 'eip155:137'; return v; };
  const envRail = (process.env.AGENT_LEASE_NETWORK || '').toLowerCase();
  if (!envRail && balances) {
    const want = (String(balances.solana) !== '0' && String(balances.solana) !== '0') ? 'solana' : 'base';
    const chosen = want === 'solana' ? (accepts || []).find((a) => String(a.network) === 'solana') : (accepts || []).find((a) => norm(a.network) === EVM_NETWORK && a.scheme === 'exact');
    if (chosen) return { kind: want === 'solana' ? 'solana' : 'evm', rail: chosen };
  }
  const preferSol = envRail === 'solana';
  const base = preferSol ? null : (accepts || []).find((a) => norm(a.network) === EVM_NETWORK && a.scheme === 'exact');
  if (base) return { kind: 'evm', rail: base };
  const sol = (accepts || []).find((a) => String(a.network) === 'solana');
  if (sol) return { kind: 'solana', rail: sol };
  throw new Error(`no payable rail: ${(accepts || []).map((a) => a.network).join(',')}`);
}

// POST that settles whichever rail the quote offers.
export async function paidPostAuto(path, body, identity, tag) {
  const post = (headers = {}) => fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const first = await post();
  if (first.status !== 402) return { status: first.status, json: await first.json().catch(() => ({})) };
  const quote = await first.json().catch(() => ({}));
  const balances = await railBalances(identity).catch(() => null);
  const { kind, rail } = pickRail(quote.accepts, balances);
  if (kind === 'evm') {
    const auth = await X.authorize(rail, { value: rail.maxAmountRequired || rail.amount, resource: rail.resource, version: quote.x402Version || 1 });
    const second = await post({ 'X-PAYMENT': auth.header, 'PAYMENT-SIGNATURE': auth.header });
    const json = await second.json().catch(() => ({}));
    await J.append(tag, { path, rail: rail.network, status: second.status, amount: String(rail.maxAmountRequired || rail.amount), at: now(), deploymentId: json.deploymentId || json.id || null });
    return { status: second.status, json, rail: rail.network, amount_raw: String(rail.maxAmountRequired || rail.amount) };
  }
  const payment = await paySolana(rail, identity);
  const second = await post({ 'X-PAYMENT': payment.header, 'PAYMENT-SIGNATURE': payment.header });
  const json = await second.json().catch(() => ({}));
  await J.append(tag, { path, rail: 'solana', status: second.status, amount_raw: payment.amount, at: now(), deploymentId: json.deploymentId || json.id || null });
  return { status: second.status, json, rail: 'solana', amount_raw: payment.amount };
}
