// Pump launch strategy adapter: inspect the live curve, build a launch (create_v2 +
// first buy) and an exit (sell + sweep + collect), and verify every plan by simulation.
// The executed ABI is the deployed program's; a simulation failure is reported as a gate,
// never as a launch.
import { PublicKey, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { P } from '../lib/paths.mjs';
import { readJson, atomicJson, now, log, sha256hex, canon } from '../lib/util.mjs';
import * as R from '../lib/rpc.mjs';
import * as S from '../lib/signer-client.mjs';
import * as J from '../lib/journal.mjs';

export const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_AMM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export const PUMP_FEES = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
export const MAYHEM = 'MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SYSTEM = '11111111111111111111111111111111';

export const DISC = {
  create_v2: [214, 144, 76, 236, 95, 139, 49, 180],
  buy: [102, 6, 61, 18, 1, 218, 235, 234],
  sell: [51, 230, 133, 164, 1, 127, 131, 173],
  collect_creator_fee: [20, 22, 86, 123, 198, 28, 219, 132],
};

export const pda = (seeds, program) => PublicKey.findProgramAddressSync(seeds.map((s) => (typeof s === 'string' ? Buffer.from(s) : s)), new PublicKey(program))[0];
export const bondingCurve = (mint) => pda(['bonding-curve', new PublicKey(mint).toBuffer()], PUMP);
export const creatorVault = (creator) => pda(['creator-vault', new PublicKey(creator).toBuffer()], PUMP);

function bookPath() { return P.strategy + '/pump.json'; }
export function loadBook() { return readJson(bookPath(), { positions: [], attempts: [], updated_at: null }); }
export function saveBook(b) { b.updated_at = now(); atomicJson(bookPath(), b, 0o600); }

// BondingCurve (current program): 8-byte discriminator, then five u64 reserves,
// bool complete, creator pubkey. Extra trailing fields are preserved but unused here.
export function decodeCurve(buf) {
  if (!buf || buf.length < 8 + 5 * 8 + 1 + 32) return null;
  const b = Buffer.from(buf);
  const disc = b.subarray(0, 8);
  let o = 8;
  const u64 = () => { const v = b.readBigUInt64LE(o); o += 8; return v; };
  const virtualTokenReserves = u64(), virtualQuoteReserves = u64(), realTokenReserves = u64(), realQuoteReserves = u64(), tokenTotalSupply = u64();
  const complete = b.readUInt8(o) !== 0; o += 1;
  const creator = new PublicKey(b.subarray(o, o + 32)); o += 32;
  return {
    discriminator: [...disc], virtualTokenReserves, virtualQuoteReserves, realTokenReserves, realQuoteReserves,
    tokenTotalSupply, complete, creator: creator.toBase58(),
  };
}

export async function inspect(mint) {
  const curve = bondingCurve(mint);
  const info = await R.getAccountInfo(curve.toBase58());
  if (!info) return { mint, curve: curve.toBase58(), exists: false };
  const d = decodeCurve(Buffer.from(info.data[0], 'base64'));
  const owner = info.owner;
  return {
    mint, curve: curve.toBase58(), exists: true, owner,
    programme_ok: owner === PUMP,
    ...d,
    ui: d ? {
      virtual_sol: Number(d.virtualQuoteReserves) / 1e9,
      real_sol: Number(d.realQuoteReserves) / 1e9,
      real_tokens: Number(d.realTokenReserves) / 1e6,
      complete: d.complete,
    } : null,
    slot_seen: (await R.getSlot()) ,
  };
}

// Reuse one live, successfully executed create_v2 instruction set from the deployed
// program, then substitute this guest's keys and arguments. This is the adapter: the
// template proves the current account order, and the rebuilt plan is simulated before use.
export async function templateCreate() {
  const sigs = await R.rpc('getSignaturesForAddress', [PUMP, { limit: 25 }]);
  for (const s of sigs) {
    const tx = await R.getTransaction(s.signature).catch(() => null);
    if (!tx || tx.meta?.err) continue;
    const msg = tx.transaction.message;
    const keys = [...msg.accountKeys.map((k) => (typeof k === 'string' ? k : k.pubkey)), ...(tx.meta.loadedAddresses?.writable || []), ...(tx.meta.loadedAddresses?.readonly || [])];
    const header = msg.header;
    const staticCount = msg.accountKeys.length;
    const writable = (i) => i < staticCount
      ? (i < header.numRequiredSignatures ? i < header.numRequiredSignatures - header.numReadonlySignedAccounts : i < staticCount - header.numReadonlyUnsignedAccounts)
      : i < staticCount + (tx.meta.loadedAddresses?.writable || []).length;
    for (const [n, raw] of msg.instructions.entries()) {
      if (keys[raw.programIdIndex] !== PUMP) continue;
      const data = Buffer.from(raw.data, 'base64');
      if (data.length < 8) continue;
      const name = Object.entries(DISC).find(([, d]) => d.every((x, i) => data[i] === x));
      if (!name) continue;
      return {
        signature: s.signature, name: name[0], slot: tx.slot,
        keys: raw.accounts.map((i) => ({ pubkey: keys[i], writable: writable(i), signer: i < header.numRequiredSignatures })),
        dataHex: data.toString('hex'),
        inner: (tx.meta.innerInstructions || []).find((g) => g.index === n)?.instructions || [],
      };
    }
  }
  return null;
}

export function encodeCreateV2({ name, symbol, uri, creator }) {
  const parts = [Buffer.from(DISC.create_v2)];
  for (const s of [name, symbol, uri]) {
    const b = Buffer.from(s, 'utf8');
    const len = Buffer.alloc(4); len.writeUInt32LE(b.length, 0);
    parts.push(len, b);
  }
  parts.push(new PublicKey(creator).toBuffer());
  parts.push(Buffer.from([0])); // is_mayhem_mode = false
  return Buffer.concat(parts);
}

function encodeBuy({ amount, maxSolCost }) {
  const b = Buffer.alloc(8 + 8 + 8 + 1);
  Buffer.from(DISC.buy).copy(b, 0);
  b.writeBigUInt64LE(BigInt(amount), 8);
  b.writeBigUInt64LE(BigInt(maxSolCost), 16);
  b.writeUInt8(1, 24); // OptionBool::Some
  b.writeUInt8(0, 25); // false
  return b.subarray(0, 26);
}

// Planned launch: derive the canonical PDAs and place them into the template order.
export async function planLaunch({ identity, mintKeypair, name, symbol, uri, devbuyLamports }) {
  const tpl = await templateCreate();
  if (!tpl) throw new Error('no create_v2 template found on the deployed program');
  if (tpl.name !== 'create_v2') throw new Error(`template is ${tpl.name}, not create_v2`);
  const mint = mintKeypair.publicKey.toBase58();
  const owner = identity.solana.public_key;
  const curve = bondingCurve(mint).toBase58();
  const curveOwner = bondingCurve(mint);
  const assocCurve = PublicKey.findProgramAddressSync(
    [curveOwner.toBuffer(), new PublicKey(TOKEN_2022).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(ATA_PROGRAM))[0].toBase58();
  const byName = new Map();
  for (const k of tpl.keys) byName.set(k.pubkey, k);
  // Name-based substitution only where the program derives from the mint/creator/user.
  const subst = {
    mint, bonding_curve: curve, associated_bonding_curve: assocCurve, user: owner,
  };
  const templateAccountNames = ['mint', 'mint_authority', 'bonding_curve', 'associated_bonding_curve', 'global', 'user', 'system_program', 'token_program', 'associated_token_program', 'mayhem_program_id', 'global_params', 'sol_vault', 'mayhem_state', 'mayhem_token_vault', 'event_authority', 'program'];
  const keys = tpl.keys.map((k, i) => {
    const n = templateAccountNames[i];
    if (subst[n]) return { ...k, pubkey: subst[n] };
    if (n === 'mayhem_program_id') return { ...k, pubkey: MAYHEM };
    if (n === 'global_params') return { ...k, pubkey: pda(['global-params'], MAYHEM).toBase58() };
    if (n === 'sol_vault') return { ...k, pubkey: pda(['sol-vault'], MAYHEM).toBase58() };
    if (n === 'mayhem_state') return { ...k, pubkey: pda(['mayhem-state', new PublicKey(mint).toBuffer()], MAYHEM).toBase58() };
    if (n === 'event_authority') return { ...k, pubkey: pda(['__event_authority'], PUMP).toBase58() };
    return k;
  });
  const ixs = [{
    programId: PUMP,
    keys,
    dataHex: encodeCreateV2({ name, symbol, uri, creator: owner }).toString('hex'),
  }];
  if (devbuyLamports > 0) {
    ixs.push(...await buildBuy({ identity, mint, devbuyLamports }));
  }
  return {
    plan_hash: sha256hex(Buffer.from(canon({ mint, name, symbol, uri, devbuyLamports, template: tpl.signature }))),
    mint, mint_secret: bs58.encode(mintKeypair.secretKey), ixs, template: tpl.signature, template_slot: tpl.slot,
  };
}

// Buy needs the curve's live reserves to bound token amount and SOL cost. Quotes use the
// program's own integer curve arithmetic: constant product over virtual reserves with the
// configured fee applied to the input.
export async function buildBuy({ identity, mint, devbuyLamports, slippageBps = 300 }) {
  const inv = await inspect(mint);
  if (!inv.exists) throw new Error('curve does not exist for buy');
  const vq = inv.virtualQuoteReserves, vt = inv.virtualTokenReserves;
  const fee = (BigInt(devbuyLamports) * 95n) / 10000n; // 0.95% protocol
  const net = BigInt(devbuyLamports) - fee;
  const tokensOut = (vt * net) / (vq + net);
  const minTokens = (tokensOut * BigInt(10000 - slippageBps)) / 10000n;
  const owner = identity.solana.public_key;
  const assocUser = PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), new PublicKey(TOKEN_2022).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(ATA_PROGRAM))[0].toBase58();
  const tpl = await templateBuy();
  if (!tpl) throw new Error('no buy template found');
  return [{
    programId: PUMP, keys: tpl.keys, dataHex: encodeBuy({ amount: minTokens, maxSolCost: devbuyLamports }).toString('hex'),
    note: `tokens_out≈${tokensOut} min=${minTokens}`,
  }];
}

