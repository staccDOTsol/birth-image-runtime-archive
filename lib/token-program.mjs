// A mint's token program is whatever owns its account — SPL or Token-2022.
// Nothing in the runtime should hardcode one; pump's createV2 mints t22, but older
// coins are SPL and must be traded with Tokenkeg.
import { PublicKey } from '@solana/web3.js';
export const SPL = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const T22 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export async function tokenProgramOf(conn, mint) {
  const info = await conn.getAccountInfo(new PublicKey(mint));
  if (!info) return T22;
  return new PublicKey(info.owner);
}
