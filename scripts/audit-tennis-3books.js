// Audit dédié tennis : BetMomo + YellowBet + Apollo.
// Dump 2-3 matchs par book avec marchés bruts, clés parsées et collisions de clés.
import { swarmSession, BETMOMO_SID } from '../src/bookmakers/betmomo/api.js';
import { betmomoFlatOdds } from '../src/bookmakers/betmomo/parse.js';
import { BASE_URL, evapi, toMatch } from '../src/bookmakers/yellowbet/api.js';
import { yellowbetFlatOdds } from '../src/bookmakers/yellowbet/parse.js';
import { APOLLO_SID, apolloGet } from '../src/bookmakers/apollo/api.js';
import { apolloFlatOdds } from '../src/bookmakers/apollo/parse.js';

const LIMIT = Number(process.env.AUDIT_LIMIT || 3);
const HORIZON_HOURS = Number(process.env.HORIZON_HOURS || 168);
const isHalfLine = (n) => Number.isFinite(Number(n)) && Math.abs((Math.abs(Number(n)) * 2) % 2 - 1) < 1e-9;
const lineOf = (o) => { const l = parseFloat(o?.l ?? o?.sp ?? o?.hc ?? o?.base ?? o?.Sbv); return Number.isNaN(l) ? null : l; };
const keyGroup = (k) => k.replace(/_-?\d+(?:\.\d+)?$/, '_<L>').replace(/_(over|under)_\d+(?:\.\d+)?$/, '_$1_<L>');

function summarizeParsed(odds) {
  const groups = {};
  for (const [k, v] of Object.entries(odds || {}).sort()) {
    const g = keyGroup(k);
    if (!groups[g]) groups[g] = [];
    groups[g].push({ key: k, odd: v });
  }
  return groups;
}

function collisionReport(odds) {
  const byGroup = summarizeParsed(odds);
  return Object.fromEntries(Object.entries(byGroup).filter(([, rows]) => rows.length > 8));
}

function rawBetmomoMarket(m) {
  const events = Array.isArray(m.event) ? m.event : Object.values(m.event || {});
  return {
    name: m.name,
    type: m.type,
    group: m.group_name || m.group_id || null,
    events: events.slice(0, 12).map((e) => ({
      name: e.name, type: e.type, type_1: e.type_1, base: e.base, price: e.price,
    })),
  };
}

function rawYellowMarket(m) {
  return {
    name: m.n,
    odds: (m.odds || []).slice(0, 16).map((o) => ({
      id: o.id, name: o.n, line: lineOf(o), price: o.p,
    })),
  };
}

function rawApolloOffer(o) {
  return {
    key: o.BetTypeKey,
    name: o.BetTypeName || o.Description || null,
    group: o.BetTypeGroupName || null,
    sbv: o.Sbv,
    odds: (o.Odds || []).slice(0, 12).map((od) => ({ type: od.Type, name: od.Name, odd: od.Odd })),
  };
}

