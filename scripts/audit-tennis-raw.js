#!/usr/bin/env node
// Dump raw des noms de marchés tennis pour identifier ce qui manque au parseur.
// Cible : 1xbet LIVE (0 clés parsées), YellowBet tennis (pas de match_1/2),
// Apollo tennis (couverture faible), BetMomo LIVE tennis.

import { viaWorker, FEED, COUNTRY, PARTNER } from '../src/bookmakers/xbet/api.js';
import { evapi } from '../src/bookmakers/yellowbet/api.js';
import { apolloGet, APOLLO_SID } from '../src/bookmakers/apollo/api.js';
import { swarmSession, BETMOMO_SID } from '../src/bookmakers/betmomo/api.js';

// ═══ 1XBET LIVE tennis raw ══════════════════════════════════════════════════
console.log('\n════════════ 1XBET LIVE tennis (raw dump) ════════════');
try {
  const raw = await viaWorker(`${FEED}/service-api/LiveFeed/Get1x2_VZip?sports=4&count=20&lng=en&mode=4&country=${COUNTRY}&partner=${PARTNER}&getEmpty=true`);
  const events = raw?.Value || [];
  console.log(`  ${events.length} tennis live events`);
  if (events.length) {
    const ev = events[0];
    console.log(`  Sample event: ${ev.O1} vs ${ev.O2} | I=${ev.I}`);
    const gd = await viaWorker(`${FEED}/service-api/LiveFeed/GetGameZip?id=${ev.I}&lng=fr&isSubGames=true&GroupEvents=true&countevents=2000&grMode=4&country=${COUNTRY}&marketType=1&isNewBuilder=true`);
    const GE = gd?.Value?.GE || [];
    console.log(`  GetGameZip returned ${GE.length} market groups`);
    for (const g of GE.slice(0, 20)) {
      const items = Array.isArray(g.E) ? g.E.flat().slice(0, 4) : [];
      console.log(`    G=${g.G} name="${g.N || g.GN || ''}" (${items.length} outcomes): ${items.map((i) => `T=${i.T} P=${i.P} C=${i.C}`).join(' | ')}`);
    }
  }
} catch (e) { console.log(`  ERR: ${e.message}`); }

// ═══ YELLOWBET tennis PREMATCH raw ══════════════════════════════════════════
console.log('\n════════════ YELLOWBET tennis PREMATCH (raw dump) ════════════');
try {
  const j = await evapi('https://yellowbet.cg/services/evapi/event/GetEvents?count=100&take=100&sportIds=35');
  const evs = (j?.data || []).filter((e) => e.sid === 35 && e.bts?.length);
  console.log(`  ${evs.length} tennis events`);
  if (evs.length) {
    const ev = evs[0];
    console.log(`  Sample: ${ev.h} vs ${ev.a} | ${ev.bts.length} markets`);
    // Liste noms uniques de marchés
    const names = [...new Set(ev.bts.map((b) => b.n))].slice(0, 30);
    console.log(`  Market names:`);
    for (const bt of ev.bts.slice(0, 25)) {
      const sample = (bt.odds || []).slice(0, 4).map((o) => `${o.n || o.id}=${o.p}${o.l != null ? ` l=${o.l}` : ''}`);
      console.log(`    "${bt.n}" (${(bt.odds || []).length}): ${sample.join(' | ')}`);
    }
  }
} catch (e) { console.log(`  ERR: ${e.message}`); }

// ═══ APOLLO tennis raw ══════════════════════════════════════════════════════
console.log('\n════════════ APOLLO tennis (raw dump) ════════════');
try {
  const now = new Date().toISOString();
  const dateTo = '2046-04-07T22:59:59.000Z';
  const j = await apolloGet(`/sport/offer/v3/sports/offer?Offset=0&Limit=10&DateFrom=${now}&DateTo=${dateTo}&SportIds=${APOLLO_SID.tennis}`);
  let match = null;
  for (const s of j?.Response || []) for (const c of s.Categories || []) for (const l of c.Leagues || []) for (const m of l.Matches || []) {
    if (!match) match = m;
  }
  if (match) {
    console.log(`  Sample: ${match.TeamHome} vs ${match.TeamAway} | Id=${match.Id}`);
    const detail = await apolloGet(`/sport/offer/v3/match/offers?MatchId=${match.Id}`);
    const offers = detail?.Offers || (detail?.BasicOffer ? [detail.BasicOffer] : []);
    console.log(`  ${offers.length} offers total`);
    const seen = new Set();
    for (const o of offers) {
      if (seen.has(o.BetTypeKey)) continue;
      seen.add(o.BetTypeKey);
      const odds = (o.Odds || []).slice(0, 4).map((od) => `T=${od.Type} N="${od.Name}" O=${od.Odd}`);
      console.log(`    BetTypeKey=${o.BetTypeKey} Sbv=${o.Sbv || ''} (${(o.Odds || []).length}): ${odds.join(' | ')}`);
      if (seen.size > 25) break;
    }
  } else console.log('  No tennis match found');
} catch (e) { console.log(`  ERR: ${e.message}`); }

// ═══ BETMOMO tennis LIVE raw ════════════════════════════════════════════════
console.log('\n════════════ BETMOMO tennis LIVE (raw dump) ════════════');
try {
  const games = await swarmSession(async (send) => {
    const listData = await send(
      { sport: ['id'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'info'] },
      { sport: { id: BETMOMO_SID.tennis }, game: { is_live: 1 } },
    );
    const g = [];
    for (const s of Object.values(listData?.sport || {})) {
      for (const gg of Object.values(s.game || {})) g.push(gg);
      for (const r of Object.values(s.region || {})) {
        for (const c of Object.values(r.competition || {})) {
          for (const gg of Object.values(c.game || {})) g.push(gg);
        }
      }
    }
    console.log(`  ${g.length} tennis live matches`);
    if (!g.length) return [];
    const oddsData = await send(
      { game: ['id', 'team1_name', 'team2_name'], market: ['name', 'type'], event: ['name', 'price', 'base', 'type_1', 'type'] },
      { game: { id: g[0].id } },
    );
    return Object.values(oddsData?.game || {});
  });
  if (games.length) {
    const g = games[0];
    console.log(`  Sample: ${g.team1_name} vs ${g.team2_name}`);
    const markets = Object.values(g.market || {});
    const seen = new Set();
    for (const m of markets) {
      if (seen.has(m.type)) continue;
      seen.add(m.type);
      const evs = Array.isArray(m.event) ? m.event : Object.values(m.event || {});
      const sample = evs.slice(0, 4).map((e) => `${e.type_1 || e.type || e.name}=${e.price}${e.base != null ? ` b=${e.base}` : ''}`);
      console.log(`    type="${m.type}" name="${m.name || ''}" (${evs.length}): ${sample.join(' | ')}`);
      if (seen.size > 25) break;
    }
  }
} catch (e) { console.log(`  ERR: ${e.message}`); }

process.exit(0);
