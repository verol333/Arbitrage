// Audit tennis markets : dump raw + parsed odds pour un match tennis
// commun aux 3 books actifs (1xbet, apollo, betmomo). Objectif: identifier
// pourquoi le parseur handicap 1xbet donne des cotes décalées.
import { viaWorker, FEED, COUNTRY, PARTNER } from '../src/bookmakers/xbet/api.js';
import { listPrematch as xbetListPrematch } from '../src/bookmakers/xbet/list.js';
import { getOdds as xbetGetOdds } from '../src/bookmakers/xbet/odds.js';
import { swarmSession, BETMOMO_SID } from '../src/bookmakers/betmomo/api.js';
import { betmomoFlatOdds } from '../src/bookmakers/betmomo/parse.js';
import { apolloGet, APOLLO_SID } from '../src/bookmakers/apollo/api.js';
import { apolloFlatOdds } from '../src/bookmakers/apollo/parse.js';
import { teamSim } from '../src/core/text.js';

const TARGET_HOME = (process.env.T_HOME || 'Charles Broom').toLowerCase();
const TARGET_AWAY = (process.env.T_AWAY || 'Toby Samuel').toLowerCase();
function score(m) {
  const a = teamSim(m.home?.toLowerCase() || '', TARGET_HOME);
  const b = teamSim(m.away?.toLowerCase() || '', TARGET_AWAY);
  return (a + b) / 2;
}

const results = {};

// 1xBet : trouve match, dump GE groupes tennis + parsed odds
try {
  const list = await xbetListPrematch({ sport: 'tennis' });
  const best = list.map((m) => ({ m, s: score(m) })).sort((a, b) => b.s - a.s)[0];
  if (best) {
    const url = `${FEED}/service-api/LineFeed/GetGameZip?id=${best.m.id}&lng=fr&isSubGames=true&GroupEvents=true&countevents=2000&grMode=4&country=${COUNTRY}&marketType=1&isNewBuilder=true`;
    const gd = await viaWorker(url);
    const GE = gd?.Value?.GE || [];
    // Dump les GroupID + noms + count events pour comprendre la structure
    const groups = GE.map((g) => ({ G: g.G, name: g.GN || g.EN || '?', n_events: (g.E || []).flat().length }));
    // Dump grp(2) events détaillés
    const grp2 = GE.find((g) => g.G === 2);
    const grp2Events = grp2 ? (grp2.E || []).flat().map((e) => ({ T: e.T, P: e.P, C: e.C, N: e.N })) : [];
    // Dump grp(17) events détaillés (total games ?)
    const grp17 = GE.find((g) => g.G === 17);
    const grp17Events = grp17 ? (grp17.E || []).flat().map((e) => ({ T: e.T, P: e.P, C: e.C, N: e.N })) : [];
    // Notre parseur actuel
    const parsed = await xbetGetOdds(best.m.id, {});
    const hcpParsed = {};
    for (const [k, v] of Object.entries(parsed || {})) if (k.startsWith('hcp_')) hcpParsed[k] = v;
    results.xbet = {
      match: `${best.m.home} vs ${best.m.away}`,
      sim: best.s,
      total_groups: groups.length,
      groups: groups.slice(0, 25),
      grp2_events: grp2Events.slice(0, 40),
      grp17_events: grp17Events.slice(0, 20),
      parsed_hcp: hcpParsed,
    };
  } else {
    results.xbet = { error: 'no tennis match matched' };
  }
} catch (e) { results.xbet = { error: e.message }; }

