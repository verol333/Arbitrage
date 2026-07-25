// Audit marchés basket/hockey/volley : dump les market types/BetTypeKey réels
// pour identifier ce que nos parseurs manquent.
import { swarmSession, BETMOMO_SID } from '../src/bookmakers/betmomo/api.js';
import { apolloGet, APOLLO_SID } from '../src/bookmakers/apollo/api.js';

const results = {};

for (const sport of ['basketball', 'hockey', 'volleyball']) {
  results[sport] = {};

  // BetMomo : liste les types de marchés distincts trouvés sur le 1er match
  try {
    const out = await swarmSession(async (send) => {
      const listData = await send(
        { sport: ['id'], region: ['name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'start_ts'] },
        { sport: { id: BETMOMO_SID[sport] }, game: { start_ts: { '@gt': Math.floor(Date.now() / 1000) } } },
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
      if (!games.length) return { error: 'no games' };
      const g0 = games[0];
      const oddsData = await send(
        { game: ['id'], market: ['name', 'type', 'col_count', 'group_id'], event: ['name', 'price', 'base', 'type_1', 'type'] },
        { game: { id: g0.id } },
      );
      const gg = Object.values(oddsData?.game || {})[0];
      const markets = gg ? Object.values(gg.market || {}) : [];
      return {
        sample_match: `${g0.team1_name} vs ${g0.team2_name}`,
        total_matches: games.length,
        market_types: [...new Set(markets.map((m) => m.type))].sort(),
        sample_markets_first5: markets.slice(0, 5).map((m) => ({
          type: m.type,
          events: (Array.isArray(m.event) ? m.event : Object.values(m.event || {})).map((e) => ({ type_1: e.type_1, base: e.base, price: e.price, name: (e.name || '').slice(0, 30) })).slice(0, 4),
        })),
      };
    });
    results[sport].betmomo = out;
  } catch (e) { results[sport].betmomo = { error: e.message }; }

  // Apollo : liste les BetTypeKey distincts + noms sur le 1er match
  try {
    const now = new Date().toISOString();
    const dateTo = '2046-01-01T00:00:00.000Z';
    const j = await apolloGet(`/sport/offer/v3/sports/offer?Offset=0&Limit=200&DateFrom=${now}&DateTo=${dateTo}&SportIds=${APOLLO_SID[sport]}`);
    const all = [];
    for (const s of j?.Response || []) for (const c of s.Categories || []) for (const l of c.Leagues || []) for (const m of l.Matches || []) all.push(m);
    if (!all.length) { results[sport].apollo = { error: 'no matches' }; continue; }
    const m0 = all[0];
    const detail = await apolloGet(`/sport/offer/v3/match/offers?MatchId=${m0.Id}`);
    const offers = detail?.Offers || (detail?.BasicOffer ? [detail.BasicOffer] : []);
    // Group by BetTypeKey, take name + odds sample
    const byKey = new Map();
    for (const o of offers) {
      const k = o.BetTypeKey;
      if (!byKey.has(k)) byKey.set(k, { key: k, name: o.BetTypeName || o.Description || '', group: o.BetTypeGroupName || '', sample_odds: [] });
      const rec = byKey.get(k);
      if (rec.sample_odds.length < 3) {
        rec.sample_odds.push({ Type: (o.Odds || [])[0]?.Type, Name: (o.Odds || [])[0]?.Name, Odd: (o.Odds || [])[0]?.Odd, Sbv: o.Sbv });
      }
    }
    results[sport].apollo = {
      sample_match: `${m0.TeamHome} vs ${m0.TeamAway}`,
      total_matches: all.length,
      offer_count: offers.length,
      bet_types: [...byKey.values()].slice(0, 40),
    };
  } catch (e) { results[sport].apollo = { error: e.message }; }
}

console.log('=== NEW SPORTS MARKETS START ===');
console.log(JSON.stringify(results, null, 2));
console.log('=== NEW SPORTS MARKETS END ===');
process.exit(0);
