#!/usr/bin/env node
// AUDIT PremierBet (via Guineegames sports-api). Dumps marketIds inconnus.
import pb from '../src/bookmakers/premierbet/index.js';
import { mget } from '../src/bookmakers/premierbet/api.js';
import { premierbetFlatOdds } from '../src/bookmakers/premierbet/parse.js';

// Set marketIds deja mappes (extrait manuellement de parse.js).
const KNOWN = new Set([
  // Foot prematch
  '3','7','17','18','23','29','353','352','35','16','6','155','44','19','119','392','393','396','96','156','45','120','397','398','111','107','1852','1853','109','113','110',
  // Foot live
  '1','2','9','15','20','21','24','56','147','724','2509','2510',
  // Tennis
  '4','33','64','340',
  // Basket (dedupliqes)
  '25','26','49','354','355','356','357','362','363','364','365','366','367','368','369','370','371','372','373',
  // Hockey
  '66','67','377',
]);

const SPORTS = ['football','tennis','basket','hockey'];

function sanity2(o, k1, k2) {
  const a=o[k1], b=o[k2];
  if (!a||!b) return '-';
  return `${a.toFixed(2)}+${b.toFixed(2)}→inv=${(1/a+1/b).toFixed(3)}`;
}

async function fetchEventRaw(matchId, sport) {
  const path = `/events/${matchId}`;
  const r = await mget(path, {}, 20_000);
  return r?.data || r || null;
}

console.log('▶ AUDIT PremierBet\n');

for (const sport of SPORTS) {
  console.log(`\n═══════════════════ ${sport.toUpperCase()} ═══════════════════`);
  let matches;
  try { matches = await pb.listMatches({ sport, horizonHours: 48 }); }
  catch (e) { console.log(`  listMatches err=${e.message}`); continue; }
  console.log(`  Matchs listes : ${matches.length}`);
  if (!matches.length) { console.log('  ⚠ 0 matchs'); continue; }
  console.log(`  Samples : ${matches.slice(0,3).map(m=>`${m.home} vs ${m.away}`).join(' | ')}`);

  for (const s of matches.slice(0,2)) {
    console.log(`\n  ── ${s.home} vs ${s.away} (id=${s.id}) ──`);
    const ev = await fetchEventRaw(s.id, sport);
    if (!ev) { console.log('    ⚠ event fetch failed'); continue; }
    const markets = ev.markets || ev.event?.markets || [];
    console.log(`    ${markets.length} markets dans /events/${s.id}`);
    const newOnes = markets.filter(m => !KNOWN.has(String(m.id)));
    console.log(`    Mappes : ${markets.filter(m => KNOWN.has(String(m.id))).length}`);
    console.log(`    NOUVEAUX : ${newOnes.length}`);
    for (const nm of newOnes.slice(0, 30)) {
      const nm_name = nm.name || nm.type || '';
      const nOuts = (nm.outcomes || []).length;
      const outSample = (nm.outcomes || []).slice(0, 4).map(o => `${o.name}${o.handicap!==undefined?'['+o.handicap+']':''}=${o.odds}`).join(' | ');
      console.log(`      NEW id=${nm.id} nOut=${nOuts} name="${nm_name}"`);
      if (outSample) console.log(`        out: ${outSample}`);
    }
    // Verif semantique
    const parsed = premierbetFlatOdds(markets, { sport });
    const keys = Object.keys(parsed).filter(k => k !== '_ids');
    console.log(`    ► parseur emit ${keys.length} keys plates`);
    if (parsed.match_1 && parsed.match_2) console.log(`      match_1/2  : ${sanity2(parsed, 'match_1', 'match_2')}`);
    if (parsed.match_X) console.log(`      match_X    : ${parsed.match_X}`);
    const hcpLines = [...new Set(keys.filter(k=>k.startsWith('hcp_home_')).map(k=>k.replace('hcp_home_','')))].slice(0,3);
    for (const l of hcpLines) {
      const h = parsed[`hcp_home_${l}`], a = parsed[`hcp_away_${-Number(l)}`];
      if (h && a) console.log(`      hcp L=${l}: ${sanity2(parsed, `hcp_home_${l}`, `hcp_away_${-Number(l)}`)}`);
    }
  }
}

console.log('\n═══ FIN AUDIT PremierBet ═══');
process.exit(0);
