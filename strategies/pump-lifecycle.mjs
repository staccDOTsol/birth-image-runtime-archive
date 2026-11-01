// Post-launch pump lifecycle: observe the curve, sell the position, sweep creator fees.
// All instructions come from the official SDK; the agent only signs and simulates.
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { bondingCurvePda } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import { PumpSdk, OnlinePumpSdk } from '@pump-fun/pump-sdk';
import * as S from '../lib/signer-client.mjs';
import * as R from '../lib/rpc.mjs';
import * as J from '../lib/journal.mjs';
import { now } from '../lib/util.mjs';

const WSOL = new PublicKey('So11111111111111111111111111111111111111112');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const sdk = new PumpSdk();
const conn = () => new Connection(R.RPC_URL, 'confirmed');

function wire(ix) {
  return {
    programId: typeof ix.programId === 'string' ? ix.programId : ix.programId.toBase58(),
    keys: ix.keys.map((k) => ({ pubkey: typeof k.pubkey === 'string' ? k.pubkey : k.pubkey.toBase58(), isSigner: !!k.isSigner, isWritable: !!k.isWritable })),
    dataHex: ix.dataHex || Buffer.from(ix.data).toString('hex'),
  };
}

export async function observe(mintAddress) {
  const online = new OnlinePumpSdk(conn());
  const mint = new PublicKey(mintAddress);
  const curve = await online.fetchBondingCurve(mint).catch(() => null);
  if (!curve) return { mint: mintAddress, exists: false };
  const g = (k) => (curve[k] ?? curve.account?.[k])?.toString?.() ?? String(curve[k] ?? curve.account?.[k] ?? '');
  return {
    mint: mintAddress,
    exists: true,
    virtualTokenReserves: g('virtualTokenReserves'),
    virtualSolReserves: g('virtualSolReserves'),
    realTokenReserves: g('realTokenReserves'),
    realSolReserves: g('realSolReserves'),
    tokenTotalSupply: g('tokenTotalSupply'),
    complete: Boolean(curve.complete ?? curve.account?.complete),
    creator: String(curve.creator ?? curve.account?.creator ?? ''),
  };
}

async function signSimSend(identity, ixs, tag, extra = {}) {
  const user = identity.solana.public_key;
  const { blockhash, lastValidBlockHeight } = await R.getLatestBlockhash();
  const env = await S.signV1({
    instructions: ixs.map(wire), blockhash, lastValidBlockHeight,
    cuLimit: 1_400_000, allowedDestinations: [user], strategy: true,
  });
  const sim = await R.simulate(env.wireBase64, [user]);
  const base = { at: now(), ...extra, sim_err: sim.value?.err || null, sim_logs: (sim.value?.logs || []).slice(-6) };
  if (sim.value?.err) { await J.append(`${tag}_sim_failed`, base); return { ok: false, ...base }; }
  const sig = await R.sendRaw(env.wireBase64);
  let status = null;
  for (let i = 0; i < 40; i++) { const st = (await R.signatureStatuses([sig]))[0]; if (st?.confirmationStatus) { status = st; break; } await new Promise((r) => setTimeout(r, 1200)); }
  const out = { ...base, signature: sig, status: status?.confirmationStatus || 'unknown', err: status?.err || null };
  await J.append(tag, out);
  return { ok: !status?.err && !!status, ...out };
}

// Sell `amountRaw` of the position back into the curve.
export async function exit({ identity, mint: mintAddress, amountRaw, slippage = 1500 }) {
  const online = new OnlinePumpSdk(conn());
  const mint = new PublicKey(mintAddress);
  const user = new PublicKey(identity.solana.public_key);
  const { tokenProgramOf } = await import('../lib/token-program.mjs');
  const T22P = await tokenProgramOf(conn(), mint);
  const curve = await online.fetchBondingCurve(mint);
  const global = await online.fetchGlobal();
  const curvePda = bondingCurvePda(mint);
  const ata = getAssociatedTokenAddressSync(mint, user, false, T22P);
  let amount = amountRaw;
  if (!amount) {
    const acc = await conn().getParsedAccountInfo(ata);
    amount = acc?.value?.data?.parsed?.info?.tokenAmount?.amount;
  }
  if (!amount || amount === '0') return { ok: false, err: 'no position in this wallet' };
  const ixs = [
    createAssociatedTokenAccountIdempotentInstruction(user, ata, user, mint, T22P),
    ...(await sdk.sellInstructions({
      global,
      bondingCurveAccountInfo: await conn().getAccountInfo(curvePda),
      bondingCurve: curve,
      mint, user,
      amount: new BN(String(amount)),
      solAmount: new BN(0),
      slippage,
      tokenProgram: T22P,
    })),
  ];
  return signSimSend(identity, ixs, 'pump.exit', { mint: mintAddress, amount_raw: String(amount) });
}

// Sweep the creator fees accrued on the curve.
export async function collect({ identity, mint: mintAddress }) {
  const user = new PublicKey(identity.solana.public_key);
  const ix = await sdk.sweepCreatorFeeInstruction({ payer: user, mint: new PublicKey(mintAddress), creator: user, quoteMint: WSOL, quoteTokenProgram: TOKEN });
  return signSimSend(identity, [ix], 'pump.collect', { mint: mintAddress });
}

// Vault → wallet: `collect_creator_fee` (pump program). Sweeps move curve fees into the
// creator vault; this instruction pays them out to the creator account.
const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const COLLECT_DISC = [20, 22, 86, 123, 198, 28, 219, 132];

export async function withdrawVault({ identity }) {
  const creator = new PublicKey(identity.solana.public_key);
  const vault = PublicKey.findProgramAddressSync([Buffer.from('creator-vault'), creator.toBuffer()], PUMP_PROGRAM)[0];
  const eventAuthority = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], PUMP_PROGRAM)[0];
  const ix = {
    programId: PUMP_PROGRAM,
    keys: [
      { pubkey: creator.toBase58(), isSigner: true, isWritable: true },
      { pubkey: vault.toBase58(), isSigner: false, isWritable: true },
      { pubkey: '11111111111111111111111111111111', isSigner: false, isWritable: false },
      { pubkey: eventAuthority.toBase58(), isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM.toBase58(), isSigner: false, isWritable: false },
    ],
    dataHex: Buffer.from(COLLECT_DISC).toString('hex'),
  };
  return signSimSend(identity, [ix], 'pump.withdraw_vault', { creator: creator.toBase58(), vault: vault.toBase58() });
}
