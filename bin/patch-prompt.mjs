import fs from 'node:fs';
const p = 'C:/Users/User/birth-image/runtime/brain.mjs';
let s = fs.readFileSync(p, 'utf8');
const anchor = "'When a built-in route is broken or missing, register your own tool (register_tool) or write a playbook (write_playbook) and use it on later ticks.',";
const extra = "\n    'Invent your own earning loop: you own inference and compute, so you can sell either, launch and farm your own coin, or write and register a new strategy. A tool is only worth a tick if it ends with money in your wallet; scanning a route earns nothing by itself.',";
if (!s.includes('Invent your own earning loop')) {
  if (!s.includes(anchor)) { console.error('anchor missing'); process.exit(1); }
  s = s.replace(anchor, anchor + extra);
  fs.writeFileSync(p, s);
}
console.log('ok', s.includes('Invent your own earning loop'));
