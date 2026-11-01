// Signer client. The coordinator never sees a private key: it sends an operation,
// the signer validates it against the fixed policy and returns a signature.
import fs from 'node:fs';
import net from 'node:net';
import { P } from './paths.mjs';

export function signerToken() { return fs.readFileSync(P.run + '/signer.token', 'utf8').trim(); }

export function request(op, args = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const port = Number(fs.readFileSync(P.signerPort, 'utf8').trim());
    const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
      sock.write(JSON.stringify({ token: signerToken(), op, args }) + '\n');
    });
    let buf = '';
    const t = setTimeout(() => { sock.destroy(); reject(new Error(`signer timeout: ${op}`)); }, timeoutMs);
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl >= 0) {
        clearTimeout(t);
        const line = buf.slice(0, nl);
        sock.end();
        try {
          const j = JSON.parse(line);
          if (j.error) reject(new Error(`signer: ${j.error}`)); else resolve(j.result);
        } catch (e) { reject(e); }
      }
    });
    sock.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

export const identity = () => request('identity');
export const signMessage = (message) => request('sign_message', { message });
export const signV1 = (args) => request('sign_v1', args);
export const signEvmTyped = (args) => request('sign_evm_typed', args);
export const signTx = (wireBase64) => request('sign_tx', { wireBase64 }, 60000);
export const signEvmHash = (hashHex) => request('sign_evm_hash', { hashHex }, 30000);
