#!/usr/bin/env node
// PROBE 1xBET BASKET RAW — dumpe la structure BRUTE de GetGameZip pour un
// match basket 1xBet, avec tous les groupes G, tous les items E, leurs T/C/P.
// Objectif : ré-identifier les vrais T-codes pour Q1/Q2 winner 2-way.
//
// Usage :
//   MATCH_ID=742286023 node scripts/probe-xbet-basket-raw.js
// Sans MATCH_ID : liste 5 matchs basket live et fetch le premier.
import { FEED, COUNTRY, viaWorker } from '../src/bookmakers/xbet/api.js';

const MATCH_ID = process.env.MATCH_ID;
const url = `${FEED}/service-api/LineFeed/GetGameZip?id=${MATCH_ID}&lng=fr&isSubGames=true&GroupEvents=true&countevents=2000&grMode=4&country=${COUNTRY}&marketType=1&isNewBuilder=true`;

if (!MATCH_ID) {
  console.error('MATCH_ID requis (ex: MATCH_ID=742286023)');
  process.exit(1);
}

console.log(`▶ PROBE 1xBET BASKET RAW — matchId=${MATCH_ID}\n`);
const gd = await viaWorker(url, { noCache: true });
if (!gd?.Value) {
  console.log('❌ Reponse vide ou invalide');
  process.exit(1);
}

const teams = `${gd.Value.O1 || '?'} vs ${gd.Value.O2 || '?'}`;
console.log(`Match : ${teams}  league=${gd.Value.L || '?'}\n`);

const GE = gd.Value.GE || [];
console.log(`Total groupes GE : ${GE.length}\n`);

// Dump chaque groupe : nom, N outcomes, tous les items T/C/P
for (const g of GE) {
  const gid = g.G;
  const gname = g.GN || '(sans nom)';
  const items = [];
  if (Array.isArray(g.E)) {
    for (const sub of g.E) {
      for (const it of (Array.isArray(sub) ? sub : [sub])) {
        if (it?.C != null) items.push({ T: it.T, C: it.C, P: it.P });
      }
    }
  }
  // Filtre : garde surtout G=91,92,93,94 (Q1-Q4) + G=1,101 (Winner) + G=17 (Total)
  //          + G=2 (Handicap). Pour audit complet, on print aussi les autres.
  const highlight = [1, 2, 17, 91, 92, 93, 94, 101, 15, 62, 60, 83, 68, 66].includes(gid) ? '🎯' : '  ';
  console.log(`${highlight} G=${String(gid).padStart(4)} ${gname.padEnd(35)} (${items.length} outcomes)`);
  for (const it of items) {
    console.log(`      T=${String(it.T).padStart(5)}  C=${String(it.C).padStart(7)}  P=${it.P ?? ''}`);
  }
}

console.log(`\n✅ Fin dump. Chercher G=91,92,93,94 pour identifier les vrais T de Q1/Q2/Q3/Q4 Winner 2-way.`);
console.log(`   Un vrai Winner 2-way a exactement 2 outcomes avec des cotes DIFFERENTES (Home/Away).`);
process.exit(0);
