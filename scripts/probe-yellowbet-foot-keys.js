#!/usr/bin/env node
// PROBE YELLOWBET FOOT — pourquoi 0 opps malgre 290+ cotes lues.
// Dump les cles produites par le parseur YB vs 1xBet sur 3 matchs communs.
// Objectif : identifier le mismatch de convention qui empeche la comparaison.
import { listPrematch as ybList } from '../src/bookmakers/yellowbet/list.js';
import { yellowbetFlatOdds } from '../src/bookmakers/yellowbet/parse.js';
import xbet from '../src/bookmakers/xbet/index.js';
import { teamSim } from '../src/core/text.js';
const matchTeams = (h1, a1, h2, a2) => (teamSim(h1, h2) + teamSim(a1, a2)) / 2;

console.log('▶ PROBE YELLOWBET FOOT KEYS\n');

const yb = await ybList(24, 'football');
console.log(`YB catalog football = ${yb.length} matchs (horizon 24h)\n`);

// Fetch xbet list pour identifier des matchs communs
const xbetList = await xbet.listMatches({ live: false, horizonHours: 24, sport: 'football' });
console.log(`xbet catalog football = ${xbetList.length} matchs\n`);

// Trouver 3 matchs communs (matching Jaro-Winkler)
const commons = [];
for (const m of yb.slice(0, 200)) {
  for (const x of xbetList) {
    if (commons.length >= 3) break;
    const sim = matchTeams(m.home, m.away, x.home, x.away);
    if (sim >= 0.75) {
      commons.push({ yb: m, xb: x, sim });
      break;
    }
  }
  if (commons.length >= 3) break;
}

console.log(`Matchs communs YB↔xbet : ${commons.length}\n`);
for (const { yb: m, xb: x, sim } of commons) {
  console.log(`══ ${m.home} vs ${m.away} (YB id=${m.id}) ↔ ${x.home} vs ${x.away} (xbet id=${x.id}) sim=${sim.toFixed(2)} ══`);
  const ybOdds = yellowbetFlatOdds(m.__raw?.bts || [], { live: false });
  const xbOdds = await xbet.getOdds(x, { live: false });
  const ybKeys = Object.keys(ybOdds).sort();
  const xbKeys = Object.keys(xbOdds || {}).sort();
  console.log(`  YB : ${ybKeys.length} cles`);
  console.log(`  xb : ${xbKeys.length} cles`);
  // Intersection
  const inter = ybKeys.filter(k => xbKeys.includes(k));
  console.log(`  ∩  : ${inter.length} cles communes`);
  if (inter.length) {
    console.log(`     Communes : ${inter.slice(0, 15).join(', ')}${inter.length > 15 ? ' ...' : ''}`);
    console.log(`     Exemple valeurs :`);
    for (const k of inter.slice(0, 8)) {
      console.log(`       ${k.padEnd(30)} YB=${ybOdds[k]} xb=${xbOdds[k]}`);
    }
  } else {
    console.log(`     ❌ AUCUNE cle commune !`);
    console.log(`     YB (15 premieres)  : ${ybKeys.slice(0, 15).join(', ')}`);
    console.log(`     xb (15 premieres)  : ${xbKeys.slice(0, 15).join(', ')}`);
  }
  // Diff : cles dans YB mais pas xb (potentiel bug convention)
  const ybOnly = ybKeys.filter(k => !xbKeys.includes(k));
  const xbOnly = xbKeys.filter(k => !ybKeys.includes(k));
  console.log(`  YB only : ${ybOnly.length} cles`);
  if (ybOnly.length) console.log(`     ${ybOnly.slice(0, 10).join(', ')}${ybOnly.length > 10 ? ' ...' : ''}`);
  console.log(`  xb only : ${xbOnly.length} cles`);
  if (xbOnly.length) console.log(`     ${xbOnly.slice(0, 10).join(', ')}${xbOnly.length > 10 ? ' ...' : ''}`);
  console.log('');
}
process.exit(0);
