// Pump launch execution: create_v2 (+ optional dev buy), simulated before it is sent.
// A live template fixes the account order when one exists; otherwise the canonical
// PDA set is derived here and the simulation is the gate. Never sends on a failed sim.
import { Keypair, PublicKey } from '@solana/web3.js';
import * as S from '../lib/signer-client.mjs';
import * as R from '../lib/rpc.mjs';
import * as J from '../lib/journal.mjs';
import { now, log } from '../lib/util.mjs';
import * as pump from './pump.mjs';

const SYS = '11111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

export async function launch(identity, { name, symbol, uri, devbuyLamports = 0 } = {}) {
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey.toBase58();
  const owner = identity.solana.public_key;

  let plan;
  try {
    plan = await pump.planLaunch({ identity, mintKeypair, name, symbol, uri, devbuyLamports });
  } catch (e) {
    // Canonical account order, used when no live create_v2 template is visible.
    const curve = pump.bondingCurve(mint);
    const assocCurve = PublicKey.findProgramAddressSync(
      [curve.toBuffer(), new PublicKey(TOKEN_2022).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(ATA))[0];
    const global = PublicKey.findProgramAddressSync([Buffer.from('global')], new PublicKey(pump.PUMP))[0];
    const keys = [
      { pubkey: mint, isSigner: true, isWritable: true },
      { pubkey: pump.pda(['mint-authority'], pump.PUMP).toBase58(), isSigner: false, isWritable: false },
      { pubkey: curve.toBase58(), isSigner: false, isWritable: true },
      { pubkey: assocCurve.toBase58(), isSigner: false, isWritable: true },
      { pubkey: global.toBase58(), isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: SYS, isSigner: false, isWritable: false },
      { pubkey: TOKEN, isSigner: false, isWritable: false },
      { pubkey: ATA, isSigner: false, isWritable: false },
      { pubkey: pump.pda(['__event_authority'], pump.PUMP).toBase58(), isSigner: false, isWritable: false },
      { pubkey: pump.PUMP, isSigner: false, isWritable: false },
    ];
    const data = Buffer.concat([
      Buffer.from(pump.DISC?.create_v2 || [214, 144, 76, 236, 95, 139, 49, 180]),
      pump.encodeCreateV2({ name, symbol, uri, creator: owner }),
    ]);
    plan = { mint, mint_secret: Buffer.from(mintKeypair.secretKey).toString('base64'), ixs: [{ programId: pump.PUMP, keys, dataHex: data.toString('hex') }], template: 'canonical', plan_hash: null };
    log('pump', 'template missing; canonical plan built', { mint });
  }

  const { blockhash, lastValidBlockHeight } = await R.getLatestBlockhash();
  const env = await S.signV1({
    instructions: plan.ixs,
    blockhash,
    lastValidBlockHeight,
    cuLimit: 1_400_000,
    allowedDestinations: [plan.mint, pump.bondingCurve(plan.mint).toBase58()],
    extraSigners: [plan.mint_secret],
    strategy: true,
  });
  const sim = await R.simulate(env.wireBase64, [owner, plan.mint]);
  const rec = { at: now(), mint: plan.mint, plan_hash: plan.plan_hash, template: plan.template, sim_err: sim.value?.err || null, sim_logs: (sim.value?.logs || []).slice(-8) };
  if (sim.value?.err) { await J.append('pump.launch_sim_failed', rec); return { ok: false, ...rec }; }
  const sig = await R.sendRaw(env.wireBase64);
  let status = null;
  for (let i = 0; i < 40; i++) { const st = (await R.signatureStatuses([sig]))[0]; if (st?.confirmationStatus) { status = st; break; } await new Promise((r) => setTimeout(r, 1200)); }
  const out = { ...rec, signature: sig, status: status?.confirmationStatus || 'unknown', err: status?.err || null };
  await J.append('pump.launch', out);
  return { ok: !status?.err && !!status, ...out };
}
