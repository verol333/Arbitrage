// Diag YellowBet : dump les noms de marchés RÉELS en live football
// Objectif : identifier pourquoi Plus 3.5 est lu à 1.91 au lieu de 1.19.
import { evapi } from '../src/bookmakers/yellowbet/api.js';

// Un match live foot : chercher via GetEvents
const url = 'https://yellowbet.cg/services/evapi/event/GetEvents?isLive=true&count=500&take=500';
const data = await evapi(url);
const events = (data?.data || []).filter((e) => e.sid === 31 && e.bts && e.bts.length);

console.log(`=== YELLOWBET LIVE FOOTBALL ===`);
console.log(`Total live football events: ${events.length}`);
if (events.length) {
  const ev = events[0];
  console.log(`\nSample event: ${ev.h} vs ${ev.a} (id=${ev.id}, score=${ev.hs}-${ev.as} min=${ev.mm ?? ev.t ?? '?'})`);
  console.log(`Total bts markets: ${ev.bts.length}`);
  console.log(`\n=== ALL MARKET NAMES ===`);
  for (const bt of ev.bts) {
    const nOdds = (bt.odds || []).length;
    const oddsSample = (bt.odds || []).slice(0, 4).map((o) => `${o.n || o.id}=${o.p}${o.l != null ? ` (l=${o.l})` : ''}${o.sp != null ? ` (sp=${o.sp})` : ''}`);
    console.log(`- "${bt.n}" (${nOdds} odds): ${oddsSample.join(', ')}`);
  }
  // Grep specific: markets containing "over/under/plus/moins/total"
  console.log(`\n=== TOTAL/OVER-UNDER MARKETS ONLY ===`);
  for (const bt of ev.bts) {
    if (!/plus|moins|over|under|total|/.test((bt.n || '').toLowerCase())) continue;
    console.log(`> "${bt.n}"`);
    for (const o of bt.odds || []) {
      console.log(`    n=${o.n || o.id} p=${o.p} l=${o.l ?? o.sp ?? o.hc ?? '-'}`);
    }
  }
}
process.exit(0);
