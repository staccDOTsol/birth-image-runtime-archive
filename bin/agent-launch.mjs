// Agent-side launch: create the mint (with image metadata), then dev buy with the SDK's real
// argument shape (parsed curve, tokenProgram, slippage, non-zero amount). Runs inside the
// agent's own guest root so the wallet that launches is the agent's.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Connection, PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { PumpSdk, OnlinePumpSdk, bondingCurvePda } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import { buyImage } from './x402-image.mjs';
import * as pumpLaunch from '../strategies/pump-sdk-launch.mjs';
import * as S from '../lib/signer-client.mjs';
import * as R from '../lib/rpc.mjs';

const REPO = 'staccDOTsol/birth-image-runtime';
const BASE = 'https://staccdotsol.github.io/birth-image-runtime/coins';
const name = process.argv[2] || 'Agent Coin';
const symbol = process.argv[3] || 'AGNT';
const prompt = process.argv[4] || `${name} memecoin mascot, sticker art`;
const id = await S.identity();
const T22 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const { tokenProgramOf } = await import('../lib/token-program.mjs');

let img = await buyImage(prompt);
let bytes, ext;
if (img?.url?.startsWith('data:')) { bytes = Buffer.from(img.url.split(',')[1], 'base64'); ext = 'webp'; }
else { bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#0b0f14"/><circle cx="256" cy="256" r="140" fill="#6ee7b7"/></svg>'); ext = 'svg'; }
// host art + metadata anonymously (catbox) BEFORE the create, so the URI is live at mint time
let bytes2 = bytes, ext2 = ext;
if (img?.url?.startsWith('data:')) bytes2 = Buffer.from(img.url.split(',')[1], 'base64');
else if (img?.url && !img.url.startsWith('data:')) bytes2 = Buffer.from(await (await fetch(img.url)).arrayBuffer());
const { hostCoin } = await import('../lib/host-coin.mjs');
 if (process.env.COIN_URI) { var uri = process.env.COIN_URI; } else {
const hosted = await hostCoin({ name, symbol, description: `${name} — launched by a birth-image agent with a dev buy.`, imageBytes: bytes2, ext: ext2 });
uri = hosted.uri; }
console.log(JSON.stringify({ stage: 'hosted', uri }));

const launched = await pumpLaunch.launch({ identity: id, name, symbol, uri, devbuyLamports: 0 });
const mint = new PublicKey(launched.mint);
console.log(JSON.stringify({ stage: 'created', mint: mint.toBase58(), sig: launched.signature }));

const conn = new Connection(R.RPC_URL, 'confirmed');
const online = new OnlinePumpSdk(conn);
const sdk = new PumpSdk();
await new Promise((r) => setTimeout(r, 4000));
const balance = BigInt(await R.getBalance(id.solana.public_key) || 0);
const lamports = new BN(process.argv[5] || '0');   // caller states the size
const curve = await online.fetchBondingCurve(mint);
const curvePda = bondingCurvePda(mint);
const TP = await tokenProgramOf(conn, mint.toBase58());
const curveAta = getAssociatedTokenAddressSync(mint, curvePda, true, TP);
const userAta = getAssociatedTokenAddressSync(mint, new PublicKey(id.solana.public_key), false, T22);
const global = await online.fetchGlobal();
  // tokens out for this much SOL, from the curve's own reserves (constant product)
  const vTok = Number(curve.virtualTokenReserves ?? 0);
  const vSol = Number(curve.virtualQuoteReserves ?? 0);
  const inSol = Number(lamports);
  const expectedOut = vSol > 0 && vTok > 0 ? Math.floor((vTok * inSol) / (vSol + inSol)) : 0;
const ixs = [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
  createAssociatedTokenAccountIdempotentInstruction(new PublicKey(id.solana.public_key), userAta, new PublicKey(id.solana.public_key), mint, T22),
  createAssociatedTokenAccountIdempotentInstruction(new PublicKey(id.solana.public_key), curveAta, curvePda, mint, T22),
  ...(await sdk.buyInstructions({ global, bondingCurveAccountInfo: await conn.getAccountInfo(curvePda), bondingCurve: curve, associatedUserAccountInfo: null, mint, user: new PublicKey(id.solana.public_key), amount: new BN(String(Math.floor(expectedOut * 0.95))), solAmount: lamports, slippage: 1500, tokenProgram: T22 })),
];
const mk = (ix) => ({ programId: ix.programId.toBase58(), keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: !!k.isSigner, isWritable: !!k.isWritable })), dataHex: Buffer.from(ix.data).toString('hex') });
const { blockhash, lastValidBlockHeight } = await R.getLatestBlockhash();
const allow = [...new Set(ixs.flatMap((ix) => ix.keys.map((k) => k.pubkey.toBase58())))];
const env = await S.signV1({ instructions: ixs.map(mk), blockhash, lastValidBlockHeight, cuLimit: 400000, allowedDestinations: allow, strategy: true });
const sim = await R.simulate(env.wireBase64, allow);
if (sim.value?.err) { console.log(JSON.stringify({ stage: 'devbuy', err: sim.value.err, logs: (sim.value.logs || []).slice(-2) })); process.exit(0); }
const sig = await R.sendRaw(env.wireBase64);
console.log(JSON.stringify({ stage: 'devbuy', ok: true, sig, sol: Number(lamports) / 1e9, mint: mint.toBase58(), image: img?.provider || 'fallback', uri }));
