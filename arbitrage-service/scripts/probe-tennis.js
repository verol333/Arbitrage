// Probe tennis : pour chaque bookmaker, teste le sport ID tennis présumé,
// vérifie que les matchs listés SONT bien du tennis (2 joueurs, pas foot),
// et dump les cotes du premier match pour cartographier les marchés.
//
// Approche prudente : PAS d'implémentation dans les listers de production
// avant validation du user.

import { viaWorker as xviaWorker, FEED as XFEED, COUNTRY as XCOUNTRY, PARTNER as XPARTNER } from '../../src/bookmakers/xbet/api.js';
import { xget as scget } from '../../src/bookmakers/sportcash/api.js';
import { evapi as ybevapi, BASE_URL as YBBASE } from '../../src/bookmakers/yellowbet/api.js';
import { apolloGet } from '../../src/bookmakers/apollo/api.js';
import { swarmSession } from '../../src/bookmakers/betmomo/api.js';
import { CONGO_API, congoJson } from '../../src/bookmakers/congobet/api.js';
import { API_BASE as WINBASE, ORIGIN as WINORIG, UA as WINUA, PLATFORM as WINPL } from '../../src/bookmakers/onewin/api.js';

const looksLikeTennis = (h, a) => {
  const s = `${h} ${a}`;
  // Un match tennis a souvent " / " (doubles) ou des noms courts (2-3 tokens)
  // et surtout n'a PAS d'équipes de foot connues (FC, City, United, etc.)
  const footy = /\bfc\b|\bunited\b|\bcity\b|\bathletic\b|club\b|\brovers\b|\bwanderers\b|\bsc\b|\brc\b|\bof\b/i.test(s);
  return !footy;
};

async function probeXbet() {
  const out = { book: '1xbet', sport_id: 2 };
  try {
    const champs = await xviaWorker(`${XFEED}/service-api/LineFeed/GetChampsZip?sport=2&lng=en&country=${XCOUNTRY}&partner=${XPARTNER}`);
    const champIds = [...new Set((champs?.Value || []).map((c) => c.LI || c.CI).filter(Boolean))].slice(0, 5);
    out.champs_found = champIds.length;
    const all = [];
    for (const ci of champIds) {
      const r = await xviaWorker(`${XFEED}/service-api/LineFeed/Get1x2_VZip?champs=${ci}&count=30&lng=en&mode=4&country=${XCOUNTRY}&partner=${XPARTNER}&getEmpty=true`);
      for (const m of (r?.Value || [])) {
        if (m.I && m.O1 && m.O2) all.push({ id: m.I, home: m.O1, away: m.O2, league: m.LE || m.L || '', start: m.S * 1000 });
      }
      if (all.length >= 5) break;
    }
    out.matches_sample = all.slice(0, 5).map((m) => ({ ...m, looks_tennis: looksLikeTennis(m.home, m.away) }));
    if (all[0]) {
      const gd = await xviaWorker(`${XFEED}/service-api/LineFeed/GetGameZip?id=${all[0].id}&lng=fr&isSubGames=false&GroupEvents=true&countevents=500&grMode=4&country=${XCOUNTRY}&marketType=1&isNewBuilder=true`);
      const groups = (gd?.Value?.GE || []).map((g) => ({
        G: g.G,
        events: (g.E || []).flatMap((sub) => Array.isArray(sub) ? sub : [sub]).map((it) => ({ T: it.T, P: it.P, C: it.C })).slice(0, 10),
      }));
      out.first_match_groups = groups.slice(0, 40);
    }
  } catch (e) { out.error = e.message; }
  return out;
}

async function probeOneWin() {
  const out = { book: '1win', sport_id: 12 };
  try {
    const now = Math.floor(Date.now() / 1000);
    const body = { sportId: 12, startAtFrom: now - 3600, startAtTo: now + 3 * 86400, limit: 20, offset: 0, l: 'en-001', p: WINPL };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(`${WINBASE}/matches/get-many`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: WINORIG, Referer: `${WINORIG}/`, 'User-Agent': WINUA },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const data = await res.json();
    const items = data?.result?.items || [];
    out.total_returned = items.length;
    out.matches_sample = items.slice(0, 5).map((m) => ({
      id: m.id,
      home: m.homeTeam?.name || m.competitors?.[0]?.name,
      away: m.awayTeam?.name || m.competitors?.[1]?.name,
      league: m.tournament?.name || m.league?.name,
      sport_id: m.sportId,
    }));
  } catch (e) { out.error = e.message; }
  return out;
}

async function probeCongobet() {
  const out = { book: 'congobet', sport_id: 103 };
  try {
    const items = await congoJson(`${CONGO_API}events?eventCategoryIds=103&offset=0&length=20&fetchEventBetTypesMode=0&betTypeId=10001&l=fr`);
    const list = Array.isArray(items) ? items : (items?.data || []);
    out.total_returned = list.length;
    out.matches_sample = list.slice(0, 5).map((ev) => ({
      id: ev.id, home: ev.homeTeamName, away: ev.awayTeamName,
      league: ev.categoryPath, isVirtual: ev.isVirtual,
    }));
  } catch (e) { out.error = e.message; }
  return out;
}

