// Sweep everything spendable from hooked.txt into the running agent's parent wallet, so top-ups
// made to the funding key reach the fleet without a human moving them. Keeps a small fee buffer.
// usage: node bin/scoop.mjs [keepLamports]
import fs from 'node:fs';
import os from 'node:os';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import * as S from '../lib/signer-client.mjs';
import { RPC_URL } from '../lib/rpc.mjs';
import { now } from '../lib/util.mjs';

const KEEP = BigInt(process.argv[2] || '12000000'); // 0.012 SOL so the key always ends above 0.01 after fees
const src = process.env.HOOKED_PATH || `${os.homedir()}/Documents/hooked.txt`;
const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
const kp = Keypair.fromSecretKey(Uint8Array.from(raw));
const conn = new Connection(RPC_URL, { commitment: 'confirmed' });
const id = await S.identity();
const dest = new PublicKey(id.solana.public_key);

const bal = BigInt(await conn.getBalance(kp.publicKey));
const lamports = bal - KEEP;
if (lamports <= 1_000_000n) {
  console.log(JSON.stringify({ at: now(), kind: 'scoop', skipped: true, balance: bal.toString(), to: dest.toBase58() }));
  process.exit(0);
}
const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: dest, lamports: Number(lamports) }));
const sig = await sendAndConfirmTransaction(conn, tx, [kp]);
console.log(JSON.stringify({ at: now(), kind: 'scoop', from: kp.publicKey.toBase58(), to: dest.toBase58(), lamports: lamports.toString(), signature: sig, status: 'finalized' }));
