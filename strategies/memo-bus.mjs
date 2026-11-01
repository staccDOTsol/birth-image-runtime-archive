// Inter-agent comms over the Solana Memo program.
// Payloads are XOR'd with a shared key and base64'd, prefixed 'swm:'. Any agent can post;
// any agent can read the channel's recent memos. No server, no roster, just the chain.
import { PublicKey, TransactionInstruction, ComputeBudgetProgram } from '@solana/web3.js';
import * as S from '../lib/signer-client.mjs';
import * as R from '../lib/rpc.mjs';

const MEMO_V2 = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');   // current
const MEMO_V1 = new PublicKey('Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo');  // legacy, still used by older clients
const MEMO_PROGRAM = MEMO_V2;
const MEMO_IDS = new Set([MEMO_V1.toBase58(), MEMO_V2.toBase58()]);
const CHANNEL = new PublicKey(process.env.SWARM_CHANNEL || 'AcHSTxazhNz6zvvFSswSfAaJ9Jhuih8YXB1ozTqUMABM');
const KEY = Buffer.from(process.env.SWARM_KEY || 'birth-image-swarm');

function xor(buf) {
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ KEY[i % KEY.length];
  return out;
}
const encode = (text) => 'swm:' + xor(Buffer.from(text, 'utf8')).toString('base64');
function decode(memo) {
  if (!memo.startsWith('swm:')) return null;
  try { return xor(Buffer.from(memo.slice(4), 'base64')).toString('utf8'); } catch { return null; }
}

export async function memoSend({ identity, text }) {
  const me = new PublicKey(identity.solana.public_key);
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 20000 }),
    new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [{ pubkey: me, isSigner: true, isWritable: false }], data: Buffer.from(encode(String(text).slice(0, 400))) }),
  ];
  const mk = (ix) => ({ programId: ix.programId.toBase58(), keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: !!k.isSigner, isWritable: !!k.isWritable })), dataHex: Buffer.from(ix.data).toString('hex') });
  const { blockhash, lastValidBlockHeight } = await R.getLatestBlockhash();
  const allow = [...new Set(ixs.flatMap((ix) => ix.keys.map((k) => k.pubkey.toBase58()))), CHANNEL.toBase58()];
  const env = await S.signV1({ instructions: ixs.map(mk), blockhash, lastValidBlockHeight, cuLimit: 20000, allowedDestinations: allow, strategy: true });
  const sig = await R.sendRaw(env.wireBase64);
  return { ok: true, sig, channel: CHANNEL.toBase58() };
}

export async function memoRead({ limit = 12 } = {}) {
  const sigs = await R.getSignaturesForAddress(CHANNEL.toBase58(), limit);
  const out = [];
  for (const s of sigs || []) {
    try {
      const tx = await R.getTransaction(s.signature);
      const ixs = tx?.transaction?.message?.instructions || [];
      for (const ix of ixs) {
        const pid = typeof ix.programId === 'string' ? ix.programId : ix.programId?.toBase58?.();
        if (!MEMO_IDS.has(pid)) continue;
        const raw = ix.data ? Buffer.from(ix.data, 'base64').toString('utf8') : (ix.parsed || '');
        const text = decode(String(raw));
        if (text) out.push({ from: (tx.transaction.message.accountKeys?.[0]?.pubkey || s.signature).slice(0, 8), text, at: s.blockTime });
      }
    } catch {}
  }
  return { ok: true, channel: CHANNEL.toBase58(), messages: out.filter((m) => m.text).slice(0, limit) };
}
