// Universal x402 request. One place that quotes, picks a rail the agent can actually pay on,
// signs, replays, and falls back to the next requirement if verification fails. Every paid
// call (images, leases, provisioning, inference) should go through here.
import * as X from './x402-evm.mjs';
import { paySolana } from './lease.mjs';

const USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

export async function balances(identity) {
  const out = { base: 0n, solana: 0n };
  try {
    const data = '0x70a08231000000000000000000000000' + identity.evm.address.slice(2).toLowerCase();
    const r = await (await fetch('https://mainnet.base.org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: USDC_BASE, data }, 'latest'] }), signal: AbortSignal.timeout(8000) })).json();
    out.base = BigInt(r.result || '0x0');
  } catch {}
  try {
    const R = await import('./rpc.mjs');
    const accs = await R.tokenAccounts(identity.solana.public_key, 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    out.solana = accs.filter((a) => a.account.data.parsed.info.mint === USDC_SOL)
      .reduce((s, a) => s + BigInt(a.account.data.parsed.info.amount || a.account.data.parsed.info.tokenAmount.amount), 0n);
  } catch {}
  return out;
}

const amountOf = (a) => BigInt(a.maxAmountRequired ?? a.amount ?? 0);

// Build and sign the USDC transfer ourselves, with the agent paying the network fee.
export async function solanaSelfPay(rail, identity, version = 2) {
  const [{ PublicKey, ComputeBudgetProgram }, spl, S, R] = await Promise.all([
    import('@solana/web3.js'), import('@solana/spl-token'), import('./signer-client.mjs'), import('./rpc.mjs'),
  ]);
  const amount = amountOf(rail);
  const mint = new PublicKey(rail.asset || USDC_SOL);
  const owner = new PublicKey(identity.solana.public_key);
  const from = spl.getAssociatedTokenAddressSync(mint, owner);
  const to = spl.getAssociatedTokenAddressSync(mint, new PublicKey(rail.payTo), true);
  const feePayer = rail.extra?.feePayer ? new PublicKey(rail.extra.feePayer) : owner;
  const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 })];
  if (!(await R.getAccountInfo(to.toBase58()))) {
    ixs.push(spl.createAssociatedTokenAccountIdempotentInstruction(feePayer, to, new PublicKey(rail.payTo), mint, spl.TOKEN_PROGRAM_ID));
  }
  ixs.push(spl.createTransferCheckedInstruction(from, mint, to, owner, amount, 6, [], spl.TOKEN_PROGRAM_ID));
  const { blockhash } = await R.getLatestBlockhash();
  const signed = await S.request('sign_payment_legacy', {
    feePayer: feePayer.toBase58(), blockhash, lastValidBlockHeight: 0,
    instructions: ixs.map((ix) => ({
      programId: ix.programId.toBase58(),
      keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: !!k.isSigner, isWritable: !!k.isWritable })),
      dataHex: Buffer.from(ix.data).toString('hex'),
    })),
  });
  const header = Buffer.from(JSON.stringify({ x402Version: version || 2, scheme: 'exact', network: rail.network, payload: { transaction: signed.wireBase64 } })).toString('base64');
  return { header, amount: amount.toString() };
}
const isEvm = (a) => String(a.network || '').startsWith('eip155:');
const isSol = (a) => String(a.network || '').startsWith('solana');

// Order the rails by what the agent can afford, cheapest-first within a rail.
export function orderRails(accepts, bal) {
  const list = (accepts || []).filter((a) => a && (isEvm(a) || isSol(a)));
  const affordable = list.filter((a) => (isEvm(a) ? bal.base : bal.solana) >= amountOf(a));
  const rest = list.filter((a) => !affordable.includes(a));
  const score = (a) => (isSol(a) ? 0 : 1) * 1e12 + Number(amountOf(a));
  return [...affordable.sort((x, y) => Number(amountOf(x) - amountOf(y))), ...rest.sort((x, y) => score(x) - score(y))];
}

export async function quote(url, body, headers = {}) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  if (r.status !== 402) return { settled: r.status < 300, response: r };
  let q = {};
  try { q = JSON.parse(Buffer.from(r.headers.get('payment-required') || '', 'base64').toString('utf8')); }
  catch { q = await r.clone().json().catch(() => ({})); }
  return { settled: false, response: r, quote: q, accepts: q.accepts || q.accepted || q.paymentRequirements || [] };
}

// sign one requirement, on whichever rail
export async function signRequirement(rail, { identity, resource, version }) {
  if (isSol(rail)) {
    // Some sellers sponsor the fee payer, most do not. Pay our own fee when they don't.
    try {
      if (rail.extra?.feePayer) {
        const p = await paySolana(rail, identity);
        return { header: p.header, rail: 'solana', amount: amountOf(rail) };
      }
      const p = await solanaSelfPay(rail, identity, version);
      return { header: p.header, rail: 'solana', amount: amountOf(rail) };
    } catch (e) {
      return { header: null, rail: 'solana', amount: amountOf(rail), err: String(e.message || e).slice(0, 80) };
    }
  }
  const res = typeof resource === 'string' ? { url: resource, description: 'paid request', mimeType: 'application/json' } : resource;
  const a = await X.authorize(rail, { value: amountOf(rail), resource: res, version, identity });
  return { header: a.header, rail: 'base', amount: amountOf(rail) };
}

// Full flow with fallbacks across rails and across retries.
export async function paidRequest(url, body, { identity, headers = {}, maxTries = 3 } = {}) {
  const first = await quote(url, body, headers);
  if (first.settled) return { status: first.response.status, json: await first.response.json().catch(() => ({})), paid: 0 };
  const bal = await balances(identity);
  const rails = orderRails(first.accepts, bal).slice(0, maxTries);
  const tried = [];
  for (const rail of rails) {
    try {
      const res = first.quote.resource && typeof first.quote.resource === 'object' ? first.quote.resource : { url, description: 'paid request', mimeType: 'application/json' };
      const signed = await signRequirement(rail, { identity, resource: res, version: first.quote.x402Version || 2 });
      // v2 names the header PAYMENT-SIGNATURE; sending X-PAYMENT as well makes some sellers
      // treat the retry as a second payment in flight, so send the v2 name only.
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers, 'PAYMENT-SIGNATURE': signed.header }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(180000) });
      const json = await r.json().catch(() => ({}));
      if (r.status < 300) return { status: r.status, json, paid: Number(signed.amount) / 1e6, rail: signed.rail };
      tried.push({ rail: signed.rail, status: r.status, err: JSON.stringify(json).slice(0, 90) });
    } catch (e) { tried.push({ rail: String(rail.network), err: String(e.message || e).slice(0, 80) }); }
  }
  return { status: 402, json: {}, tried, accepts: first.accepts.map((a) => a.network) };
}
