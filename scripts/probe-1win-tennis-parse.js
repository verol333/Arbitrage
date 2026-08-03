#!/usr/bin/env node
// Verifie que le NOUVEAU parseur tennis 1win produit bien les cles canoniques
// attendues (match_1/2, hcp_home/away_X, match_over/under_X, sN_*, tt_*)
// sur 3 matchs tennis reels.
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';
import { listPrematch } from '../src/bookmakers/onewin/list.js';
import { winTennisFlatOdds } from '../src/bookmakers/onewin/parse.js';

console.log('▶▶▶ Test parseur tennis 1win');
const matches = await listPrematch('tennis');
console.log(`${matches.length} matchs tennis`);
const sample = matches.slice(0, 3);
const map = await fetchOddsWS(sample.map(m => m.id));
for (const m of sample) {
  const groups = map.get(m.id) || map.get(String(m.id));
  if (!groups) { console.log(`\n${m.home} vs ${m.away} : PAS DE GROUPS`); continue; }
  const flat = winTennisFlatOdds(groups, { home: m.home, away: m.away });
  console.log(`\n═══ ${m.home} vs ${m.away} ═══`);
  console.log(`  ${Object.keys(flat).length} cles parsees`);
  const keys = Object.keys(flat).sort();
  for (const k of keys) console.log(`    ${k.padEnd(28)} = ${flat[k]}`);
}
console.log('\n═══ FIN ═══');