// BetMomo : dump market types + hcp/total lus
try {
  const out = await swarmSession(async (send) => {
    const listData = await send(
      { sport: ['id'], region: ['name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'start_ts'] },
      { sport: { id: BETMOMO_SID.tennis }, game: { start_ts: { '@gt': Math.floor(Date.now() / 1000) } } },
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
    const best = games.map((g) => ({ g, s: (teamSim((g.team1_name || '').toLowerCase(), TARGET_HOME) + teamSim((g.team2_name || '').toLowerCase(), TARGET_AWAY)) / 2 })).sort((a, b) => b.s - a.s)[0];
    if (!best?.g) return { error: 'no tennis match' };
    const oddsData = await send(
      { game: ['id'], market: ['name', 'type', 'col_count'], event: ['name', 'price', 'base', 'type_1', 'type'] },
      { game: { id: best.g.id } },
    );
    const g = Object.values(oddsData?.game || {})[0];
    const markets = g ? Object.values(g.market || {}) : [];
    const parsed = betmomoFlatOdds(markets);
    const hcpParsed = {};
    for (const [k, v] of Object.entries(parsed || {})) if (k.startsWith('hcp_') || k.startsWith('set_hcp_') || k.startsWith('match_')) hcpParsed[k] = v;
    // Dump raw markets pertinents (type contient Handicap ou HandicapSets)
    const rawMarkets = markets.filter((m) => /Handicap|TotalGames|Sets/.test(String(m.type))).map((m) => ({
      type: m.type,
      events: (Array.isArray(m.event) ? m.event : Object.values(m.event || {})).map((e) => ({ type_1: e.type_1, base: e.base, price: e.price, name: e.name })),
    }));
    return {
      match: `${best.g.team1_name} vs ${best.g.team2_name}`,
      sim: best.s,
      raw_markets: rawMarkets.slice(0, 8),
      parsed_hcp: hcpParsed,
    };
  });
  results.betmomo = out;
} catch (e) { results.betmomo = { error: e.message }; }

// Apollo : dump offers Handicap-like + parsed
try {
  const now = new Date().toISOString();
  const dateTo = '2046-01-01T00:00:00.000Z';
  const j = await apolloGet(`/sport/offer/v3/sports/offer?Offset=0&Limit=300&DateFrom=${now}&DateTo=${dateTo}&SportIds=${APOLLO_SID.tennis}`);
  const all = [];
  for (const s of j?.Response || []) for (const c of s.Categories || []) for (const l of c.Leagues || []) for (const m of l.Matches || []) all.push(m);
  const best = all.map((m) => ({ m, s: (teamSim((m.TeamHome || '').toLowerCase(), TARGET_HOME) + teamSim((m.TeamAway || '').toLowerCase(), TARGET_AWAY)) / 2 })).sort((a, b) => b.s - a.s)[0];
  if (best?.m) {
    const detail = await apolloGet(`/sport/offer/v3/match/offers?MatchId=${best.m.Id}`);
    const offers = detail?.Offers || (detail?.BasicOffer ? [detail.BasicOffer] : []);
    // Cherche les BetTypeKey plausiblement Handicap tennis
    const hcpKeys = new Set();
    const hcpOffers = offers.filter((o) => /Handicap|Total.*Games|Sets/i.test(String(o.BetTypeName || '') + String(o.BetTypeGroupName || ''))).map((o) => {
      hcpKeys.add(o.BetTypeKey);
      return {
        BetTypeKey: o.BetTypeKey,
        BetTypeName: o.BetTypeName,
        Sbv: o.Sbv,
        Odds: (o.Odds || []).map((od) => ({ Type: od.Type, Name: od.Name, Odd: od.Odd })),
      };
    });
    const parsed = apolloFlatOdds(offers);
    const hcpParsed = {};
    for (const [k, v] of Object.entries(parsed || {})) if (k.startsWith('hcp_') || k.startsWith('set_hcp_') || k.startsWith('match_')) hcpParsed[k] = v;
    results.apollo = {
      match: `${best.m.TeamHome} vs ${best.m.TeamAway}`,
      sim: best.s,
      hcp_offers: hcpOffers.slice(0, 10),
      hcp_bettypekeys: [...hcpKeys],
      parsed_hcp: hcpParsed,
    };
  } else {
    results.apollo = { error: 'no match' };
  }
} catch (e) { results.apollo = { error: e.message }; }

console.log('=== TENNIS AUDIT START ===');
console.log(JSON.stringify(results, null, 2));
console.log('=== TENNIS AUDIT END ===');
process.exit(0);
