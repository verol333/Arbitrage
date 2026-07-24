// Deep probe : pour chaque bookmaker (Apollo/BetMomo/1xBet), prend 1-2 vrais
// matchs tennis et dump TOUS les market IDs + labels + samples pour construire
// les mappings tennis.

import { viaWorker as xviaWorker, FEED as XFEED, COUNTRY as XCOUNTRY, PARTNER as XPARTNER } from '../../src/bookmakers/xbet/api.js';
import { apolloGet } from '../../src/bookmakers/apollo/api.js';
import { swarmSession } from '../../src/bookmakers/betmomo/api.js';

async function probeXbetTennisMarkets() {
  const out = { book: '1xbet', sport: 4 };
  const champs = await xviaWorker(`${XFEED}/service-api/LineFeed/GetChampsZip?sport=4&lng=en&country=${XCOUNTRY}&partner=${XPARTNER}`);
  const champIds = [...new Set((champs?.Value || []).map((c) => c.LI || c.CI).filter(Boolean))].slice(0, 3);
  const allMatches = [];
  for (const ci of champIds) {
    const r = await xviaWorker(`${XFEED}/service-api/LineFeed/Get1x2_VZip?champs=${ci}&count=20&lng=en&mode=4&country=${XCOUNTRY}&partner=${XPARTNER}&getEmpty=true`);
    for (const m of (r?.Value || [])) {
      if (m.I && m.O1 && m.O2) allMatches.push({ id: m.I, home: m.O1, away: m.O2, league: m.LE || m.L || '' });
    }
    if (allMatches.length >= 2) break;
  }
  out.matches = allMatches.slice(0, 2);
  out.dumps = [];
  for (const m of out.matches.slice(0, 2)) {
    const gd = await xviaWorker(`${XFEED}/service-api/LineFeed/GetGameZip?id=${m.id}&lng=en&isSubGames=true&GroupEvents=true&countevents=2000&grMode=4&country=${XCOUNTRY}&marketType=1&isNewBuilder=true`);
    const v = gd?.Value;
    const groups = (v?.GE || []).map((g) => ({
      G: g.G, N: g.N || g.GN || '',
      events: (g.E || []).flatMap((sub) => Array.isArray(sub) ? sub : [sub])
        .map((it) => ({ T: it.T, N: it.N || it.NA || '', P: it.P, C: it.C }))
        .filter((it) => it.T != null && it.C != null).slice(0, 12),
    })).slice(0, 60);
    const subs = (v?.SG || []).slice(0, 8).map((sg) => ({ I: sg.I, PN: sg.PN, TG: sg.TG, P: sg.P }));
    out.dumps.push({ match: m, groups, sub_games: subs });
  }
  return out;
}

async function probeApolloTennisMarkets() {
  const out = { book: 'apollo', sport: 389 };
  const now = new Date().toISOString();
  const j = await apolloGet(`/sport/offer/v3/sports/offer?Offset=0&Limit=10&DateFrom=${now}&DateTo=2046-04-07T22:59:59.000Z&SportIds=389`);
  const matches = [];
  for (const s of (j?.Response || [])) for (const c of s.Categories || []) for (const l of c.Leagues || []) for (const m of l.Matches || []) {
    matches.push({ id: m.Id, home: m.TeamHome, away: m.TeamAway, league: `${c.Name}/${l.Name}` });
    if (matches.length >= 2) break;
  }
  out.matches = matches;
  out.dumps = [];
  for (const m of matches) {
    const details = await apolloGet(`/sport/offer/v3/match/offers?MatchId=${m.id}`);
    const offers = details?.Offers && details.Offers.length ? details.Offers : (details?.BasicOffer ? [details.BasicOffer] : []);
    // Simplifier chaque offer
    const simple = offers.slice(0, 30).map((o) => ({
      BetTypeId: o.BetTypeId, BetTypeName: o.BetTypeName,
      Argument: o.Argument, SpecialValue: o.SpecialValue,
      Odds: (o.Odds || o.SubOffers || []).slice(0, 5).map((x) => ({
        Id: x.Id, Name: x.Name, TipTypeName: x.TipTypeName, Value: x.Value ?? x.Odd, Argument: x.Argument,
      })),
    }));
    out.dumps.push({ match: m, offers_count: offers.length, offers: simple });
  }
  return out;
}

async function probeBetmomoTennisMarkets() {
  const out = { book: 'betmomo', sport: 4 };
  const now = Math.floor(Date.now() / 1000);
  const to = now + 72 * 3600;
  return swarmSession(async (send) => {
    const listData = await send(
      { sport: ['id'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'start_ts'] },
      { sport: { id: 4 }, game: { start_ts: { '@gt': now, '@lt': to }, is_live: 0 } },
    );
    const games = [];
    for (const s of Object.values(listData?.sport || {})) {
      for (const c of Object.values(s.competition || {})) {
        for (const g of Object.values(c.game || {})) games.push({ ...g, league: c.name });
      }
    }
    out.matches = games.slice(0, 2).map((g) => ({ id: g.id, home: g.team1_name, away: g.team2_name, league: g.league }));
    if (!out.matches.length) return out;
    const ids = out.matches.map((m) => m.id);
    const oddsData = await send(
      { game: ['id'], market: ['name', 'type', 'col_count', 'group_name', 'group_id', 'display_key'], event: ['name', 'price', 'base', 'type_1', 'type'] },
      { game: { id: { '@in': ids } } },
    );
    out.dumps = [];
    for (const g of Object.values(oddsData?.game || {})) {
      const markets = Object.values(g.market || {});
      const simple = markets.slice(0, 30).map((mk) => ({
        name: mk.name, type: mk.type, group_name: mk.group_name, group_id: mk.group_id, display_key: mk.display_key,
        events: Object.values(mk.event || {}).slice(0, 6).map((ev) => ({
          name: ev.name, type: ev.type, type_1: ev.type_1, base: ev.base, price: ev.price,
        })),
      }));
      out.dumps.push({ match: out.matches.find((mm) => mm.id === g.id), markets_count: markets.length, markets: simple });
    }
    return out;
  });
}

(async () => {
  const out = { at: new Date().toISOString() };
  for (const [name, fn] of [
    ['xbet', probeXbetTennisMarkets],
    ['apollo', probeApolloTennisMarkets],
    ['betmomo', probeBetmomoTennisMarkets],
  ]) {
    process.stderr.write(`[probe-tennis-markets] ${name}...\n`);
    try { out[name] = await fn(); } catch (e) { out[name] = { error: e.message }; }
  }
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
