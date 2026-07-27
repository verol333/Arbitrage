#!/usr/bin/env node
// Audit croise LIVE : cherche un match precis chez YellowBet ET BetMomo,
// dump les cotes brutes cote a cote pour comparer les marches Over/Under.
// L'user signale Togo U20 vs Burkina Faso U20 avec YB Over 3.5=2.60 et BM
// Under 3.5=2.85 = surebet fantome 27% alors que match 50e min avec 3 buts.

import { evapi } from '../src/bookmakers/yellowbet/api.js';
import { yellowbetFlatOdds } from '../src/bookmakers/yellowbet/parse.js';
import { swarmSession, BETMOMO_SID } from '../src/bookmakers/betmomo/api.js';

const TEAM1 = 'Togo';
const TEAM2 = 'Burkina';

console.log(`=== Recherche match "${TEAM1}" vs "${TEAM2}" en LIVE ===\n`);

// ─── YellowBet ────────────────────────────────────────────────────────────
console.log('--- YellowBet ---');
const ybData = await evapi('https://yellowbet.cg/services/evapi/event/GetEvents?isLive=true&count=500&take=500');
const ybEvents = (ybData?.data || []).filter((e) => e.sid === 31 && e.bts);
console.log(`Total live foot events YB : ${ybEvents.length}`);

const ybMatch = ybEvents.find((e) => {
  const s = `${e.h} ${e.a}`.toLowerCase();
  return s.includes(TEAM1.toLowerCase()) && s.includes(TEAM2.toLowerCase());
});

if (!ybMatch) {
  console.log(`Match non trouve chez YB (matchs disponibles :)`);
  for (const e of ybEvents.slice(0, 20)) console.log(`  - ${e.h} vs ${e.a}`);
  console.log(`  ... ${ybEvents.length - 20} autres`);
} else {
  const score = `${ybMatch.hs ?? '?'}-${ybMatch.as ?? '?'}`;
  console.log(`\n✅ YB TROUVE : ${ybMatch.h} vs ${ybMatch.a} | score=${score} min=${ybMatch.mm ?? '?'} | ${ybMatch.bts.length} markets`);
  console.log(`\n=== YB MARCHES OVER/UNDER (dans le nom) ===`);
  for (const bt of ybMatch.bts) {
    if (!/over|under|total|plus|moins|u.o/i.test(bt.n || '')) continue;
    const sample = (bt.odds || []).map((o) => {
      const line = o.l != null ? ` l=${o.l}` : (o.sp != null ? ` sp=${o.sp}` : '');
      return `${o.n || o.id}=${o.p}${line}`;
    });
    console.log(`- "${bt.n}" (${bt.odds?.length}): ${sample.join(' | ')}`);
  }
  // Dump les cles parsees par notre parseur pour ce match precis
  const parsed = yellowbetFlatOdds(ybMatch.bts, { home: ybMatch.h, away: ybMatch.a });
  console.log(`\n=== YB CLES PARSEES (${Object.keys(parsed).length}) — verif match_over_3.5 ===`);
  for (const [k, v] of Object.entries(parsed)) {
    if (/^(match_over|match_under|ht_over|ht_under|h2_over|h2_under)_/.test(k)) {
      console.log(`  ${k} = ${v}`);
    }
  }
}

// ─── BetMomo ──────────────────────────────────────────────────────────────
console.log(`\n\n--- BetMomo ---`);
try {
  const bmMatch = await swarmSession(async (send) => {
    const now = Math.floor(Date.now() / 1000);
    const where = { sport: { id: BETMOMO_SID.football }, game: { is_live: 1 } };
    const listData = await send(
      { sport: ['id'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'is_live', 'start_ts', 'info'] },
      where,
    );
    const games = [];
    for (const s of Object.values(listData?.sport || {})) {
      for (const g of Object.values(s.game || {})) games.push(g);
      for (const r of Object.values(s.region || {})) {
        for (const c of Object.values(r.competition || {})) {
          for (const g of Object.values(c.game || {})) games.push(g);
        }
      }
    }
    console.log(`Total live foot games BM : ${games.length}`);
    const found = games.find((g) => {
      const s = `${g.team1_name || ''} ${g.team2_name || ''}`.toLowerCase();
      return s.includes(TEAM1.toLowerCase()) && s.includes(TEAM2.toLowerCase());
    });
    if (!found) {
      console.log(`Match non trouve chez BM (matchs disponibles :)`);
      for (const g of games.slice(0, 20)) console.log(`  - ${g.team1_name} vs ${g.team2_name}`);
      return null;
    }
    console.log(`\n✅ BM TROUVE : ${found.team1_name} vs ${found.team2_name} | id=${found.id}`);
    const info = found.info || {};
    console.log(`score=${info.score1}-${info.score2} min=${info.current_game_time}`);
    // Fetch odds for this match
    const oddsData = await send(
      { game: ['id'], market: ['name', 'type', 'col_count', 'group_name'], event: ['name', 'price', 'base', 'type_1', 'type'] },
      { game: { id: found.id } },
    );
    const g = Object.values(oddsData?.game || {})[0];
    return g;
  });
  if (bmMatch) {
    const markets = Object.values(bmMatch.market || {});
    console.log(`\nTotal markets BM: ${markets.length}`);
    console.log(`\n=== BM MARCHES OVER/UNDER (dans nom ou type) ===`);
    for (const m of markets) {
      const nm = String(m.name || '');
      const tp = String(m.type || '');
      if (!/over|under|total|goal|plus|moins/i.test(nm + ' ' + tp)) continue;
      const events = Array.isArray(m.event) ? m.event : Object.values(m.event || {});
      const sample = events.map((e) => `${e.type_1 || e.type || e.name}=${e.price}${e.base != null ? ' b=' + e.base : ''}`);
      console.log(`- name="${nm}" type="${tp}" group="${m.group_name || ''}" col=${m.col_count} (${events.length}): ${sample.join(' | ')}`);
    }
  }
} catch (e) {
  console.log(`ERREUR BM: ${e.message}`);
}

process.exit(0);
