// Agentgates lease payment over x402 on Solana. One place that knows how a lease is
// quoted, paid and renewed, so create and renew cannot drift apart.
import { PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import {
  createTransferCheckedInstruction, createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import * as S from './signer-client.mjs';
import * as R from './rpc.mjs';
import * as J from './journal.mjs';
import { now } from './util.mjs';

export const API = process.env.AGENTGATES_API || 'https://agentgates-backend.vercel.app';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export async function paySolana(rail, identity) {
  const amount = BigInt(rail.maxAmountRequired || rail.amount);
  if (rail.asset !== USDC) throw new Error(`unexpected asset ${rail.asset}`);
  if (!rail.extra?.feePayer) throw new Error('rail has no sponsor feePayer');
  const mint = new PublicKey(rail.asset);
  const from = getAssociatedTokenAddressSync(mint, new PublicKey(identity.solana.public_key));
  const to = getAssociatedTokenAddressSync(mint, new PublicKey(rail.payTo), true);
  const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 })];
  if (!(await R.getAccountInfo(to.toBase58()))) {
    ixs.push(createAssociatedTokenAccountIdempotentInstruction(new PublicKey(rail.extra.feePayer), to, new PublicKey(rail.payTo), mint, TOKEN_PROGRAM_ID));
  }
  ixs.push(createTransferCheckedInstruction(from, mint, to, new PublicKey(identity.solana.public_key), amount, 6, [], TOKEN_PROGRAM_ID));
  const { blockhash } = await R.getLatestBlockhash();
  const signed = await S.request('sign_payment_legacy', {
    feePayer: rail.extra.feePayer, blockhash, lastValidBlockHeight: 0,
    instructions: ixs.map((ix) => ({
      programId: ix.programId.toBase58(),
      keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: !!k.isSigner, isWritable: !!k.isWritable })),
      dataHex: Buffer.from(ix.data).toString('hex'),
    })),
  });
  return { header: Buffer.from(JSON.stringify({ x402Version: 1, scheme: 'exact', network: 'solana', payload: { transaction: signed.wireBase64 } })).toString('base64'), amount: amount.toString() };
}

function pickSolana(accepts) {
  const rail = (accepts || []).find((a) => String(a.network) === 'solana');
  if (!rail) throw new Error(`no solana rail: ${(accepts || []).map((a) => a.network).join(',')}`);
  return rail;
}

// POST with the payment leg: first call gets 402, second carries the signed transfer.
async function paidPost(path, body, identity, tag) {
  const post = (headers = {}) => fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const first = await post();
  if (first.status !== 402) return { status: first.status, json: await first.json().catch(() => ({})) };
  const rail = pickSolana((await first.json().catch(() => ({}))).accepts);
  const payment = await paySolana(rail, identity);
  const second = await post({ 'X-PAYMENT': payment.header, 'PAYMENT-SIGNATURE': payment.header });
  const json = await second.json().catch(() => ({}));
  await J.append(tag, { path, status: second.status, amount_raw: payment.amount, at: now(), deploymentId: json.deploymentId || json.id || null });
  return { status: second.status, json, amount_raw: payment.amount };
}

export async function createLease({ plan, hours = 1, compose, name }, identity) {
  return paidPost('/api/compute/deployments', { plan, hours, compose, name }, identity, 'procreation.lease');
}

export async function renewLease(deploymentId, { hours = 1 } = {}, identity) {
  return paidPost(`/api/compute/deployments/${deploymentId}/renew`, { hours }, identity, 'procreation.renew');
}

export async function listDeployments({ timeoutMs = 20000 } = {}) {
  const { ownerGet } = await import('../bin/agentgates-auth.mjs');
  // A hung listing must not wedge the whole procreate tick: race it against a deadline.
  const b = await Promise.race([
    ownerGet(API, '/api/compute/deployments').then((r) => r.body),
    new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  if (!b) return [];
  return Array.isArray(b) ? b : (b.deployments || b.data || []);
}
