#!/usr/bin/env node
// AUDIT 1xbet : list par sport + dump G codes present dans raw GE array.
import xb from '../src/bookmakers/xbet/index.js';
import { viaWorker, FEED, COUNTRY } from '../src/bookmakers/xbet/api.js';
import { getOdds } from '../src/bookmakers/xbet/odds.js';

const SPORTS = ['football','tennis','basket','hockey'];

// G codes deja utilises par les 3 parseurs (parseGE, parseMainOnly, parseBasketGE)
const KNOWN_G = {
  foot: new Set([1,2,8,9,14,15,17,19,62,169,445,11581]),
  tennis: new Set([1,2,8,9,14,15,17,19,62]),  // utilise parseGE (foot par defaut)
  basket: new Set([2,15,17,62,101]),
  hockey: new Set([1,2,8,14,15,17,19,62]),
};

function sanity2(o, k1, k2) {
  const a=o[k1], b=o[k2];
  if (!a||!b) return '-';
  return `${a.toFixed(2)}+${b.toFixed(2)}→inv=${(1/a+1/b).toFixed(3)}`;
}

async function fetchRawGE(matchId) {
  const url = `${FEED}/service-api/LineFeed/GetGameZip?id=${matchId}&lng=fr&isSubGames=true&GroupEvents=true&countevents=2000&grMode=4&country=${COUNTRY}&marketType=1&isNewBuilder=true`;
  const gd = await viaWorker(url, { noCache: false });
  return gd?.Value?.GE || null;
}

console.log('▶ AUDIT 1xbet\n');

for (const sport of SPORTS) {
  console.log(`\n═══════════════════ ${sport.toUpperCase()} ═══════════════════`);
  let matches;
  try { matches = await xb.listMatches({ sport, horizonHours: 48 }); }
  catch (e) { console.log(`  listMatches err=${e.message}`); continue; }
  console.log(`  Matchs listes : ${matches.length}`);
  if (!matches.length) { console.log('  ⚠ 0 matchs'); continue; }
  console.log(`  Samples : ${matches.slice(0,3).map(m=>`${m.home} vs ${m.away}`).join(' | ')}`);
  const knownKey = sport === 'basket' ? 'basket' : sport === 'hockey' ? 'hockey' : sport === 'tennis' ? 'tennis' : 'foot';
  const known = KNOWN_G[knownKey] || new Set();

  for (const s of matches.slice(0, 2)) {
    console.log(`\n  ── ${s.home} vs ${s.away} (id=${s.id}) ──`);
    const GE = await fetchRawGE(s.id);
    if (!GE) { console.log('    ⚠ fetch GE null'); continue; }
    console.log(`    ${GE.length} groups G distincts`);
    const gStats = new Map();
    for (const g of GE) {
      if (g.G == null) continue;
      const cur = gStats.get(g.G) || { count: 0, sample: null };
      cur.count++;
      if (!cur.sample) cur.sample = g;
      gStats.set(g.G, cur);
    }
    const known_present = [...gStats.keys()].filter(g => known.has(g));
    const unknown_present = [...gStats.keys()].filter(g => !known.has(g));
    console.log(`    Groups MAPPES : [${known_present.join(',')}]`);
    console.log(`    Groups INCONNUS : ${unknown_present.length}`);
    // Sample : top 15 unknown groups avec name (TG) et 1 outcome sample
    const unknownSorted = unknown_present.map(g => {
      const s = gStats.get(g).sample;
      return { g, tg: s.TG || s.PN || s.MG || '?', nEvents: (s.E || []).length, sample: (s.E || [])[0] };
    }).sort((a, b) => b.nEvents - a.nEvents);
    for (const u of unknownSorted.slice(0, 15)) {
      const outStr = u.sample ? `T=${u.sample.T} P=${u.sample.P ?? '-'} C=${u.sample.C}` : '';
      console.log(`      NEW G=${u.g} nOut=${u.nEvents} "${u.tg}" ${outStr}`);
    }
    // Parse via prod
    const parsed = await getOdds(s.id, { sport });
    if (parsed) {
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
}

console.log('\n═══ FIN AUDIT 1xbet ═══');
process.exit(0);
