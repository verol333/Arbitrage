#!/usr/bin/env node
// PROBE 1WIN FOOT KEYS — pourquoi 1win contribue 0 opps foot malgre 427 cotes.
// Dump les cles produites par winFlatOdds vs xbetOdds sur 3 matchs communs.
import { listPrematch } from '../src/bookmakers/onewin/list.js';
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';
import { winFlatOdds } from '../src/bookmakers/onewin/parse.js';
import xbet from '../src/bookmakers/xbet/index.js';
import { teamSim } from '../src/core/text.js';
const matchTeams = (h1, a1, h2, a2) => (teamSim(h1, h2) + teamSim(a1, a2)) / 2;

console.log('▶ PROBE 1WIN FOOT KEYS\n');

const win = await listPrematch('football');
console.log(`1win catalog football = ${win.length} matchs\n`);

const xbetList = await xbet.listMatches({ live: false, horizonHours: 24, sport: 'football' });
console.log(`xbet catalog football = ${xbetList.length} matchs\n`);

const commons = [];
for (const m of win.slice(0, 200)) {
  for (const x of xbetList) {
    if (commons.length >= 3) break;
    const sim = matchTeams(m.home, m.away, x.home, x.away);
    if (sim >= 0.75) { commons.push({ w: m, xb: x, sim }); break; }
  }
  if (commons.length >= 3) break;
}
console.log(`Matchs communs 1win↔xbet : ${commons.length}\n`);

if (!commons.length) { console.log('❌ aucun match commun — impossible d\'auditer'); process.exit(0); }

const winIds = commons.map(c => c.w.id);
const groupsMap = await fetchOddsWS(winIds);
console.log(`WS 1win returned ${groupsMap.size} matchs\n`);

for (const { w, xb, sim } of commons) {
  console.log(`══ ${w.home} vs ${w.away} (1win id=${w.id}) ↔ ${xb.home} vs ${xb.away} (xbet id=${xb.id}) sim=${sim.toFixed(2)} ══`);
  const groups = groupsMap.get(w.id) || groupsMap.get(String(w.id)) || groupsMap.get(Number(w.id));
  if (!groups) { console.log('  ❌ pas de groups WS 1win'); continue; }
  const winOdds = winFlatOdds(groups, { home: w.home, away: w.away });
  const xbOdds = await xbet.getOdds(xb, { live: false });
  const winKeys = Object.keys(winOdds).sort();
  const xbKeys = Object.keys(xbOdds || {}).sort();
  const inter = winKeys.filter(k => xbKeys.includes(k));
  console.log(`  1win : ${winKeys.length} cles`);
  console.log(`  xb   : ${xbKeys.length} cles`);
  console.log(`  ∩    : ${inter.length} cles communes`);
  if (inter.length) {
    console.log(`     Communes : ${inter.slice(0, 15).join(', ')}${inter.length > 15 ? ' ...' : ''}`);
    for (const k of inter.slice(0, 10)) console.log(`       ${k.padEnd(30)} 1win=${winOdds[k]} xb=${xbOdds[k]}`);
  }
  const winOnly = winKeys.filter(k => !xbKeys.includes(k));
  const xbOnly = xbKeys.filter(k => !winKeys.includes(k));
  console.log(`  1win only : ${winOnly.length} cles`);
  if (winOnly.length) console.log(`     ${winOnly.slice(0, 15).join(', ')}${winOnly.length > 15 ? ' ...' : ''}`);
  console.log(`  xb only   : ${xbOnly.length} cles`);
  if (xbOnly.length) console.log(`     ${xbOnly.slice(0, 15).join(', ')}${xbOnly.length > 15 ? ' ...' : ''}`);
  console.log('');
}
process.exit(0);
