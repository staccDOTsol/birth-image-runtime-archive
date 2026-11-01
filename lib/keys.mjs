// Key material. Every private byte stays in the signer process; this module is the
// generation/derivation layer used once at first boot and by the signer daemon.
import crypto from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { secp256k1 } from '@noble/curves/secp256k1';
import { ed25519 } from '@noble/curves/ed25519';
import { keccak_256 } from '@noble/hashes/sha3';
import bs58 from 'bs58';

export function newSolanaKeypair() {
  const kp = Keypair.generate();
  return { secretKey: Buffer.from(kp.secretKey), publicKey: kp.publicKey.toBase58() };
}

export function solanaFromSecret(secret) {
  const kp = Keypair.fromSecretKey(Uint8Array.from(secret));
  return { secretKey: Buffer.from(kp.secretKey), publicKey: kp.publicKey.toBase58() };
}

export function newEvmKey() {
  const priv = crypto.randomBytes(32);
  return { secretKey: priv, address: evmAddress(priv) };
}

export function evmAddress(priv) {
  const pub = secp256k1.getPublicKey(priv, false); // 0x04 || X || Y
  const h = keccak_256(pub.slice(1));
  return '0x' + Buffer.from(h.slice(12)).toString('hex');
}

// EIP-191 personal_sign over exact message bytes.
export function evmSign(priv, message) {
  const body = Buffer.isBuffer(message) ? message : Buffer.from(message, 'utf8');
  const prefixed = Buffer.concat([
    Buffer.from(`\x19Ethereum Signed Message:\n${body.length}`, 'utf8'), body,
  ]);
  const digest = Buffer.from(keccak_256(prefixed));
  const sig = secp256k1.sign(digest, priv, { lowS: true });
  const r = Buffer.from(sig.r.toString(16).padStart(64, '0'), 'hex');
  const s = Buffer.from(sig.s.toString(16).padStart(64, '0'), 'hex');
  const v = Buffer.from([sig.recovery + 27]);
  return '0x' + Buffer.concat([r, s, v]).toString('hex');
}

// Solana's 64-byte secret key is seed || publicKey; ed25519 signs with the seed.
export function ed25519Sign(secret64, message) {
  const seed = Uint8Array.from(secret64).slice(0, 32);
  const body = Buffer.isBuffer(message) ? message : Buffer.from(message, 'utf8');
  return bs58.encode(Buffer.from(ed25519.sign(body, seed)));
}

export function ed25519Verify(publicKeyB58, message, signatureB58) {
  const pub = bs58.decode(publicKeyB58);
  const body = Buffer.isBuffer(message) ? message : Buffer.from(message, 'utf8');
  return ed25519.verify(bs58.decode(signatureB58), body, pub);
}

export function evmVerify(address, message, signatureHex) {
  const body = Buffer.isBuffer(message) ? message : Buffer.from(message, 'utf8');
  const prefixed = Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${body.length}`, 'utf8'), body]);
  const sig = signatureHex.replace(/^0x/, '');
  let v = parseInt(sig.slice(128, 130), 16);
  if (v >= 27) v -= 27;
  const sigObj = secp256k1.Signature.fromCompact(Buffer.from(sig.slice(0, 128), 'hex')).addRecoveryBit(v);
  const pub = sigObj.recoverPublicKey(keccak_256(prefixed));
  const h = keccak_256(pub.toRawBytes(false).slice(1));
  return ('0x' + Buffer.from(h.slice(12)).toString('hex')) === address.toLowerCase();
}
