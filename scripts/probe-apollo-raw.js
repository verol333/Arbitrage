#!/usr/bin/env node
// PROBE APOLLO RAW — pour 1-2 matchs Apollo, dump la structure BRUTE de la
// reponse /match/offers pour voir exactement ce qu'expose Apollo :
//   - m.BasicOffer : le 1X2 principal (toujours present)
//   - m.Offers : les OTHER markets (Total, Handicap, BTTS, HT/H2, corners, etc.)
// Le parseur actuel prend UNIQUEMENT m.Offers si non-vide, SINON m.BasicOffer.
// Ca produit 8 cles quand Offers est vide (basic only).
//
// Objectif : comprendre pourquoi Offers est souvent vide et voir si un endpoint
// alternatif ou parametre existe pour recuperer TOUS les markets.
import { apolloGet } from '../src/bookmakers/apollo/api.js';
import { listMatches } from '../src/bookmakers/apollo/list.js';

console.log('▶ PROBE APOLLO RAW\n');

const list = await listMatches({ live: false, sport: 'football' });
console.log(`Apollo catalog football = ${list.length} matchs\n`);

// Prendre les 3 premiers matchs
const sample = list.slice(0, 3);
for (const m of sample) {
  console.log(`══ Match : ${m.home} vs ${m.away} (id=${m.id}) ══`);
  const res = await apolloGet(`/sport/offer/v3/match/offers?MatchId=${m.id}`);
  if (!res) { console.log('  ❌ empty response'); continue; }
  console.log(`  Top-level keys : ${Object.keys(res).join(', ')}`);
  console.log(`  BasicOffer present : ${!!res.BasicOffer} (${res.BasicOffer ? Object.keys(res.BasicOffer).length + ' fields' : 'null'})`);
  console.log(`  Offers array length : ${res.Offers ? res.Offers.length : 'null'}`);
  if (res.BasicOffer) {
    console.log(`    BasicOffer.BetTypeKey=${res.BasicOffer.BetTypeKey} BetTypeName=${res.BasicOffer.BetTypeName || '?'}`);
    console.log(`    BasicOffer.Odds count = ${(res.BasicOffer.Odds || []).length}`);
  }
  if (res.Offers && res.Offers.length) {
    console.log(`  Offers detail :`);
    const byKey = {};
    for (const o of res.Offers) {
      const key = String(o.BetTypeKey);
      if (!byKey[key]) byKey[key] = { name: o.BetTypeName || '?', count: 0, sbvs: new Set() };
      byKey[key].count++;
      if (o.Sbv != null) byKey[key].sbvs.add(o.Sbv);
    }
    for (const [k, v] of Object.entries(byKey).sort()) {
      const sbvs = v.sbvs.size ? ` sbvs=[${[...v.sbvs].join(',')}]` : '';
      console.log(`    BetTypeKey=${k.padEnd(5)} "${v.name}" ×${v.count}${sbvs}`);
    }
  }
  // Aussi essayer un endpoint alternatif pour voir si plus de markets sont dispo
  console.log(`\n  ── Test endpoint /sport/offer/v3/match/${m.id} :`);
  const alt = await apolloGet(`/sport/offer/v3/match/${m.id}`);
  if (alt) {
    console.log(`     top keys : ${Object.keys(alt).join(', ')}`);
    if (alt.BetOffers) console.log(`     BetOffers length : ${alt.BetOffers.length}`);
    if (alt.Categories) console.log(`     Categories length : ${alt.Categories.length}`);
    if (alt.MatchOffers) console.log(`     MatchOffers length : ${alt.MatchOffers.length}`);
  } else {
    console.log(`     null / 404`);
  }
  console.log('');
}
process.exit(0);
