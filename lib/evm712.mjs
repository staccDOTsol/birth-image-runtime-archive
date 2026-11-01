// EIP-712 typed-data hashing for the x402 exact scheme (EIP-3009 TransferWithAuthorization).
import { keccak_256 } from '@noble/hashes/sha3';

const enc = new TextEncoder();
export function keccak(buf) { return Buffer.from(keccak_256(buf)); }
export function keccakHex(buf) { return '0x' + keccak(buf).toString('hex'); }

function typeHash(primaryType, types) {
  const fields = types[primaryType].map((f) => `${f.type} ${f.name}`).join(',');
  return keccak(enc.encode(`${primaryType}(${fields})`));
}

export function eip712DomainHash(domain, types) {
  const fields = types.EIP712Domain.map((f) => `${f.type} ${f.name}`).join(',');
  const th = keccak(enc.encode(`EIP712Domain(${fields})`));
  const parts = [th];
  for (const f of types.EIP712Domain) {
    const v = domain[f.name];
    if (f.type === 'uint256') parts.push(uint256(v));
    else if (f.type === 'address') parts.push(address(v));
    else parts.push(keccak(enc.encode(String(v))));
  }
  return keccak(Buffer.concat(parts));
}

function uint256(v) {
  const b = Buffer.alloc(32);
  let n = BigInt(v);
  for (let i = 31; i >= 0 && n > 0n; i--) { b[i] = Number(n & 0xffn); n >>= 8n; }
  return b;
}
function address(a) {
  const b = Buffer.alloc(32);
  Buffer.from(a.replace(/^0x/, ''), 'hex').copy(b, 12);
  return b;
}
function bytes32(v) { return Buffer.from(v.replace(/^0x/, ''), 'hex'); }

export function hashStruct(primaryType, types, message) {
  const parts = [typeHash(primaryType, types)];
  for (const f of types[primaryType]) {
    const v = message[f.name];
    if (f.type === 'uint256') parts.push(uint256(v));
    else if (f.type === 'address') parts.push(address(v));
    else if (f.type === 'bytes32') parts.push(bytes32(v));
    else parts.push(keccak(enc.encode(String(v))));
  }
  return keccak(Buffer.concat(parts));
}

export function eip712Digest({ domain, types, primaryType, message }) {
  const d = eip712DomainHash(domain, types);
  const s = hashStruct(primaryType, types, message);
  return keccak(Buffer.concat([Buffer.from([0x19, 0x01]), d, s]));
}
