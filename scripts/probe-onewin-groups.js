#!/usr/bin/env node
// Probe 1win : lister TOUS les groupNames retournes par le WS pour identifier
// les groupes non parses par winFlatOdds

import { listPrematch } from '../src/bookmakers/onewin/list.js';
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';
import { winFlatOdds } from '../src/bookmakers/onewin/parse.js';

const matches = await listPrematch('football');
console.log(`${matches.length} matchs foot`);
if (!matches.length) process.exit(0);

// prendre 3 matchs et dumper tous groupNames
const sample = matches.slice(0, 3);
console.log(`\nProbe sur : ${sample.map(m => `${m.home} vs ${m.away}`).join(' | ')}\n`);

const raw = await fetchOddsWS(sample.map(m => m.id));
console.log(`raw map size: ${raw.size}\n`);

for (const m of sample) {
  const g = raw.get(m.id) || raw.get(String(m.id)) || raw.get(Number(m.id));
  if (!g) { console.log(`${m.home} vs ${m.away}: no data`); continue; }
  const names = Object.keys(g);
  console.log(`\n=== ${m.home} vs ${m.away} ===`);
  console.log(`  ${names.length} groupes total`);
  console.log(`  groupes: ${names.slice(0, 30).join(' | ')}`);
  const flat = winFlatOdds(g, { home: m.home, away: m.away });
  const keys = Object.keys(flat);
  console.log(`  ${keys.length} cotes plates parsees`);
  console.log(`  cles: ${keys.slice(0, 30).join(', ')}`);

  // Identifier groupes NON parses
  const parsed = new Set();
  for (const n of names) {
    const low = n.toLowerCase().trim();
    if (['full time result (regular time)', 'full time result', 'result', 'match winner'].includes(low)) parsed.add(n);
    else if (['double chance (regular time)', 'double chance'].includes(low)) parsed.add(n);
    else if (low === 'both teams to score') parsed.add(n);
    else if (low.includes('draw no bet')) parsed.add(n);
    else if (low === 'total') parsed.add(n);
    else if (/\btotal$/.test(low)) parsed.add(n);
    else if (/handicap/.test(low)) parsed.add(n);
    else if (/odd\/even|even\/odd/.test(low)) parsed.add(n);
    else if (/1st half|1h|2nd half|2h/.test(low)) parsed.add(n);
  }
  const unparsed = names.filter(n => !parsed.has(n));
  console.log(`  ${unparsed.length} groupes NON parses:`);
  unparsed.slice(0, 30).forEach(n => console.log(`    - ${n}`));
}
