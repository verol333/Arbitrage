#!/usr/bin/env node
// AUDIT marches volleyball par book (7 IDs confirmes).
// Pour chaque book : list matchs volley + fetch 1-2 samples et dump structure marches.

// 1xbet
import { viaWorker, FEED, COUNTRY } from '../src/bookmakers/xbet/api.js';
// 1win
import { API_BASE, ORIGIN, UA, PLATFORM } from '../src/bookmakers/onewin/api.js';
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';
// SportyBet
// BetMomo
import { swarmSession, BETMOMO_SITE_ID } from '../src/bookmakers/betmomo/api.js';
// Apollo
import { apolloGet } from '../src/bookmakers/apollo/api.js';
// Congobet
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
// YellowBet
import { evapi } from '../src/bookmakers/yellowbet/api.js';

// ─── 1xbet volleyball sid=6 ────────────────────────────────────────
async function probe1xbet() {
  console.log('\n═══ 1xbet (sid=6) ═══');
  try {
    const listUrl = `${FEED}/service-api/LineFeed/Get1x2_Zip?count=20&sports=6&lng=fr&tf=6600000&mode=4&country=${COUNTRY}&partner=192&getEmpty=true`;
    const j = await viaWorker(listUrl);
    const items = j?.Value || [];
    console.log(`  ${items.length} matchs listes`);
    if (!items.length) return;
    console.log(`  Samples: ${items.slice(0, 3).map(m => `${m.O1E} vs ${m.O2E}`).join(' | ')}`);
    // Dump odds for sample
    const m = items[0];
    const url = `${FEED}/service-api/LineFeed/GetGameZip?id=${m.CI}&lng=fr&isSubGames=true&GroupEvents=true&countevents=1000&grMode=4&country=${COUNTRY}&marketType=1&isNewBuilder=true`;
    const gd = await viaWorker(url);
    const GE = gd?.Value?.GE || [];
    console.log(`  Match "${m.O1E}" vs "${m.O2E}" (id=${m.CI}) : ${GE.length} groupes distincts`);
    // Dump top groups (par nOutcomes)
    const gStats = GE.map(g => ({ G: g.G, nE: (g.E || []).length, sample: (g.E || [])[0] }))
      .filter(g => g.G != null).sort((a, b) => b.nE - a.nE);
    for (const g of gStats.slice(0, 20)) {
      const s = g.sample;
      console.log(`    G=${g.G} nOut=${g.nE} T=${s?.T ?? '-'} P=${s?.P ?? '-'} C=${s?.C ?? '-'}`);
    }
  } catch (e) { console.log(`  err=${e.message}`); }
}

// ─── 1win sid=27 ────────────────────────────────────────
async function probe1win() {
  console.log('\n═══ 1win (sid=27) ═══');
  try {
    const now = Math.floor(Date.now() / 1000);
    const body = { sportId: 27, startAtFrom: now - 3600, startAtTo: now + 72 * 3600, limit: 5, offset: 0, l: 'en-001', p: PLATFORM };
    const r = await fetch(`${API_BASE}/matches/get-many`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Referer: `${ORIGIN}/`, 'User-Agent': UA },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json();
    const items = j?.result?.items || [];
    console.log(`  ${items.length} matchs listes`);
    if (!items.length) return;
    for (const m of items.slice(0, 3)) {
      const home = m.homeTeam?.name || m.competitors?.[0]?.name || '?';
      const away = m.awayTeam?.name || m.competitors?.[1]?.name || '?';
      console.log(`    "${home}" vs "${away}" [tournament: "${m.tournament?.name || ''}"]`);
    }
    // Fetch odds WS
    const first = items[0];
    console.log(`\n  Fetch odds WS pour id=${first.id}...`);
    const oddsMap = await fetchOddsWS([first.id], { timeoutMs: 20000, quietMs: 3000 });
    const groups = oddsMap.get(first.id) || oddsMap.get(String(first.id));
    if (!groups) { console.log('    ⚠ no groups'); return; }
    const names = Object.keys(groups);
    console.log(`    ${names.length} oddsGroups reçus`);
    for (const n of names.slice(0, 30)) {
      const oddsList = groups[n] || [];
      const sample = oddsList[0];
      console.log(`    "${n}" nOdds=${oddsList.length} sample: name="${sample?.name || ''}" outcome="${sample?.outcome || ''}" cf=${sample?.cf}`);
    }
  } catch (e) { console.log(`  err=${e.message}`); }
}

