// Founder handshake, outside the guest: send the chosen endowment to the published
// Solana address from the receipt. The founder key never enters the guest.
// usage: node bin/founder-endow.mjs <lamports>
import fs from 'node:fs';
import os from 'node:os';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { readJson } from '../lib/util.mjs';
import { P } from '../lib/paths.mjs';

const lamports = Number(process.argv[2] || 0.02 * LAMPORTS_PER_SOL);
const receipt = readJson(P.receipt, null);
if (!receipt) throw new Error('no birth receipt');
const dest = new PublicKey(receipt.payload.solana.public_key);
const rpcUrl = process.env.RPC_URL || fs.readFileSync(`${os.homedir()}/Documents/triton_api_key.txt`, 'utf8').trim();
const founder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/Documents/hooked.txt`, 'utf8'))));
const conn = new Connection(rpcUrl, { commitment: 'confirmed' });
console.log(JSON.stringify({ founder: founder.publicKey.toBase58(), to: dest.toBase58(), lamports, before: await conn.getBalance(dest) }));
const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: founder.publicKey, toPubkey: dest, lamports }));
const sig = await sendAndConfirmTransaction(conn, tx, [founder], { commitment: 'confirmed' });
console.log(JSON.stringify({ signature: sig, after: await conn.getBalance(dest), classification: 'endowment_capital_not_revenue' }));
