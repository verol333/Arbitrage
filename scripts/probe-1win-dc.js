#!/usr/bin/env node
// PROBE 1win DC — dump group names + outcome values pour tous les groupes
// qui matchent /double chance|dc/i sur 3 matchs foot.
//
// Objectif : identifier pourquoi coupon_data 1win DC est incomplet cote dev
// (74% legs sans _ids). Verifier :
//   - Group name reel (le parseur match "double chance" en strict)
//   - outcome values reelles (1x/x1/12/21/x2/2x ? autres formats ?)
//   - o.id present pour chaque odd DC

import { listPrematch } from '../src/bookmakers/onewin/list.js';
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';

console.log('▶ PROBE 1WIN DC — dump group names + outcomes\n');

const list = await listPrematch('football').catch((e) => { console.log('list err:', e.message); return []; });
console.log(`1win prematch foot : ${list.length} matchs\n`);
if (!list.length) { process.exit(0); }

// 3 matchs varies (top of list = kickoff imminent)
const sample = list.slice(0, 3);
const groupsMap = await fetchOddsWS(sample.map(m => m.id)).catch((e) => { console.log('ws err:', e.message); return new Map(); });
for (const m of sample) {
  console.log(`══════════════════════════════════════════════════════════════`);
  console.log(`MATCH ${m.id} : ${m.home} vs ${m.away} | ${m.league}`);
  const groups = groupsMap.get(m.id) || groupsMap.get(String(m.id)) || groupsMap.get(Number(m.id));
  if (!groups) { console.log('  groups=null\n'); continue; }
  const gnames = Object.keys(groups);
  console.log(`  Total groups : ${gnames.length}`);

  // Dump tous les groupes dont le nom ressemble a DC
  const dcGroups = gnames.filter((n) => /double chance|\bdc\b/i.test(n));
  console.log(`  Groupes DC-like : ${dcGroups.length}`);
  for (const gn of dcGroups) {
    const list = groups[gn] || [];
    console.log(`    ▸ "${gn}" (${list.length} odds) :`);
    for (const o of list.slice(0, 8)) {
      console.log(`         id=${o.id} outcome="${o.outcome}" name="${o.name}" cf=${o.cf} status=${o.status}`);
    }
  }

  // Aussi dump 1X2 pour comparaison (outcome format sur marches connus)
  const winnerGroups = gnames.filter((n) => /full time result|match winner|^result$/i.test(n));
  console.log(`  Groupes Winner-like : ${winnerGroups.length}`);
  for (const gn of winnerGroups) {
    const list = groups[gn] || [];
    console.log(`    ▸ "${gn}" :`);
    for (const o of list.slice(0, 4)) {
      console.log(`         id=${o.id} outcome="${o.outcome}" name="${o.name}" cf=${o.cf}`);
    }
  }
  console.log('');
}

console.log('▶ Fin.');
process.exit(0);
