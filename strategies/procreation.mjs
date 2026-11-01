// Agentgates compute quote/provision state machine. A child needs its own lease, fresh
// keys, a bound receipt and its own inference funding. Quote validation is complete;
// provisioning requires a funded wallet and is recorded as an attempt.
import { now } from '../lib/util.mjs';

const API = 'https://agentgates-backend.vercel.app/api/compute';
export const PLAN = 'compute.starter';

export async function catalog() {
  const r = await fetch(`${API}/catalog`);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// Unpaid create -> x402 402 with the exact per-network price. No machine is created.
export async function quote({ hours = 1, image = 'node:22-alpine', plan = PLAN } = {}) {
  const r = await fetch(`${API}/deployments`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plan, hours, image, name: `child-${Math.floor(now() / 60)}` }),
  });
  const body = await r.json().catch(() => ({}));
  const header = r.headers.get('payment-required');
  let req = body;
  if (header) { try { req = JSON.parse(Buffer.from(header, 'base64').toString('utf8')); } catch { /* body */ } }
  const accepts = req.accepts || body.accepts || [];
  const solana = accepts.find((a) => String(a.network).includes('solana'));
  return {
    at: now(), status: r.status, plan, hours, accepts,
    solana: solana ? { network: solana.network, asset: solana.asset, payTo: solana.payTo, amount: solana.amount, feePayer: solana.extra?.feePayer || null } : null,
    body,
  };
}

export function validateQuote(q) {
  const errors = [];
  if (q.status !== 402) errors.push(`expected 402 challenge, got ${q.status}`);
  if (!q.solana) errors.push('no solana rail offered');
  if (q.solana && q.solana.asset !== 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') errors.push('asset is not native USDC');
  if (q.solana && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q.solana.payTo || '')) errors.push('bad payTo');
  return { ok: errors.length === 0, errors, usd: q.solana ? Number(q.solana.amount) / 1e6 : null };
}

// A child must be independently keyed: the parent sends only public addresses and funds.
// This records the intended attempt fields; the guest-side first boot fills the rest.
export function birthAttempt({ parentBirthId, endowmentSol, inferenceUsdc }) {
  return {
    attempt_id: `birth-${now()}-${Math.random().toString(16).slice(2, 8)}`,
    parent_birth_id: parentBirthId,
    state: 'planned',
    core: 'birth-image-runtime/1',
    endowment_sol: endowmentSol,
    inference_usdc: inferenceUsdc,
    requires: ['fresh child keys inside its own TEE', 'bound child receipt', 'own inference credit', 'no parent update credential'],
    created_at: now(),
  };
}
