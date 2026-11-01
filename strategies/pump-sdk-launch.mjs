// Pump launch through the official SDK (pump-fun/pump-sdk), not a hand-rolled layout.
// The SDK owns the account order and argument encoding; we only sign and simulate.
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { PumpSdk, OnlinePumpSdk } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import * as S from '../lib/signer-client.mjs';
import * as R from '../lib/rpc.mjs';
import * as J from '../lib/journal.mjs';
import { now } from '../lib/util.mjs';

const sdk = new PumpSdk();

function wire(ix) {
  return {
    programId: ix.programId.toBase58(),
    keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: !!k.isSigner, isWritable: !!k.isWritable })),
    dataHex: Buffer.from(ix.data).toString('hex'),
  };
}

export async function launch({ identity, name, symbol, uri, devbuyLamports = 0 }) {
  const user = new PublicKey(identity.solana.public_key);
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;

  const ixs = [];
  ixs.push(await sdk.createV2Instruction({
    mint, name, symbol, uri, creator: user, user, mayhemMode: false,
  }));

  if (devbuyLamports > 0) {
    // classic SPL create+buy in one instruction set: the t22 combined path rejects the buy
    const conn = new Connection(R.RPC_URL, 'confirmed');
    const online = new OnlinePumpSdk(conn);
    const global = await online.fetchGlobal();
    const built = await sdk.createAndBuyInstructions({
      global, mint, name, symbol, uri,
      creator: user, user,
      amount: new BN(0), solAmount: new BN(String(devbuyLamports)),
      isTokenizedAgent: false, buyBackBps: 0,
    });
    ixs.length = 0;
    ixs.push(...(built.instructions || built));
  }
  const { blockhash, lastValidBlockHeight } = await R.getLatestBlockhash();
  const env = await S.signV1({
    instructions: ixs.map(wire),
    blockhash,
    lastValidBlockHeight,
    cuLimit: 1_400_000,
    allowedDestinations: [mint.toBase58()],
    extraSigners: [Buffer.from(mintKp.secretKey).toString('base64')],
    strategy: true,
  });
  const sim = await R.simulate(env.wireBase64, [user.toBase58(), mint.toBase58()]);
  const base = { at: now(), provider: 'pump-sdk', mint: mint.toBase58(), ixs: ixs.length, sim_err: sim.value?.err || null, sim_logs: (sim.value?.logs || []).slice(-8) };
  if (sim.value?.err) { await J.append('pump.launch_sim_failed', base); return { ok: false, ...base }; }
  const sig = await R.sendRaw(env.wireBase64);
  let status = null;
  for (let i = 0; i < 40; i++) { const st = (await R.signatureStatuses([sig]))[0]; if (st?.confirmationStatus) { status = st; break; } await new Promise((r) => setTimeout(r, 1200)); }
  const out = { ...base, signature: sig, status: status?.confirmationStatus || 'unknown', err: status?.err || null };
  await J.append('pump.launch', out);
  return { ok: !status?.err && !!status, ...out };
}
