#!/usr/bin/env node
// AUDIT Apollo (SportsOfferApi SBS) : dump BetTypeKeys inconnus par sport.
import ap from '../src/bookmakers/apollo/index.js';
import { fetchOffers } from '../src/bookmakers/apollo/list.js';
import { apolloFlatOdds } from '../src/bookmakers/apollo/parse.js';
import { readFileSync } from 'fs';

const SPORTS = ['football','tennis','basket','hockey'];

// Extraire BetTypeKeys mappes dynamiquement du parseur
const parseSrc = readFileSync('src/bookmakers/apollo/parse.js', 'utf8');
const KNOWN = new Set(
  (parseSrc.match(/eachOdd\(offers,\s*(\d+)/g) || []).map(m => parseInt(m.replace(/eachOdd\(offers,\s*/, ''), 10))
);
console.log(`▶ AUDIT Apollo — ${KNOWN.size} BetTypeKeys connus\n`);

function sanity2(o, k1, k2) {
  const a=o[k1], b=o[k2];
  if (!a||!b) return '-';
  return `${a.toFixed(2)}+${b.toFixed(2)}→inv=${(1/a+1/b).toFixed(3)}`;
}

for (const sport of SPORTS) {
  console.log(`\n═══════════════════ ${sport.toUpperCase()} ═══════════════════`);
  let matches;
  try { matches = await ap.listMatches({ sport, horizonHours: 48 }); }
  catch (e) { console.log(`  listMatches err=${e.message}`); continue; }
  console.log(`  Matchs listes : ${matches.length}`);
  if (!matches.length) { console.log('  ⚠ 0 matchs'); continue; }
  console.log(`  Samples : ${matches.slice(0,3).map(m=>`${m.home} vs ${m.away}`).join(' | ')}`);

  const samples = matches.slice(0, 2);
  const offersMap = await fetchOffers(samples.map(m => m.id));
  for (const s of samples) {
    console.log(`\n  ── ${s.home} vs ${s.away} (id=${s.id}) ──`);
    const offers = offersMap.get(s.id) || [];
    console.log(`    ${offers.length} offers raw`);
    const byKey = new Map();
    for (const o of offers) {
      const k = Number(o.BetTypeKey);
      if (!byKey.has(k)) byKey.set(k, { name: o.BetTypeName || '?', count: 0, sample: o });
      byKey.get(k).count++;
    }
    const known_p = [...byKey.keys()].filter(k => KNOWN.has(k));
    const unknown_p = [...byKey.keys()].filter(k => !KNOWN.has(k));
    console.log(`    BetTypeKeys distincts : ${byKey.size}`);
    console.log(`    MAPPES : ${known_p.length}`);
    console.log(`    INCONNUS : ${unknown_p.length}`);
    for (const k of unknown_p.slice(0, 20).sort((a,b) => a-b)) {
      const info = byKey.get(k);
      const sample = info.sample;
      const odds = (sample.Odds || []).slice(0, 4).map(od => `"${od.Name || ''}"[${od.Type || ''}]=${od.Odd}`).join(' | ');
      const sbv = sample.Sbv !== undefined ? ` sbv=${sample.Sbv}` : '';
      console.log(`      NEW BetTypeKey=${k} nOffers=${info.count} name="${info.name}"${sbv}`);
      if (odds) console.log(`        row0: ${odds}`);
    }
    // Parse
    const parsed = apolloFlatOdds(offers, { sport });
    const keys = Object.keys(parsed).filter(k => k !== '_ids');
    console.log(`    ► parseur emit ${keys.length} keys plates`);
    if (parsed.match_1 && parsed.match_2) console.log(`      match_1/2: ${sanity2(parsed, 'match_1', 'match_2')}`);
    if (parsed.match_X) console.log(`      match_X  : ${parsed.match_X}`);
    const hcpLines = [...new Set(keys.filter(k=>k.startsWith('hcp_home_')).map(k=>k.replace('hcp_home_','')))].slice(0,3);
    for (const l of hcpLines) {
      const h = parsed[`hcp_home_${l}`], a = parsed[`hcp_away_${-Number(l)}`];
      if (h && a) console.log(`      hcp L=${l}: ${sanity2(parsed, `hcp_home_${l}`, `hcp_away_${-Number(l)}`)}`);
    }
  }
}

console.log('\n═══ FIN AUDIT Apollo ═══');
process.exit(0);
