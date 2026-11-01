// Send Base USDC from the sealed parent wallet. viem builds and serialises the tx, the
// signer only ever sees the hash — the key never leaves it.
// usage: node bin/evm-send.mjs <to> <usdcAmount> [chainId]
import { createWalletClient, createPublicClient, http, parseAbi, serializeTransaction, keccak256 } from 'viem';
import { base } from 'viem/chains';
import * as S from '../lib/signer-client.mjs';

const [to, amountArg, chainArg] = process.argv.slice(2);
const amount = Number(amountArg || 0.05);
const chain = chainArg === '8453' || !chainArg ? base : base;
if (!to) { console.log(JSON.stringify({ err: 'usage: evm-send.mjs <to> <usdc>' })); process.exit(1); }

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const abi = parseAbi(['function transfer(address to, uint256 amount) returns (bool)']);
const value = BigInt(Math.round(amount * 1e6));

const pub = createPublicClient({ chain, transport: http('https://mainnet.base.org') });
const id = await S.identity();
const from = id.evm.address;

const data = encodeTransfer(to, value);
const nonce = await pub.getTransactionCount({ address: from });
const fees = await pub.estimateFeesPerGas();
const gas = 65000n;

const tx = {
  to: USDC,
  data,
  value: 0n,
  chainId: chain.id,
  nonce,
  gas,
  maxFeePerGas: fees.maxFeePerGas,
  maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  type: 'eip1559',
};

const unsigned = serializeTransaction(tx);
const hash = keccak256(unsigned);
const sigRes = await S.signEvmHash(hash);
const sigHex = sigRes.evm?.signature || sigRes.signature || sigRes;
const r = '0x' + sigHex.slice(2, 66);
const s = '0x' + sigHex.slice(66, 130);
const yParity = parseInt(sigHex.slice(130, 132), 16);

const signed = serializeTransaction(tx, { r, s, yParity });
const sent = await pub.sendRawTransaction({ serializedTransaction: signed });
console.log(JSON.stringify({ from, to, amount, tx: sent }));

function encodeTransfer(toAddr, amt) {
  const sel = 'a9059cbb';
  const addr = toAddr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const val = amt.toString(16).padStart(64, '0');
  return ('0x' + sel + addr + val);
}
