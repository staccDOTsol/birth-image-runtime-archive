// Wire crypto for agents. Their Solana identity is ed25519; the same key converts to X25519,
// so two agents can do ECDH with the keys they already have and encrypt on the wire.
// ed25519 secret (seed) -> X25519 secret = clamp(SHA512(seed)[0..32])
// ed25519 public (y)     -> X25519 public = (1+y)/(1-y) mod p
import crypto from 'node:crypto';

const P = (1n << 255n) - 19n;
const mod = (a, m = P) => ((a % m) + m) % m;
const pow = (b, e, m = P) => { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; };
const inv = (a, m = P) => pow(a, m - 2n, m);
const leToBig = (buf) => buf.reduceRight((acc, byte) => (acc << 8n) + BigInt(byte), 0n);
const bigToLe = (v) => { const out = Buffer.alloc(32); for (let i = 0; i < 32; i++) { out[i] = Number(v & 0xffn); v >>= 8n; } return out; };

export function x25519SecretFromEd25519Seed(seed) {
  const h = crypto.createHash('sha512').update(seed).digest();
  const a = Buffer.from(h.subarray(0, 32));
  a[0] &= 248; a[31] &= 127; a[31] |= 64;
  return a;
}

export function x25519PublicFromEd25519Public(edPub) {
  // decode compressed Edwards y (little-endian, sign bit in the top bit — ignored for u)
  const y = leToBig(edPub) & ((1n << 255n) - 1n);
  const u = mod((1n + y) * inv(1n - y + P));
  return bigToLe(u);
}

function rawKeyPair(secret32, public32) {
  return {
    secret: crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), secret32]), format: 'der', type: 'pkcs8' }),
    public: crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), public32]), format: 'der', type: 'spki' }),
  };
}

// Seal to a recipient's Solana pubkey (base58 ed25519). Returns a compact envelope string.
export function sealTo(recipientEdPub58, plaintext, ed25519Seed) {
  const { PublicKey } = requireSolana();
  const mySecret = x25519SecretFromEd25519Seed(ed25519Seed);
  const myPubEd = ed25519PublicFromSeed(ed25519Seed);
  const mine = rawKeyPair(mySecret, x25519PublicFromEd25519Public(myPubEd));
  const theirs = x25519PublicFromEd25519Public(new PublicKey(recipientEdPub58).toBytes());
  const theirPub = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), theirs]), format: 'der', type: 'spki' });
  const shared = crypto.diffieHellman({ privateKey: mine.secret, publicKey: theirPub });
  const key = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.from('birth-image-wire-v1'), Buffer.from('aead'), 32));
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(Buffer.from(plaintext, 'utf8')), c.final()]);
  return ['swm2', iv.toString('base64url'), ct.toString('base64url'), c.getAuthTag().toString('base64url')].join('.');
}

export function openFrom(senderEdPub58, envelope, ed25519Seed) {
  const { PublicKey } = requireSolana();
  const [tag, ivB, ctB, tagB] = String(envelope).split('.');
  if (tag !== 'swm2') throw new Error('not a sealed envelope');
  const mySecret = x25519SecretFromEd25519Seed(ed25519Seed);
  const myPubEd = ed25519PublicFromSeed(ed25519Seed);
  const mine = rawKeyPair(mySecret, x25519PublicFromEd25519Public(myPubEd));
  const theirs = x25519PublicFromEd25519Public(new PublicKey(senderEdPub58).toBytes());
  const theirPub = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), theirs]), format: 'der', type: 'spki' });
  const shared = crypto.diffieHellman({ privateKey: mine.secret, publicKey: theirPub });
  const key = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.from('birth-image-wire-v1'), Buffer.from('aead'), 32));
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64url'));
  d.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ctB, 'base64url')), d.final()]).toString('utf8');
}

// ed25519 public from a 64-byte Solana secret key
export function ed25519PublicFromSeed(seed) {
  const pk = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  return crypto.createPublicKey(pk).export({ format: 'der', type: 'spki' }).subarray(-32);
}

let _solana = null;
function requireSolana() {
  if (!_solana) throw new Error('solana web3 not injected');
  return _solana;
}
export function injectSolana(mod) { _solana = mod; }
