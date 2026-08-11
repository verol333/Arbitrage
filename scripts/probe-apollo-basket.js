#!/usr/bin/env node
// PROBE Apollo basket raw — dump BetTypeKeys utilises sur 2 samples WNBA.
import { bookmakers } from '../src/bookmakers/index.js';
import { fetchOffers } from '../src/bookmakers/apollo/list.js';

const apollo = bookmakers.find((b) => b.key === 'apollo');
const matches = await apollo.listMatches({ sport: 'basket' });
console.log(`▶ Apollo basket : ${matches.length} matchs\n`);
const samples = matches.slice(0, 3);
const map = await fetchOffers(samples.map((m) => m.id));

for (const s of samples) {
  const offers = map.get(s.id) || [];
  console.log(`\n══ ${s.home} vs ${s.away}  [${s.league}]  offers=${offers.length}`);
  const byKey = {};
  for (const o of offers) {
    const k = String(o.BetTypeKey);
    if (!byKey[k]) byKey[k] = { name: o.BetTypeName || '?', sbvs: new Set(), samples: [] };
    if (o.Sbv) byKey[k].sbvs.add(o.Sbv);
    if (byKey[k].samples.length < 2) {
      const odds = (o.Odds || []).slice(0, 6).map((od) => `"${od.Name || ''}"[${od.Type || ''}]=${od.Odd}`);
      byKey[k].samples.push({ sbv: o.Sbv, odds });
    }
  }
  console.log(`  ${Object.keys(byKey).length} BetTypeKeys distincts :`);
  for (const [k, v] of Object.entries(byKey).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const sbvsStr = v.sbvs.size ? ` sbvs=[${[...v.sbvs].slice(0, 5).join(',')}]` : '';
    console.log(`    BetTypeKey=${k}  "${v.name}"  (${v.samples.length} offers)${sbvsStr}`);
    for (const sm of v.samples) console.log(`       sbv=${sm.sbv ?? '-'}  ${sm.odds.join(' | ')}`);
  }
}
console.log('\n═══ FIN ═══');
process.exit(0);
