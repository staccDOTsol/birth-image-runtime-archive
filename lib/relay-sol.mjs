// Solana USDC -> Base USDC through Relay. The provider provisions a deployment on Base but
// silently drops Solana-rail leases (202 then 404), so a child that wants a grandchild must be
// able to move its own USDC to Base without a human and without ETH.
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import bs58pkg from 'bs58';
import * as S from './signer-client.mjs';
import * as R from './rpc.mjs';

const bs58 = bs58pkg.default || bs58pkg;
const SOL_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

export async function quoteSolToBase(identity, amountRaw) {
  const body = {
    user: identity.solana.public_key,
    recipient: identity.evm.address,
    originChainId: 792703809,
    destinationChainId: 8453,
    originCurrency: SOL_USDC,
    destinationCurrency: BASE_USDC,
    amount: String(amountRaw),
    tradeType: 'EXACT_INPUT',
  };
  const r = await fetch('https://api.relay.link/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!j.steps) throw new Error(`relay quote: ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  return j;
}

export async function bridgeSolToBase(identity, amountRaw) {
  const q = await quoteSolToBase(identity, amountRaw);
  const ins = q.steps[0]?.items?.[0]?.data?.instructions || [];
  const alts = q.steps[0]?.items?.[0]?.data?.addressLookupTableAddresses || [];
  if (!ins.length) throw new Error('relay: no deposit instructions');
  const web3 = await import('@solana/web3.js');
  const { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, AddressLookupTableAccount, ComputeBudgetProgram } = web3;
  const ixs = ins.map((i) => new TransactionInstruction({
    programId: new PublicKey(i.programId),
    keys: i.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: !!k.isSigner, isWritable: !!k.isWritable })),
    data: (() => {
      const d = String(i.data || '');
      if (/^[0-9a-fA-F]+$/.test(d) && d.length % 2 === 0) return Buffer.from(d, 'hex');
      try { const b = Buffer.from(d, 'base64'); if (b.length) return b; } catch {}
      return Buffer.from(bs58.decode(d));
    })(),
  }));
  // relay hands us lookup tables; a legacy tx silently drops them and the program rejects the
  // instruction, so compile a v0 message that actually carries the tables.
  const tables = [];
  for (const a of alts.slice(0, 4)) {
    try {
      const acc = await R.rpc('getAccountInfo', [a, { encoding: 'base64' }]);
      if (acc?.value?.data) tables.push(new AddressLookupTableAccount({ key: new PublicKey(a), state: AddressLookupTableAccount.deserialize(Buffer.from(acc.value.data[0], 'base64')) }));
    } catch {}
  }
  const { blockhash } = await R.getLatestBlockhash();
  const msg = new TransactionMessage({
    payerKey: new PublicKey(identity.solana.public_key),
    recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }), ...ixs],
  }).compileToV0Message(tables);
  const vtx = new VersionedTransaction(msg);
  const signed = await S.request('sign_tx', { wireBase64: Buffer.from(vtx.serialize()).toString('base64') });
  if (!signed?.wireBase64) throw new Error('relay: sign failed ' + JSON.stringify(signed).slice(0, 120));
  const sim = await R.simulate(signed.wireBase64, [identity.solana.public_key]);
  if (sim.value?.err) return { ok: false, stage: 'simulate', err: sim.value.err, logs: (sim.value.logs || []).slice(-3) };
  const sig = await R.sendRaw(signed.wireBase64);
  return { ok: true, signature: sig, outAmount: q.details?.currencyOut?.amount || null, via: 'v0+alt' };
}
