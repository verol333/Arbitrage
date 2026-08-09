#!/usr/bin/env node
// PROBE YellowBet BASKET — dump complet des marches d'un match basket YB
// pour identifier le nom exact des marches Handicap (et voir si notre
// parseur les rate).
//
// Sortie : liste TOUS les bts avec nom, id, count odds, et pour chaque
// odd le n/l/p pour comprendre la structure de la ligne (est-ce integer,
// demi-ligne, ou embedded dans le nom ?).

import { evapi, BASE_URL, fetchMatchBts } from '../src/bookmakers/yellowbet/api.js';
import { listPrematch } from '../src/bookmakers/yellowbet/list.js';

console.log('▶ PROBE YELLOWBET BASKET MARKETS\n');

const list = await listPrematch(168, 'basket');
console.log(`Basket matchs listes : ${list.length}\n`);
if (!list.length) {
  console.log('❌ Pas de match basket dispo (403 CF ?). Abandon.');
  process.exit(0);
}

// Prend les 3 premiers matchs
for (const m of list.slice(0, 3)) {
  console.log(`══════════════════════════════════════════════════════════════`);
  console.log(`MATCH id=${m.id} : ${m.home} vs ${m.away}`);
  console.log(`  league: ${m.league}`);
  console.log(`  start: ${m.start ? new Date(m.start).toISOString() : 'null'}`);

  // Fetch full details
  const bts = await fetchMatchBts(m.id);
  console.log(`  bts count : ${bts.length}\n`);

  // Dump ALL bt names
  for (const b of bts) {
    const oddCount = (b.odds || []).length;
    console.log(`  [bt id=${b.id}] "${b.n}" (${oddCount} odds)`);
    // Show first 8 odds with full structure
    for (const o of (b.odds || []).slice(0, 12)) {
      const parts = [];
      if (o.n != null) parts.push(`n="${o.n}"`);
      if (o.l != null) parts.push(`l=${o.l}`);
      if (o.sp != null) parts.push(`sp=${o.sp}`);
      if (o.hc != null) parts.push(`hc=${o.hc}`);
      if (o.p != null) parts.push(`p=${o.p}`);
      if (o.id != null) parts.push(`id=${o.id}`);
      console.log(`      ${parts.join(' | ')}`);
    }
    if (oddCount > 12) console.log(`      ... +${oddCount - 12} more`);
  }
  console.log('');

  // Identifier tous les bts dont le nom contient handicap-like
  const hcpBts = bts.filter((b) => /handicap|spread|ecart|difference|marge/i.test(String(b?.n || '')));
  console.log(`  ➜ bts nom-like Handicap : ${hcpBts.length}`);
  for (const b of hcpBts) {
    console.log(`     [${b.id}] "${b.n}" — odds sample:`);
    for (const o of (b.odds || []).slice(0, 6)) {
      console.log(`         ${JSON.stringify(o)}`);
    }
  }
  console.log('');
}

console.log('▶ Fin.');
process.exit(0);
