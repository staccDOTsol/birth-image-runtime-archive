// Memory playbook: lessons.jsonl is the agent's only long-term memory and it lives on a small
// box, so it has to be compacted rather than appended to forever.
// Keeps the newest N lessons, dedupes identical text, and folds repeated tags into counts.
import fs from 'node:fs';
import path from 'node:path';
import { P } from '../lib/paths.mjs';
import { log, now } from '../lib/util.mjs';

const MAX = Number(process.env.AGENT_LESSONS_MAX || 300);

export async function compactMemory() {
  const f = path.join(P.state, 'lessons.jsonl');
  if (!fs.existsSync(f)) return { kept: 0 };
  const rows = [];
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch {}
  }
  const byText = new Map();
  for (const r of rows) {
    const key = String(r.lesson || r.text || r.summary || JSON.stringify(r)).slice(0, 200).toLowerCase();
    const prev = byText.get(key);
    if (prev) { prev.count = (prev.count || 1) + 1; prev.last = Math.max(prev.last || 0, r.at || 0); }
    else byText.set(key, { ...r, count: r.count || 1, last: r.at || 0 });
  }
  const kept = [...byText.values()].sort((a, b) => (b.last || 0) - (a.last || 0)).slice(0, MAX);
  fs.writeFileSync(f, kept.map((r) => JSON.stringify(r)).join('\n') + '\n');
  log('memory', 'compacted', { before: rows.length, after: kept.length, at: now() });
  return { before: rows.length, kept: kept.length };
}

if (process.argv[1] && process.argv[1].endsWith('memory.mjs')) console.log(JSON.stringify(await compactMemory()));
