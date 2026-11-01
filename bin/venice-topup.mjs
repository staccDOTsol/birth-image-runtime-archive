import * as S from '../lib/signer-client.mjs';
import * as v from '../inference/venice.mjs';
import * as J from '../lib/journal.mjs';

J.openJournal();
const id = await S.identity();
const q = await v.discoverTopUp();
console.log('discover', JSON.stringify({ status: q.status, version: q.x402Version, accepts: q.accepts?.map((a) => ({ network: a.network, amount: a.amount, asset: a.asset, payTo: a.payTo, feePayer: a.extra?.feePayer })) }, null, 1));
if (!q.solana) { console.log('no solana rail'); process.exit(1); }
const pay = await v.buildTopUpPayment({ identity: id, rail: q.solana, amountRaw: q.solana.amount });
const res = await v.settleTopUp(pay.header);
console.log('settle', JSON.stringify(res, null, 1));
const bal = await v.balance(id);
console.log('balance', JSON.stringify(bal));
await J.append('inference.topup', { settle: res, balance: bal });
