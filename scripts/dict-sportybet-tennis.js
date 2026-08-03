#!/usr/bin/env node
// Dictionnaire complet SportyBet tennis (SportRadar UOF format)
// Objectif : lister TOUS les marketIds exposes + descriptions officielles
// SportyBet utilise SportRadar UOF : chaque market a un id + desc + specifier

import { sbFetchUpcoming, sbFetchEvent } from '../src/bookmakers/sportybet/api.js';

// SPORTYBET a des market IDs specifiques. Je vais probe avec un large ensemble
// pour maximiser la couverture, pas juste les 8 configures pour foot.
// Standard SportRadar tennis market IDs :
//  186=Match Winner, 187=Handicap games, 189=Total games,
//  190=Player X total games, 191=Player Y total games,
//  202=Set N Winner, 203=Set N Handicap games, 204=Set N total games,
//  205=Set N total games (dbl), 207=Set N Correct Score,
//  199=Correct Score (sets), 196=Total sets exact, 201=Set 1/Match, 188=Handicap sets,
//  192=Team1 win a set, 193=Team2 win a set, 194=Any set to nil

// On requet SANS marketId filter pour voir TOUS les markets exposes
async function fetchWithoutMarketFilter(sport, pageSize = 50) {
  const ts = Date.now();
  const url = `https://www.sportybet.com/api/ng/factsCenter/pcUpcomingEvents?sportId=${encodeURIComponent(sport)}&pageSize=${pageSize}&pageNum=1&option=1&timeline=24&sortOption=SORT_BY_DEFAULT&_t=${ts}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36',
      Accept: '*/*',
      Referer: 'https://www.sportybet.com/ng/sport/tennis/today',
      Origin: 'https://www.sportybet.com',
      Cookie: 'locale=en; device-id=b0671631-24f3-4e60-a281-117254ea1551; sb_country=ng',
      clientid: 'web', operid: '2', platform: 'web',
    },
    signal: AbortSignal.timeout(20000),
  });
  return res.ok ? res.json() : null;
}

console.log('═══ SPORTYBET tennis dictionnaire complet ═══\n');
console.log('Fetch sport=sr:sport:5 SANS filter marketId...\n');

// Try both with and without marketId filter
const withFilter = await sbFetchUpcoming({ pageSize: 20, sport: 'tennis' });
const withoutFilter = await fetchWithoutMarketFilter('sr:sport:5', 20);

const eventsWith = [];
const eventsWithout = [];
for (const t of (withFilter?.data?.tournaments || [])) for (const e of (t.events || [])) eventsWith.push({ ...e, tournament: t.name });
for (const t of (withoutFilter?.data?.tournaments || [])) for (const e of (t.events || [])) eventsWithout.push({ ...e, tournament: t.name });

console.log(`  Avec filter (${8} marketIds foot) : ${eventsWith.length} events`);
console.log(`  Sans filter (tous) : ${eventsWithout.length} events`);

// Prendre 5 matchs (with filter donne ATP/WTA reels)
const sample = eventsWith.slice(0, 5);
console.log(`\n5 matchs sample :`);
for (const e of sample) console.log(`  - ${e.homeTeamName} vs ${e.awayTeamName} (${e.tournament})`);

// Pour chaque match : fetch DETAIL event pour avoir TOUS les markets (pas juste les 8 demandes)
console.log(`\n═══ Fetch detail event pour recuperer TOUS les markets ═══`);

const allMarketIds = {}; // id → { desc, count, specifiers, samples }
for (const ev of sample) {
  const detail = await sbFetchEvent(ev.eventId, { live: false });
  const markets = detail?.data?.markets || [];
  console.log(`\n  Match "${ev.homeTeamName} vs ${ev.awayTeamName}" : ${markets.length} markets`);
  for (const mk of markets) {
    const id = String(mk.id || '');
    if (!allMarketIds[id]) allMarketIds[id] = { descs: new Set(), specifiers: new Set(), samples: [] };
    allMarketIds[id].descs.add(mk.desc || mk.description || '?');
    if (mk.specifier) allMarketIds[id].specifiers.add(mk.specifier);
    if (allMarketIds[id].samples.length < 3) {
      const outs = (mk.outcomes || []).slice(0, 4).map(o => `${o.desc}(id=${o.id})=${o.odds}`).join(' | ');
      allMarketIds[id].samples.push({ matchLabel: `${ev.homeTeamName} vs ${ev.awayTeamName}`, specifier: mk.specifier, outcomes: outs });
    }
  }
}

// Dump dictionnaire
console.log(`\n\n═══ DICTIONNAIRE COMPLET : ${Object.keys(allMarketIds).length} marketIds ═══\n`);
for (const id of Object.keys(allMarketIds).sort((a, b) => Number(a) - Number(b))) {
  const m = allMarketIds[id];
  console.log(`\n━━ marketId=${id} ━━`);
  console.log(`  Descriptions : ${[...m.descs].join(' | ')}`);
  console.log(`  Specifiers observes (${m.specifiers.size}) : ${[...m.specifiers].slice(0, 10).join(', ')}`);
  console.log(`  Exemples :`);
  for (const s of m.samples) {
    console.log(`    [${s.matchLabel}] spec=${s.specifier || ''} → ${s.outcomes}`);
  }
}
