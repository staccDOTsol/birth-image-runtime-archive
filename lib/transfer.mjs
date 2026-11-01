// Move SOL from the guest's own sealed wallet to another address, signed through the signer socket.
// Used by procreation to endow a newborn from the parent child's own balance.
import * as S from './signer-client.mjs';
import * as R from './rpc.mjs';

export async function sendSol(identity, to, lamports) {
  const ixs = [{
    programId: '11111111111111111111111111111111',
    keys: [
      { pubkey: identity.solana.public_key, isSigner: true, isWritable: true },
      { pubkey: to, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(Uint8Array.of(2, 0, 0, 0, ...new Uint8Array(new BigUint64Array([BigInt(lamports)]).buffer))).toString('base64'),
  }];
  const { blockhash, lastValidBlockHeight } = await R.getLatestBlockhash();
  const env = await S.signV1({ instructions: ixs, blockhash, lastValidBlockHeight, cuLimit: 200_000, allowedDestinations: [to], strategy: true });
  const sig = await R.sendRaw(env.wireBase64);
  return { signature: sig };
}
