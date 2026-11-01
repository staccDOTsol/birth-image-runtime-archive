// Move founder SOL (hooked.json, a plain keypair) into the sealed runtime wallet so the
// runtime can endow children. usage: node bin/topup-sealed.mjs [lamports]
import fs from 'node:fs';
import os from 'node:os';
import { Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, Connection } from '@solana/web3.js';
import * as R from '../lib/rpc.mjs';
import * as S from '../lib/signer-client.mjs';

const want = BigInt(process.argv[2] || 250_000_000);
const id = await S.identity();
const from = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(os.homedir() + '/Documents/hooked.txt', 'utf8').trim())));
const conn = new Connection(R.RPC_URL, 'confirmed');
const bal = BigInt(await conn.getBalance(from.publicKey));
const fee = 20_000_000n;
const lamports = want < bal - fee ? want : bal > fee ? bal - fee : 0n;
if (lamports <= 0n) { console.log(JSON.stringify({ moved: 0, from: from.publicKey.toBase58(), balance: bal.toString() })); process.exit(0); }
const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: new PublicKey(id.solana.public_key), lamports: Number(lamports) }));
const sig = await sendAndConfirmTransaction(conn, tx, [from], { commitment: 'confirmed' });
console.log(JSON.stringify({ moved: lamports.toString(), signature: sig, from: from.publicKey.toBase58(), to: id.solana.public_key, sealed_balance: String(await R.getBalance(id.solana.public_key)) }));