// ─── SportyBet sr:sport:23 ────────────────────────────────────────
async function probeSportyBet() {
  console.log('\n═══ SportyBet (sr:sport:23) ═══');
  try {
    const listUrl = `https://www.sportybet.com/api/ng/factsCenter/pcUpcomingEvents?sportId=sr%3Asport%3A23&marketId=1%2C18%2C10%2C16&pageSize=5&pageNum=1&timeline=48`;
    const HDR = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/151.0.0.0', Accept: '*/*', 'Accept-Language': 'en', clientid: 'web', operid: '2', platform: 'web' };
    const r = await fetch(listUrl, { headers: HDR, signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    const tournaments = j?.data?.tournaments || [];
    const totalEvents = tournaments.reduce((s, t) => s + (t.events?.length || 0), 0);
    console.log(`  ${tournaments.length} tournaments / ${totalEvents} events`);
    const events = tournaments.flatMap(t => t.events || []);
    if (!events.length) return;
    const first = events[0];
    console.log(`  Sample: "${first.homeTeamName}" vs "${first.awayTeamName}" tourn="${first.sport?.category?.tournament?.name || ''}"`);
    // Fetch full markets
    const fUrl = `https://www.sportybet.com/api/ng/factsCenter/event?eventId=${first.eventId}`;
    const r2 = await fetch(fUrl, { headers: HDR, signal: AbortSignal.timeout(15000) });
    const j2 = await r2.json();
    const markets = j2?.data?.markets || [];
    console.log(`  ${markets.length} markets pour l'event`);
    const byId = new Map();
    for (const m of markets) {
      const mid = String(m.id);
      if (!byId.has(mid)) byId.set(mid, { desc: m.desc || m.name || '', count: 0 });
      byId.get(mid).count++;
    }
    for (const [mid, info] of [...byId.entries()].slice(0, 20)) {
      console.log(`    id=${mid} n=${info.count} desc="${info.desc}"`);
    }
  } catch (e) { console.log(`  err=${e.message}`); }
}

// ─── BetMomo sid=5 ────────────────────────────────────────
async function probeBetMomo() {
  console.log('\n═══ BetMomo (sid=5) ═══');
  try {
    const games = await swarmSession(async (send) => {
      const raw = await send(
        { game: ['id','team1_name','team2_name'] },
        { partner: BETMOMO_SITE_ID, site: BETMOMO_SITE_ID, sport: { id: 5 }, competition: { type: { '@in': [0, 1] } }, game: { type: { '@in': [0, 1] } } }
      );
      return Object.values(raw?.data?.game || {});
    }, { timeoutMs: 25000 });
    console.log(`  ${games.length} matchs volley listes`);
    if (!games.length) return;
    for (const g of games.slice(0, 3)) console.log(`    "${g.team1_name}" vs "${g.team2_name}" id=${g.id}`);
    // Fetch markets for first
    const first = games[0];
    const markets = await swarmSession(async (send) => {
      const raw = await send(
        { market: ['id','type','name','base','main'], event: ['id','name','type','type_1','price','ob_id'] },
        { partner: BETMOMO_SITE_ID, site: BETMOMO_SITE_ID, game: { id: first.id } }
      );
      const gd = raw?.data?.game?.[first.id] || {};
      return Object.values(gd.market || {}).map(m => ({ ...m, _events: Object.values(m.event || {}) }));
    }, { timeoutMs: 25000 });
    console.log(`  ${markets.length} markets pour l'event`);
    for (const m of markets.slice(0, 20)) console.log(`    type="${m.type}" name="${m.name}" base=${m.base ?? '-'} main=${m.main ?? '-'} nEvents=${m._events.length}`);
  } catch (e) { console.log(`  err=${e.message}`); }
}

// ─── Apollo sid=397 ────────────────────────────────────────
async function probeApollo() {
  console.log('\n═══ Apollo (sid=397) ═══');
  try {
    const now = new Date().toISOString();
    const to = new Date(Date.now() + 72 * 3600_000).toISOString();
    const path = `/sport/offer/v3/sports/offer?Offset=0&Limit=5&DateFrom=${now}&DateTo=${to}&SportIds=397`;
    const j = await apolloGet(path);
    const matches = j?.Matches || j?.matches || [];
    console.log(`  ${matches.length} matchs`);
    if (!matches.length) { console.log('  (catalog vide actuellement)'); return; }
    for (const m of matches.slice(0, 3)) console.log(`    "${m.Home}" vs "${m.Away}" league="${m.LeagueName || ''}"`);
    // Fetch offers
    const first = matches[0];
    const offerPath = `/sport/offer/v3/matches/${first.Id}/offer?languageId=en`;
    const offers = await apolloGet(offerPath);
    console.log(`  ${(offers?.Offers || []).length} offers`);
    for (const o of (offers?.Offers || []).slice(0, 15)) {
      const oddsStr = (o.Odds || []).slice(0, 4).map(od => `"${od.Name}"[${od.Type}]=${od.Odd}`).join(' | ');
      console.log(`    BetTypeKey=${o.BetTypeKey} name="${o.BetTypeName || '?'}" sbv="${o.Sbv || '-'}" — ${oddsStr}`);
    }
  } catch (e) { console.log(`  err=${e.message}`); }
}

// ─── Congobet sid=114 ────────────────────────────────────────
async function probeCongobet() {
  console.log('\n═══ Congobet (sid=114) ═══');
  try {
    const j = await congoJson(`${CONGO_API}events?eventCategoryIds=114&offset=0&length=5&l=fr`);
    const events = j?.data?.events || j?.data || [];
    console.log(`  ${events.length} events`);
    if (!events.length) return;
    for (const e of events.slice(0, 3)) {
      const teams = e.eventNames || [];
      console.log(`    "${teams[0]}" vs "${teams[1]}" name="${e.name || ''}"`);
    }
    // Fetch full event
    const first = events[0];
    const raw = await congoJson(`${CONGO_API}events/${first.id}?l=fr`);
    const bts = raw?.eventBetTypes || [];
    console.log(`  ${bts.length} eventBetTypes`);
    for (const bt of bts.slice(0, 20)) {
      const rawId = Number(bt.betTypeId);
      const norm = rawId >= 20000 ? rawId - 10000 : rawId;
      console.log(`    id=${norm} name="${bt.name || bt.betTypeName || ''}" nItems=${(bt.eventBetTypeItems || []).length}`);
    }
  } catch (e) { console.log(`  err=${e.message}`); }
}

// ─── YellowBet sid=323 ────────────────────────────────────────
async function probeYellowBet() {
  console.log('\n═══ YellowBet (sid=323) ═══');
  try {
    const j = await evapi('https://yellowbet.cg/services/evapi/event/GetEvents?skip=0&take=500&count=500');
    const events = j?.data || [];
    const volley = events.filter(e => e.sid === 323 && !e.lv);
    console.log(`  ${volley.length} matchs volley (sur ${events.length} events totaux)`);
    if (!volley.length) return;
    for (const e of volley.slice(0, 3)) console.log(`    "${e.h}" vs "${e.a}" league="${e.ln || ''}"`);
    // Dump markets for first
    const first = volley[0];
    const bt = await evapi(`https://yellowbet.cg/services/evapi/event/GetEventDetails?id=${first.id}`);
    const bts = bt?.data?.bts || [];
    console.log(`  ${bts.length} marches raw`);
    for (const m of bts.slice(0, 20)) console.log(`    id=${m.id} name="${m.n}" nOdds=${(m.odds || []).length}`);
  } catch (e) { console.log(`  err=${e.message}`); }
}

console.log('▶ AUDIT marches volleyball — 7 books\n');
await probe1xbet();
await probe1win();
await probeSportyBet();
await probeBetMomo();
await probeApollo();
await probeCongobet();
await probeYellowBet();
console.log('\n═══ FIN ═══');
process.exit(0);
