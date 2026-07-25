// Audit générique par match : prend home/away/sport en input, cherche le match
// sur 1xbet/apollo/betmomo et dump SIDE-BY-SIDE tous les marchés bruts et
// tous les champs parsés. But: identifier exactement où un mapping foire.
import { viaWorker, FEED, COUNTRY, PARTNER } from '../src/bookmakers/xbet/api.js';
import { listPrematch as xbetListPrematch, listLive as xbetListLive } from '../src/bookmakers/xbet/list.js';
import { getOdds as xbetGetOdds } from '../src/bookmakers/xbet/odds.js';
import { swarmSession, BETMOMO_SID } from '../src/bookmakers/betmomo/api.js';
import { betmomoFlatOdds } from '../src/bookmakers/betmomo/parse.js';
import { apolloGet, APOLLO_SID } from '../src/bookmakers/apollo/api.js';
import { apolloFlatOdds } from '../src/bookmakers/apollo/parse.js';
import { teamSim } from '../src/core/text.js';

const T_HOME = (process.env.T_HOME || '').toLowerCase();
const T_AWAY = (process.env.T_AWAY || '').toLowerCase();
const SPORT = (process.env.T_SPORT || 'football').toLowerCase();
const LIVE = process.env.T_LIVE === '1';

function score(m) {
  const a = teamSim((m.home || '').toLowerCase(), T_HOME);
  const b = teamSim((m.away || '').toLowerCase(), T_AWAY);
  return (a + b) / 2;
}

const results = {};

// 1xBet
try {
  const list = LIVE ? await xbetListLive({ sport: SPORT }) : await xbetListPrematch({ sport: SPORT });
  const best = list.map((m) => ({ m, s: score(m) })).sort((a, b) => b.s - a.s)[0];
  if (best && best.s > 0.4) {
    const feedPath = LIVE ? 'LiveFeed' : 'LineFeed';
    const url = `${FEED}/service-api/${feedPath}/GetGameZip?id=${best.m.id}&lng=fr&isSubGames=true&GroupEvents=true&countevents=2000&grMode=4&country=${COUNTRY}&marketType=1&isNewBuilder=true`;
    const gd = await viaWorker(url);
    const GE = gd?.Value?.GE || [];
    // Dump chaque groupe avec ses events principaux
    const groupsDump = GE.map((g) => ({
      G: g.G,
      GN: g.GN || null,
      events: (g.E || []).flat().slice(0, 30).map((e) => ({ T: e.T, P: e.P, C: e.C, N: e.N })),
    }));
    const parsed = await xbetGetOdds(best.m.id, { live: LIVE });
    results.xbet = {
      match: `${best.m.home} vs ${best.m.away}`,
      sim: best.s,
      groups: groupsDump.slice(0, 20),
      parsed_all: parsed,
    };
  } else { results.xbet = { error: 'no match matched', best_sim: best?.s }; }
} catch (e) { results.xbet = { error: e.message }; }

// BetMomo
try {
  const out = await swarmSession(async (send) => {
    const where = { sport: { id: BETMOMO_SID[SPORT] } };
    where.game = LIVE ? { is_live: 1 } : { start_ts: { '@gt': Math.floor(Date.now() / 1000) } };
    const listData = await send(
      { sport: ['id'], region: ['name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'start_ts'] },
      where,
    );
    const games = [];
    for (const s of Object.values(listData?.sport || {})) {
      for (const g of Object.values(s.game || {})) games.push({ ...g, league: '' });
      for (const r of Object.values(s.region || {})) {
        for (const c of Object.values(r.competition || {})) {
          for (const g of Object.values(c.game || {})) games.push({ ...g, league: c.name || '' });
        }
      }
    }
    const best = games.map((g) => ({ g, s: (teamSim((g.team1_name || '').toLowerCase(), T_HOME) + teamSim((g.team2_name || '').toLowerCase(), T_AWAY)) / 2 })).sort((a, b) => b.s - a.s)[0];
    if (!best?.g || best.s < 0.4) return { error: 'no match', best_sim: best?.s };
    const oddsData = await send(
      { game: ['id'], market: ['name', 'type', 'col_count', 'group_id', 'group_name'], event: ['name', 'price', 'base', 'type_1', 'type'] },
      { game: { id: best.g.id } },
    );
    const g = Object.values(oddsData?.game || {})[0];
    const markets = g ? Object.values(g.market || {}) : [];
    const parsed = betmomoFlatOdds(markets);
    // Dump chaque marché avec type + group_name (pour identifier P1/P2/P3, set N°, quarter N°)
    const marketsDump = markets.slice(0, 60).map((m) => ({
      type: m.type,
      group: m.group_name || null,
      col_count: m.col_count,
      events: (Array.isArray(m.event) ? m.event : Object.values(m.event || {})).slice(0, 6).map((e) => ({ type_1: e.type_1, base: e.base, price: e.price, name: (e.name || '').slice(0, 30) })),
    }));
    return {
      match: `${best.g.team1_name} vs ${best.g.team2_name}`,
      sim: best.s,
      market_count: markets.length,
      markets: marketsDump,
      parsed_all: parsed,
    };
  });
  results.betmomo = out;
} catch (e) { results.betmomo = { error: e.message }; }

// Apollo
try {
  const now = new Date().toISOString();
  const dateTo = '2046-01-01T00:00:00.000Z';
  const path = LIVE
    ? `/sport/offer/v3/sports/offer?Offset=0&Limit=300&DateFrom=${now}&DateTo=${dateTo}&SportIds=${APOLLO_SID[SPORT]}&Live=true`
    : `/sport/offer/v3/sports/offer?Offset=0&Limit=500&DateFrom=${now}&DateTo=${dateTo}&SportIds=${APOLLO_SID[SPORT]}`;
  const j = await apolloGet(path);
  const all = [];
  for (const s of j?.Response || []) for (const c of s.Categories || []) for (const l of c.Leagues || []) for (const m of l.Matches || []) all.push(m);
  const best = all.map((m) => ({ m, s: (teamSim((m.TeamHome || '').toLowerCase(), T_HOME) + teamSim((m.TeamAway || '').toLowerCase(), T_AWAY)) / 2 })).sort((a, b) => b.s - a.s)[0];
  if (best?.m && best.s > 0.4) {
    const detail = await apolloGet(`/sport/offer/v3/match/offers?MatchId=${best.m.Id}`);
    const offers = detail?.Offers || (detail?.BasicOffer ? [detail.BasicOffer] : []);
    // Group by BetTypeKey with sample odds + name
    const byKey = {};
    for (const o of offers) {
      const k = String(o.BetTypeKey);
      if (!byKey[k]) byKey[k] = { key: k, name: o.BetTypeName || '', group: o.BetTypeGroupName || '', offers: [] };
      byKey[k].offers.push({ Sbv: o.Sbv, odds: (o.Odds || []).slice(0, 4).map((od) => ({ T: od.Type, N: od.Name, O: od.Odd })) });
    }
    const parsed = apolloFlatOdds(offers);
    results.apollo = {
      match: `${best.m.TeamHome} vs ${best.m.TeamAway}`,
      sim: best.s,
      offer_count: offers.length,
      bet_types: Object.values(byKey),
      parsed_all: parsed,
    };
  } else { results.apollo = { error: 'no match', best_sim: best?.s }; }
} catch (e) { results.apollo = { error: e.message }; }

console.log('=== MATCH AUDIT START ===');
console.log(JSON.stringify(results, null, 2));
console.log('=== MATCH AUDIT END ===');
process.exit(0);