async function auditBetMomo() {
  return swarmSession(async (send) => {
    const listData = await send(
      { sport: ['id'], region: ['name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'start_ts'] },
      { sport: { id: BETMOMO_SID.tennis }, game: { start_ts: { '@gt': Math.floor(Date.now() / 1000) } } },
    );
    const games = [];
    for (const s of Object.values(listData?.sport || {})) {
      for (const g of Object.values(s.game || {})) games.push(g);
      for (const r of Object.values(s.region || {})) for (const c of Object.values(r.competition || {})) {
        for (const g of Object.values(c.game || {})) games.push({ ...g, league: c.name || r.name || '' });
      }
    }
    const rows = [];
    for (const g of games.filter((x) => x.team1_name && x.team2_name).slice(0, LIMIT)) {
      const oddsData = await send(
        { game: ['id'], market: ['name', 'type', 'group_name', 'group_id'], event: ['name', 'price', 'base', 'type_1', 'type'] },
        { game: { id: g.id } },
      );
      const gg = Object.values(oddsData?.game || {})[0];
      const markets = gg ? Object.values(gg.market || {}) : [];
      const parsed = betmomoFlatOdds(markets);
      rows.push({
        id: g.id,
        match: `${g.team1_name} vs ${g.team2_name}`,
        marketTypes: [...new Set(markets.map((m) => m.type))].sort(),
        rawRelevant: markets
          .filter((m) => /tennis|winner|handicap|total|set|odd|even/i.test(`${m.name} ${m.type}`))
          .map(rawBetmomoMarket),
        parsed: summarizeParsed(parsed),
        suspiciousLargeGroups: collisionReport(parsed),
      });
    }
    return rows;
  });
}

async function auditYellowBet() {
  const now = new Date();
  const to = new Date(now.getTime() + HORIZON_HOURS * 3600 * 1000);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const data = await evapi(`${BASE_URL}/event/GetEvents?fromDate=${iso(now)}&toDate=${iso(to)}&skip=0&take=1000&count=1000&pageSize=1000`);
  const events = (data?.data || []).filter((ev) => ev?.sid === 35 && !ev.lv && ev.bts?.length).slice(0, LIMIT);
  return events.map((ev) => {
    const m = toMatch(ev);
    const parsed = yellowbetFlatOdds(ev.bts || []);
    return {
      id: m.id,
      match: `${m.home} vs ${m.away}`,
      league: m.league,
      marketNames: (ev.bts || []).map((bt) => bt.n),
      rawRelevant: (ev.bts || [])
        .filter((bt) => /winner|vainqueur|gagnant|handicap|total|set|jeux|games|odd|even|pair|impair/i.test(bt.n || ''))
        .map(rawYellowMarket),
      parsed: summarizeParsed(parsed),
      suspiciousLargeGroups: collisionReport(parsed),
    };
  });
}

async function auditApollo() {
  const now = new Date().toISOString();
  const dateTo = new Date(Date.now() + HORIZON_HOURS * 3600 * 1000).toISOString();
  const j = await apolloGet(`/sport/offer/v3/sports/offer?Offset=0&Limit=200&DateFrom=${now}&DateTo=${dateTo}&SportIds=${APOLLO_SID.tennis}`);
  const matches = [];
  for (const s of j?.Response || []) for (const c of s.Categories || []) for (const l of c.Leagues || []) {
    for (const m of l.Matches || []) matches.push({ ...m, league: `${c.Name} / ${l.Name}` });
  }
  const rows = [];
  for (const m of matches.slice(0, LIMIT)) {
    const detail = await apolloGet(`/sport/offer/v3/match/offers?MatchId=${m.Id}`);
    const offers = detail?.Offers?.length ? detail.Offers : (detail?.BasicOffer ? [detail.BasicOffer] : []);
    const parsed = apolloFlatOdds(offers);
    rows.push({
      id: m.Id,
      match: `${m.TeamHome} vs ${m.TeamAway}`,
      league: m.league,
      betTypes: [...new Set(offers.map((o) => `${o.BetTypeKey}:${o.BetTypeName || o.Description || ''}`))].sort(),
      rawRelevant: offers
        .filter((o) => /winner|handicap|total|set|games|odd|even/i.test(`${o.BetTypeName || ''} ${o.Description || ''} ${o.BetTypeGroupName || ''}`))
        .map(rawApolloOffer),
      parsed: summarizeParsed(parsed),
      suspiciousLargeGroups: collisionReport(parsed),
    });
  }
  return rows;
}

const results = {};
for (const [key, fn] of [['betmomo', auditBetMomo], ['yellowbet', auditYellowBet], ['apollo', auditApollo]]) {
  try { results[key] = await fn(); } catch (e) { results[key] = { error: e.message }; }
}

console.log('=== TENNIS 3-BOOK AUDIT START ===');
console.log(JSON.stringify(results, null, 2));
console.log('=== TENNIS 3-BOOK AUDIT END ===');
process.exit(0);
