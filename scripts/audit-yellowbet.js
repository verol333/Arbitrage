#!/usr/bin/env node
// AUDIT YellowBet : list + dump market names per sport.
// YB structure : ev.bts[] = array de marches, chaque marche = { id, n (name), odds[] }.
// Le parseur mappe sur mkt.n (name FR/EN mix). Un name inconnu = trou.
import yb from '../src/bookmakers/yellowbet/index.js';
import { fetchMatchBts, evapi } from '../src/bookmakers/yellowbet/api.js';
import { yellowbetFlatOdds, yellowbetBasketFlatOdds } from '../src/bookmakers/yellowbet/parse.js';
import { listPrematch } from '../src/bookmakers/yellowbet/list.js';

const SPORTS = ['football','basket','tennis'];  // Hockey NOT in YB catalog

const KNOWN_NAMES = new Set([
  'FT 1X2','Double Chance','GG/NG','Under/Over','HT 1X2','HT Double Chance','HT GG/NG','HT U/O',
  '2nd Half : 1X2','2nd Half : Double Chance','2nd Half : GG/NG','2nd Half : Totals','2nd Half : Odd/Even goals',
  'Draw No Bet','Odd/Even goals','HT Odd/Even goals','Corners U/O','Corners Under/Over','HT Corners U/O','HT Corners Under/Over',
]);

function sanity2(o, k1, k2) {
  const a=o[k1], b=o[k2];
  if (!a||!b) return '-';
  return `${a.toFixed(2)}+${b.toFixed(2)}→inv=${(1/a+1/b).toFixed(3)}`;
}

console.log('▶ AUDIT YellowBet\n');

for (const sport of SPORTS) {
  console.log(`\n═══════════════════ ${sport.toUpperCase()} ═══════════════════`);
  let matches;
  try {
    // Force listing via listPrematch (bypass restriction sport dans index.js)
    matches = await listPrematch(72, sport);
  } catch (e) { console.log(`  listMatches err=${e.message}`); continue; }
  console.log(`  Matchs listes : ${matches.length}`);
  if (!matches.length) { console.log('  ⚠ 0 matchs — sport probablement non dispo YB'); continue; }
  console.log(`  Samples : ${matches.slice(0,3).map(m=>`${m.home} vs ${m.away}`).join(' | ')}`);

  for (const s of matches.slice(0, 2)) {
    console.log(`\n  ── ${s.home} vs ${s.away} (id=${s.id}) ──`);
    let bts = s.__raw?.bts;
    if (!bts || !bts.length) {
      bts = await fetchMatchBts(s.id);
    }
    if (!bts || !bts.length) { console.log('    ⚠ no bts'); continue; }
    console.log(`    ${bts.length} marches raw`);
    const names = new Set();
    for (const m of bts) names.add(m.n || '');
    const known = [...names].filter(n => KNOWN_NAMES.has(n));
    const unknown = [...names].filter(n => !KNOWN_NAMES.has(n));
    console.log(`    Marches CONNUS : ${known.length}`);
    console.log(`    Marches INCONNUS : ${unknown.length}`);
    for (const n of unknown.slice(0, 40)) console.log(`      "${n}"`);
    // Parse
    const parser = sport === 'basket' ? yellowbetBasketFlatOdds : yellowbetFlatOdds;
    const parsed = parser(bts);
    const keys = Object.keys(parsed).filter(k => k !== '_ids');
    console.log(`    ► parseur emit ${keys.length} keys plates`);
    if (parsed.match_1 && parsed.match_2) console.log(`      match_1/2: ${sanity2(parsed, 'match_1', 'match_2')}`);
    if (parsed.match_X) console.log(`      match_X  : ${parsed.match_X}`);
    const hcpLines = [...new Set(keys.filter(k=>k.startsWith('hcp_home_')).map(k=>k.replace('hcp_home_','')))].slice(0,2);
    for (const l of hcpLines) {
      const h = parsed[`hcp_home_${l}`], a = parsed[`hcp_away_${-Number(l)}`];
      if (h && a) console.log(`      hcp L=${l}: ${sanity2(parsed, `hcp_home_${l}`, `hcp_away_${-Number(l)}`)}`);
    }
  }
}

console.log('\n═══ FIN AUDIT YellowBet ═══');
process.exit(0);