async function probeYellowBet() {
  const out = { book: 'yellowbet', sport_id: 32 };
  try {
    const now = new Date();
    const to = new Date(now.getTime() + 72 * 3600 * 1000);
    const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const data = await ybevapi(`${YBBASE}/event/GetEvents?sportIds=32&fromDate=${iso(now)}&toDate=${iso(to)}&take=30`);
    const events = Array.isArray(data?.data) ? data.data : [];
    out.total_returned = events.length;
    out.matches_sample = events.slice(0, 5).map((ev) => ({
      id: String(ev.id), home: ev.h, away: ev.a, league: ev.ln, sid: ev.sid,
      first_bts: Array.isArray(ev.bts) ? ev.bts.slice(0, 3).map((b) => ({ id: b.id, n: b.n })) : null,
    }));
  } catch (e) { out.error = e.message; }
  return out;
}

async function probeApollo() {
  const out = { book: 'apollo', sport_id: 389 };
  try {
    const now = new Date().toISOString();
    const dateTo = '2046-04-07T22:59:59.000Z';
    const j = await apolloGet(`/sport/offer/v3/sports/offer?Offset=0&Limit=30&DateFrom=${now}&DateTo=${dateTo}&SportIds=389`);
    const evs = [];
    for (const s of (j?.Response || [])) for (const c of s.Categories || []) for (const l of c.Leagues || []) for (const m of l.Matches || []) {
      evs.push({ id: m.Id, home: m.TeamHome, away: m.TeamAway, league: `${c.Name}/${l.Name}` });
    }
    out.total_returned = evs.length;
    out.matches_sample = evs.slice(0, 5);
    // Try 388 too to compare (was foot).
    const j2 = await apolloGet(`/sport/offer/v3/sports/offer?Offset=0&Limit=5&DateFrom=${now}&DateTo=${dateTo}&SportIds=388`);
    const foot_sample = [];
    for (const s of (j2?.Response || [])) for (const c of s.Categories || []) for (const l of c.Leagues || []) for (const m of l.Matches || []) foot_sample.push({ home: m.TeamHome, away: m.TeamAway });
    out.foot_388_sample = foot_sample.slice(0, 3);
  } catch (e) { out.error = e.message; }
  return out;
}

async function probeBetMomo() {
  const out = { book: 'betmomo', sport_id: 2 };
  try {
    const now = Math.floor(Date.now() / 1000);
    const to = now + 72 * 3600;
    const res = await swarmSession(async (send) => {
      const data = await send(
        { sport: ['id', 'name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'start_ts'] },
        { sport: { id: 2 }, game: { start_ts: { '@gt': now, '@lt': to }, is_live: 0 } },
      );
      const evs = [];
      for (const s of Object.values(data?.sport || {})) {
        out.sport_name = s.name;
        for (const g of Object.values(s.game || {})) evs.push({ ...g, league: '' });
        for (const c of Object.values(s.competition || {})) for (const g of Object.values(c.game || {})) evs.push({ ...g, league: c.name || '' });
      }
      return evs;
    });
    out.total_returned = res.length;
    out.matches_sample = res.slice(0, 5).map((g) => ({
      id: g.id, home: g.team1_name, away: g.team2_name, league: g.league,
    }));
  } catch (e) { out.error = e.message; }
  return out;
}

async function probeSportcash() {
  const out = { book: 'sportcash', label: 'Tennis' };
  try {
    const wc = await scget('getWidgetCentrali', {});
    const evs = [];
    if (wc?.lms) for (const sportKey of Object.keys(wc.lms)) {
      const bucket = wc.lms[sportKey];
      if (bucket?.avs) for (const av of bucket.avs) evs.push({ ...av, __sportKey: sportKey });
    }
    // Filter by ds === Tennis
    const tennis = evs.filter((e) => e.ds === 'Tennis' || e.ds === 'Tennis Homme' || e.ds === 'Tennis Femme');
    out.total_returned = tennis.length;
    out.matches_sample = tennis.slice(0, 5).map((e) => ({ p: e.p, a: e.a, da: e.da, ds: e.ds, dt: e.dt, sportKey: e.__sportKey }));
    // Also test what sport labels exist
    const labels = new Set();
    for (const e of evs) if (e.ds) labels.add(e.ds);
    out.available_labels = [...labels];
  } catch (e) { out.error = e.message; }
  return out;
}

(async () => {
  const results = { at: new Date().toISOString(), probes: {} };
  for (const [name, fn] of [
    ['xbet', probeXbet],
    ['onewin', probeOneWin],
    ['congobet', probeCongobet],
    ['yellowbet', probeYellowBet],
    ['apollo', probeApollo],
    ['betmomo', probeBetMomo],
    ['sportcash', probeSportcash],
  ]) {
    process.stderr.write(`[probe-tennis] ${name}...\n`);
    results.probes[name] = await fn();
  }
  console.log(JSON.stringify(results, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