export async function templateBuy() {
  const sigs = await R.rpc('getSignaturesForAddress', [PUMP, { limit: 25 }]);
  for (const s of sigs) {
    const tx = await R.getTransaction(s.signature).catch(() => null);
    if (!tx || tx.meta?.err) continue;
    const msg = tx.transaction.message;
    const keys = [...msg.accountKeys.map((k) => (typeof k === 'string' ? k : k.pubkey)), ...(tx.meta.loadedAddresses?.writable || []), ...(tx.meta.loadedAddresses?.readonly || [])];
    for (const raw of msg.instructions) {
      if (keys[raw.programIdIndex] !== PUMP) continue;
      const data = Buffer.from(raw.data, 'base64');
      if (data.length < 8 || !DISC.buy.every((x, i) => data[i] === x)) continue;
      return { signature: s.signature, dataHex: data.toString('hex'), keys: raw.accounts.map((i) => ({ pubkey: keys[i] })) };
    }
  }
  return null;
}

export async function simulateLaunch({ identity, plan }) {
  const { blockhash, lastValidBlockHeight } = await R.getLatestBlockhash();
  const env = await S.signV1({ instructions: plan.ixs, blockhash, lastValidBlockHeight, cuLimit: 1_400_000, extraSigners: [plan.mint_secret] });
  const sim = await R.simulate(env.wireBase64, [plan.mint, identity.solana.public_key]);
  return { err: sim.value?.err || null, logs: (sim.value?.logs || []).slice(-24), units: sim.value?.unitsConsumed, env, blockhash, lastValidBlockHeight };
}
