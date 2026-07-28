#!/usr/bin/env node
// Audit BetMomo PRE-MATCH marches 1re mi-temps : verifie chaque cote parsee
// contre le raw event du SWARM, pour identifier si l'ecart signale par
// l'user (cotes affichees != cotes BM site) vient du parseur ou de l'API.

import { swarmSession, BETMOMO_SID } from '../src/bookmakers/betmomo/api.js';
import { betmomoFlatOdds } from '../src/bookmakers/betmomo/parse.js';

const HORIZON_HOURS = 48;

console.log('=== Fetching BetMomo PREMATCH (48h) ===\n');

const games = await swarmSession(async (send) => {
  const now = Math.floor(Date.now() / 1000);
  const to = now + HORIZON_HOURS * 3600;
  // Fetch list of prematch games with regions/competitions
  const listData = await send(
    { sport: ['id'], region: ['name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'start_ts'] },
    { sport: { id: BETMOMO_SID.football }, game: { start_ts: { '@gt': now, '@lt': to }, is_live: 0 } },
  );
  const collected = [];
  for (const s of Object.values(listData?.sport || {})) {
    for (const g of Object.values(s.game || {})) collected.push({ ...g, league: '' });
    for (const r of Object.values(s.region || {})) {
      for (const c of Object.values(r.competition || {})) {
        for (const g of Object.values(c.game || {})) collected.push({ ...g, league: c.name || r.name || '' });
      }
    }
  }
  console.log(`Total prematch games: ${collected.length}`);
  // Prendre 3 matchs riches (chercher noms populaires) + 2 aleatoires
  const sample = collected.slice(0, 5);
  const ids = sample.map((g) => g.id);
  const oddsData = await send(
    { game: ['id', 'team1_name', 'team2_name'], market: ['name', 'type', 'col_count', 'group_name'], event: ['name', 'price', 'base', 'type_1', 'type'] },
    { game: { id: { '@in': ids } } },
  );
  return Object.values(oddsData?.game || {});
}, { timeoutMs: 30_000 });

console.log(`Fetched ${games.length} matches with markets\n`);

for (const g of games) {
  const markets = Object.values(g.market || {});
  console.log(`\n╔══ ${g.team1_name} vs ${g.team2_name} | ${markets.length} markets bruts ══╗`);
  // Filter markets first half only
  const htMarkets = markets.filter((m) => {
    const nm = String(m.name || '').toLowerCase();
    const tp = String(m.type || '');
    return /1st half|first half|halftime|half time|1re mi-temps/i.test(nm) || /^HalfTime|^Half|^1stHalf/i.test(tp);
  });
  console.log(`  Filtered ${htMarkets.length} first-half markets\n`);
  // Dump each 1H market raw + what parser would extract
  const parsed = betmomoFlatOdds(markets);
  const htKeys = Object.entries(parsed).filter(([k]) => k.startsWith('ht_'));
  console.log(`  === CLES ht_* PARSEES (${htKeys.length}) ===`);
  for (const [k, v] of htKeys) console.log(`    ${k} = ${v}`);
  console.log(`\n  === RAW 1st half markets ===`);
  for (const m of htMarkets) {
    const evs = Array.isArray(m.event) ? m.event : Object.values(m.event || {});
    const sample = evs.map((e) => `${e.type_1 || e.type || e.name}=${e.price}${e.base != null ? ` b=${e.base}` : ''}`);
    console.log(`    type="${m.type}" name="${m.name || ''}" col=${m.col_count} group="${m.group_name || ''}" (${evs.length}): ${sample.join(' | ')}`);
  }
}

process.exit(0);
