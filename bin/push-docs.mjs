// Push docs/coins (and any other docs assets) to GitHub in one commit via the git data API.
// Contents API would need one call per file; blobs+tree does it in a single commit.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = 'staccDOTsol/birth-image-runtime';
const gh = (args, input) => execFileSync('gh', ['api', ...args], { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
const ghJson = (p, method = 'GET', body) => JSON.parse(gh(['-X', method, p, ...(body ? ['--input', '-'] : [])], body ? JSON.stringify(body) : undefined));

const root = 'docs/coins';
const files = fs.readdirSync(root).filter((f) => f.endsWith('.json') || f.endsWith('.svg'));
console.log('files', files.length);

const ref = ghJson(`repos/${REPO}/git/ref/heads/main`);
const baseSha = ref.object.sha;
const baseCommit = ghJson(`repos/${REPO}/git/commits/${baseSha}`);

const entries = [];
for (const f of files) {
  const content = fs.readFileSync(path.join(root, f));
  const blob = ghJson(`repos/${REPO}/git/blobs`, 'POST', { content: content.toString('base64'), encoding: 'base64' });
  entries.push({ path: `${root}/${f}`, mode: '100644', type: 'blob', sha: blob.sha });
  if (entries.length % 40 === 0) console.log('blobs', entries.length);
}
const tree = ghJson(`repos/${REPO}/git/trees`, 'POST', { base_tree: baseCommit.tree.sha, tree: entries });
const commit = ghJson(`repos/${REPO}/git/commits`, 'POST', { message: `coins: ${files.length} metadata + artwork files`, tree: tree.sha, parents: [baseSha] });
ghJson(`repos/${REPO}/git/refs/heads/main`, 'PATCH', { sha: commit.sha, force: false });
console.log(JSON.stringify({ commit: commit.sha, files: files.length }));
