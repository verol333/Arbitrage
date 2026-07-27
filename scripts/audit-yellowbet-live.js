#!/usr/bin/env node
// Audit YellowBet LIVE : dump les noms de marches REELS renvoyes en direct.
// L'user signale une cote 3.60 sur 'Total 2.5' YellowBet en 1ere mi-temps
// avec 2 buts deja marques — cote impossible pour un vrai Match Total 2.5
// Over. Hypothese : un marche HT/H2 est mal mappe comme Match.
import { evapi } from '../src/bookmakers/yellowbet/api.js';
import { yellowbetFlatOdds } from '../src/bookmakers/yellowbet/parse.js';

const url = 'https://yellowbet.cg/services/evapi/event/GetEvents?isLive=true&count=500&take=500';
const data = await evapi(url);
const events = (data?.data || []).filter((e) => e.sid === 31 && e.bts && e.bts.length);

console.log(`=== YELLOWBET LIVE FOOTBALL AUDIT ===`);
console.log(`Total live football events : ${events.length}`);
if (!events.length) { console.log('NO LIVE EVENTS'); process.exit(0); }

// Prendre les 2 matchs les plus riches
events.sort((a, b) => (b.bts?.length || 0) - (a.bts?.length || 0));
for (const ev of events.slice(0, 2)) {
  const score = `${ev.hs ?? '?'}-${ev.as ?? '?'}`;
  console.log(`\n\n╔══ ${ev.h} vs ${ev.a} | score=${score} min=${ev.mm ?? '?'} | ${ev.bts.length} markets ══╗`);
  console.log(`\n=== TOUS LES NOMS DE MARCHES ===`);
  for (const bt of ev.bts) {
    const nOdds = (bt.odds || []).length;
    const sample = (bt.odds || []).slice(0, 4).map((o) => {
      const line = o.l != null ? ` l=${o.l}` : (o.sp != null ? ` sp=${o.sp}` : '');
      return `${o.n || o.id}=${o.p}${line}`;
    });
    console.log(`- "${bt.n}" (${nOdds}): ${sample.join(' | ')}`);
  }
  const parsed = yellowbetFlatOdds(ev.bts, { home: ev.h, away: ev.a });
  console.log(`\n=== CLES PARSEES (${Object.keys(parsed).length}) ===`);
  const grouped = { match: [], ht: [], h2: [], tt: [], cor: [], other: [] };
  for (const [k, v] of Object.entries(parsed)) {
    if (k.startsWith('ht_')) grouped.ht.push(`${k}=${v}`);
    else if (k.startsWith('h2_')) grouped.h2.push(`${k}=${v}`);
    else if (k.startsWith('cor_')) grouped.cor.push(`${k}=${v}`);
    else if (k.startsWith('tt_')) grouped.tt.push(`${k}=${v}`);
    else if (k.startsWith('match_') || k === 'btts_yes' || k === 'btts_no' || k === 'dnb_1' || k === 'dnb_2') grouped.match.push(`${k}=${v}`);
    else grouped.other.push(`${k}=${v}`);
  }
  for (const [cat, list] of Object.entries(grouped)) {
    if (list.length) console.log(`  [${cat}] ${list.join(' | ')}`);
  }
}
process.exit(0);
