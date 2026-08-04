#!/usr/bin/env node
// Dump BRUT des noms de groupes tennis chez 1win, pour reference.
// But : identifier les market group names tennis afin d'ecrire un parseur.
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';
import { listPrematch } from '../src/bookmakers/onewin/list.js';

console.log('▶▶▶ Dump groups tennis 1win (WS raw)');

const matches = await listPrematch('tennis');
console.log(`\n${matches.length} matchs tennis listes`);
if (!matches.length) process.exit(0);

// Prendre 2 matchs varies
const sample = matches.slice(0, 2);
console.log('\nSample matchs :');
for (const m of sample) console.log(`  id=${m.id} "${m.home}" vs "${m.away}" league="${m.league || '?'}" start=${m.start ? new Date(m.start).toISOString() : '?'}`);

const map = await fetchOddsWS(sample.map(m => m.id));
console.log(`\nWS retour : ${map.size} entrees`);

for (const m of sample) {
  const groups = map.get(m.id) || map.get(String(m.id));
  if (!groups) { console.log(`\n──── ${m.home} vs ${m.away} : PAS DE GROUPS ────`); continue; }
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`MATCH ${m.id} : ${m.home} vs ${m.away}`);
  console.log(`  ${Object.keys(groups).length} groups`);
  const keys = Object.keys(groups).sort();
  for (const gname of keys) {
    const list = groups[gname] || [];
    const active = list.filter(o => o?.status === 1 && Number(o.cf) > 1);
    if (!active.length) continue;
    console.log(`\n  "${gname}" (${active.length} outcomes actifs)`);
    for (const o of active.slice(0, 12)) {
      const p = JSON.stringify({ name: o.name, outcome: o.outcome, cf: o.cf });
      console.log(`      ${p}`);
    }
    if (active.length > 12) console.log(`      … +${active.length - 12} outcomes`);
  }
}

console.log('\n═══ FIN DUMP ═══');
