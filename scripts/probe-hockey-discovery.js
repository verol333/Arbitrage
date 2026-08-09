#!/usr/bin/env node
// PROBE HOCKEY DISCOVERY — identifier les sport IDs hockey (glace) pour les 9 books.
// Filtre matchs virtuels/cybersport, garde uniquement les ligues reelles :
// NHL, KHL, SHL, Liiga, DEL, Extraliga, IIHF, Champions Hockey League, AHL, etc.
//
// Strategie par book :
//   - Apollo : GET /sport/offer/v3/sports → dump toute la liste, identifier hockey
//   - 1xbet : sport=2 (Ice Hockey standard 1xbet)
//   - 1win : essayer 21, 22, 25, 26, 27 (plage entre foot 18 et basket 23)
//   - CongoBet : parcourir categoryIds 104..130 → dump nom
//   - PremierBet : essayer sportId 3, 4, 6, 7 (plage foot=1, basket=2, tennis=5)
//   - YellowBet : essayer 33..40 (plage voisine de 31/32/35)
//   - BetMomo : sport=2 (Ice Hockey documente dans code)
//   - BetPawa : essayer categoryId 4..20
//   - SportyBet : sr:sport:4 (SportRadar UOF standard)
import { mget } from '../src/bookmakers/premierbet/api.js';
import { CONGO_API, congoJson } from '../src/bookmakers/congobet/api.js';
import { apolloGet } from '../src/bookmakers/apollo/api.js';
import { FEED, COUNTRY, PARTNER, viaWorker } from '../src/bookmakers/xbet/api.js';
import { swarmSession, BETMOMO_SITE_ID } from '../src/bookmakers/betmomo/api.js';
import { BASE_URL, evapi } from '../src/bookmakers/yellowbet/api.js';
import { API_BASE, PLATFORM, UA, ORIGIN } from '../src/bookmakers/onewin/api.js';
import { bpFetchList, buildEventsListUrl } from '../src/bookmakers/betpawa/api.js';

// Filtres pour reperer les vraies ligues hockey (real vs virtual/cyber)
const HOCKEY_KEYWORDS = /nhl|khl|shl|liiga|del\b|extraliga|iihf|champions hockey|ahl|echl|ohl|whl|qmjhl|magnitogorsk|torpedo|dynamo|salavat|helsinki|hifk|jokerit|frolunda|skelleftea|djurgarden|linkoping|malmo|farjestad|luleå|orebro|hockey allsvenskan|ligue magnus|elite league|british elite/i;
const VIRTUAL_RE = /\bsrl\b|simulated|\besoccer\b|\bcyber\b|\bvirtual\b|\besports?\b|\bfifa\b|e-?hockey/i;

function isRealHockey(txt) {
  const s = String(txt || '');
  if (VIRTUAL_RE.test(s)) return false;
  return true; // On log tout ce qui n'est pas virtuel — l'user validera visuellement
}

async function safeAwait(promise, label) {
  try { return await promise; }
  catch (e) { console.log(`  ✗ ${label} ERR: ${e.message}`); return null; }
}

console.log('▶ PROBE HOCKEY DISCOVERY — 9 books\n');

// ═══════════════════════════════════════════════════════════════
// APOLLO — GET /sport/offer/v3/sports pour lister toutes les sports
// ═══════════════════════════════════════════════════════════════
console.log('════════════ APOLLO ════════════\n');
try {
  const sports = await apolloGet('/sport/offer/v3/sports');
  const list = sports?.data || sports?.Data || sports?.sports || (Array.isArray(sports) ? sports : []);
  console.log(`  ${list.length} sports listes`);
  for (const s of list) {
    const name = s.name || s.Name || s.title || '?';
    const id = s.id || s.Id || s.sportId || '?';
    console.log(`  sportId=${id}  "${name}"`);
  }
  // Cherche hockey
  const hockeySport = list.find((s) => /hockey|nhl/i.test(s.name || s.Name || ''));
  if (hockeySport) {
    const hid = hockeySport.id || hockeySport.Id || hockeySport.sportId;
    console.log(`\n  ✓ HOCKEY : sportId=${hid}`);
    // Fetch quelques matchs
    const now = new Date().toISOString().slice(0, 19);
    const dateTo = new Date(Date.now() + 72 * 3600 * 1000).toISOString().slice(0, 19);
    const evts = await apolloGet(`/sport/offer/v3/sports/offer?Offset=0&Limit=20&DateFrom=${now}&DateTo=${dateTo}&SportIds=${hid}`);
    const matches = evts?.data || evts?.Data || [];
    console.log(`  ${matches.length} matchs hockey trouves (72h)`);
    for (const m of matches.slice(0, 10)) {
      const league = m.competitionName || m.leagueName || m.tournamentName || m.CompetitionName || '?';
      const home = m.homeTeamName || m.HomeTeamName || m.team1 || m.homeName || '?';
      const away = m.awayTeamName || m.AwayTeamName || m.team2 || m.awayName || '?';
      console.log(`    [${league}] ${home} vs ${away}  ${isRealHockey(`${home} ${away} ${league}`) ? '' : '(virtuel)'}`);
    }
  } else {
    console.log(`  ✗ Aucun sport nomme hockey`);
  }
} catch (e) { console.log(`  ERR: ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 1XBET — sportId=2 (Ice Hockey standard)
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ 1XBET ════════════\n');
try {
  const champs = await viaWorker(`${FEED}/service-api/LineFeed/GetChampsZip?sport=2&lng=en&country=${COUNTRY}&partner=${PARTNER}`);
  const list = champs?.Value || [];
  console.log(`  sportId=2 : ${list.length} championnats`);
  for (const c of list.slice(0, 15)) console.log(`    "${c.LE || c.L}" (id=${c.LI || c.CI}, ${c.CI || 0} events)`);
  // Top100 direct
  const top = await viaWorker(`${FEED}/service-api/LineFeed/Get1x2_VZip?sports=2&count=30&lng=en&mode=4&country=${COUNTRY}&partner=${PARTNER}&getEmpty=true`);
  const matches = top?.Value || [];
  console.log(`\n  Top ${matches.length} matchs hockey :`);
  for (const m of matches.slice(0, 10)) {
    console.log(`    [${m.LE || m.L}] ${m.O1} vs ${m.O2}`);
  }
} catch (e) { console.log(`  ERR: ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// CONGOBET — parcourir eventCategoryIds pour trouver hockey
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ CONGOBET ════════════\n');
try {
  // Dump top-level categories
  const cats = await congoJson(`${CONGO_API}eventCategories?l=fr`);
  if (Array.isArray(cats)) {
    console.log(`  ${cats.length} top-level categories`);
    for (const c of cats) {
      const isH = /hockey|nhl|glace|ice/i.test(c.name || '');
      console.log(`    id=${c.id} "${c.name}"${isH ? '  ★ HOCKEY ?' : ''}  (${c.eventsCount || 0} events)`);
    }
    const hCat = cats.find((c) => /hockey|glace|ice/i.test(c.name || ''));
    if (hCat) {
      console.log(`\n  ✓ Hockey cat found: id=${hCat.id}`);
      const evts = await congoJson(`${CONGO_API}events?eventCategoryIds=${hCat.id}&offset=0&length=20&l=fr`);
      const items = Array.isArray(evts) ? evts : (evts?.data || []);
      console.log(`  ${items.length} matchs :`);
      for (const ev of items.slice(0, 10)) {
        console.log(`    [${ev.categoryPath}] ${ev.homeTeamName} vs ${ev.awayTeamName}`);
      }
    }
  } else {
    console.log('  eventCategories root pas dispo — fallback probe IDs 104..115');
    for (const id of [104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115]) {
      const cats2 = await congoJson(`${CONGO_API}eventCategories/${id}?l=fr`);
      if (Array.isArray(cats2) && cats2.length) {
        const name = cats2[0]?.name || cats2[0]?.categoryPath || '';
        console.log(`    catId=${id} → "${name}" (${cats2[0]?.eventsCount || 0} events)`);
      }
    }
  }
} catch (e) { console.log(`  ERR: ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// PREMIERBET (guineegames) — essayer sportId candidats
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ PREMIERBET (guineegames) ════════════\n');
try {
  // Endpoint /sports pour lister tout
  const sports = await mget('/sports', {}, 15000);
  const list = sports?.data || sports?.Data || (Array.isArray(sports) ? sports : []);
  if (list.length) {
    console.log(`  ${list.length} sports listes :`);
    for (const s of list.slice(0, 30)) {
      const isH = /hockey|nhl|glace|ice/i.test(s.name || '');
      console.log(`    id=${s.id} "${s.name}"${isH ? '  ★' : ''}`);
    }
    const hSport = list.find((s) => /hockey|glace|ice/i.test(s.name || ''));
    if (hSport) {
      console.log(`\n  ✓ HOCKEY : sportId=${hSport.id}`);
      const date = new Date().toISOString().slice(0, 10);
      const evts = await mget('/events/highlights', { sportId: String(hSport.id) }, 15000);
      const evList = evts?.data?.events || evts?.data || [];
      console.log(`  ${evList.length} matchs highlights hockey :`);
      for (const ev of evList.slice(0, 10)) {
        const names = ev.eventNames || ev.names || [];
        console.log(`    ${names.join(' vs ')} [${ev.competitionName || ev.categoryName || ''}]`);
      }
    }
  } else {
    console.log('  /sports non dispo — probe sportId 3,4,6,7,8');
    for (const sid of [3, 4, 6, 7, 8, 9, 10]) {
      const evts = await mget('/events/highlights', { sportId: String(sid) }, 10000);
      const events = evts?.data?.events || evts?.data || [];
      if (events.length) {
        const first = events[0];
        const names = first.eventNames || first.names || [];
        console.log(`    sportId=${sid} → ${events.length} events, ex: ${names.join(' vs ')} [${first.competitionName || ''}]`);
      }
    }
  }
} catch (e) { console.log(`  ERR: ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// YELLOWBET — probe wide dump pour reperer hockey sport IDs
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ YELLOWBET ════════════\n');
try {
  const data = await evapi(`${BASE_URL}/event/GetEvents?skip=0&take=500&count=500`);
  const events = Array.isArray(data?.data) ? data.data : [];
  console.log(`  ${events.length} events fetches`);
  const groups = {}; // sid → { name, count, examples }
  for (const ev of events) {
    const sid = ev.sid;
    const sn = ev.sn || '?';
    if (!groups[sid]) groups[sid] = { name: sn, count: 0, examples: [] };
    groups[sid].count++;
    if (groups[sid].examples.length < 2) groups[sid].examples.push(`${ev.t1 || ev.hn} vs ${ev.t2 || ev.an} [${ev.cn || ''}]`);
  }
  console.log(`  ${Object.keys(groups).length} sports uniques :`);
  for (const [sid, g] of Object.entries(groups).sort((a, b) => b[1].count - a[1].count)) {
    const isH = /hockey|nhl|glace|ice/i.test(g.name);
    console.log(`    sid=${sid} "${g.name}" (${g.count} events)${isH ? '  ★' : ''}`);
    if (isH) for (const ex of g.examples) console.log(`       ${ex}`);
  }
} catch (e) { console.log(`  ERR: ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// BETMOMO — sportId=2 (Ice Hockey documente)
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ BETMOMO ════════════\n');
try {
  const res = await swarmSession(async (send) => {
    // Fetch sport list
    const sportsData = await send({ sport: ['id', 'name', 'alias'] }, {});
    const sports = Object.values(sportsData?.sport || {});
    console.log(`  ${sports.length} sports SWARM :`);
    for (const s of sports.slice(0, 20)) {
      const isH = /hockey|nhl|glace|ice/i.test(s.name || '');
      console.log(`    sid=${s.id} "${s.name}" (alias=${s.alias})${isH ? '  ★' : ''}`);
    }
    // Fetch matchs sportId=2 (hockey)
    const oddsData = await send(
      { sport: ['id'], region: ['name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'is_live', 'start_ts', 'info'] },
      { sport: { id: { '@eq': 2 } } },
    );
    const games = [];
    for (const s of Object.values(oddsData?.sport || {})) {
      for (const r of Object.values(s.region || {})) {
        for (const c of Object.values(r.competition || {})) {
          for (const g of Object.values(c.game || {})) {
            games.push({ ...g, league: c.name, region: r.name });
          }
        }
      }
    }
    console.log(`\n  ${games.length} matchs sportId=2 (hockey ?)`);
    for (const g of games.slice(0, 10)) {
      console.log(`    [${g.region}/${g.league}] ${g.team1_name} vs ${g.team2_name}${g.is_live ? ' LIVE' : ''}`);
    }
    return sports.length;
  });
} catch (e) { console.log(`  ERR: ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// BETPAWA — probe categoryId 4..20 (hockey inconnu)
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ BETPAWA ════════════\n');
try {
  for (const catId of ['4', '5', '6', '7', '8', '9', '10', '11', '12', '15', '20']) {
    const url = buildEventsListUrl({ eventType: 'UPCOMING', categories: [catId], marketTypes: ['3743', '4791'], skip: 0, take: 20 });
    const strings = await bpFetchList(url, 10000);
    if (!strings.length) continue;
    // Cherche strings type "team - team" + noms de league
    const teams = strings.filter((s) => / - /.test(s) && s.length < 60).slice(0, 5);
    const hockeyStrings = strings.filter((s) => /hockey|nhl|khl/i.test(s)).slice(0, 3);
    if (teams.length || hockeyStrings.length) {
      console.log(`  catId=${catId} :`);
      for (const t of teams) console.log(`    ${t}`);
      if (hockeyStrings.length) console.log(`    HOCKEY MATCH : ${hockeyStrings.join(' | ')}`);
    }
  }
} catch (e) { console.log(`  ERR: ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// SPORTYBET — sr:sport:4 (Ice Hockey SportRadar UOF)
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ SPORTYBET ════════════\n');
try {
  const ts = Date.now();
  const url = `https://www.sportybet.com/api/ng/factsCenter/pcUpcomingEvents?sportId=${encodeURIComponent('sr:sport:4')}&marketId=219,225,229&pageSize=30&pageNum=1&option=1&timeline=72&sortOption=SORT_BY_DEFAULT&_t=${ts}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Referer': 'https://www.sportybet.com/ng/sport/ice-hockey',
      'clientid': 'web', 'operid': '2', 'platform': 'web',
    },
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json();
  const tournaments = j?.data?.tournaments || [];
  let totalEvents = 0;
  console.log(`  ${tournaments.length} tournaments hockey :`);
  for (const t of tournaments.slice(0, 10)) {
    console.log(`    "${t.name}" (${t.events?.length || 0} matchs)`);
    for (const ev of (t.events || []).slice(0, 3)) {
      console.log(`       ${ev.homeTeamName} vs ${ev.awayTeamName}`);
      totalEvents++;
    }
  }
  console.log(`  Total matchs affiches : ${totalEvents}`);
} catch (e) { console.log(`  ERR: ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 1WIN — probe sport IDs plage 15..40
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ 1WIN ════════════\n');
try {
  for (const sid of [3, 15, 16, 17, 19, 20, 21, 22, 25, 26, 27, 28, 30, 31, 32]) {
    const url = `${API_BASE}/service-line/api/v1/menu/left-menu/prematch?platform=${PLATFORM}&sportId=${sid}&limit=10&offset=0&lang=en`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Origin': ORIGIN, 'Referer': ORIGIN + '/' }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const j = await res.json();
      const sport = j?.data?.sport || j?.sport || null;
      const champs = j?.data?.championships || j?.championships || [];
      if (sport?.name || champs.length) {
        const isH = /hockey|nhl|glace|ice/i.test(sport?.name || '');
        console.log(`  sportId=${sid} "${sport?.name || '?'}" (${champs.length} champs)${isH ? '  ★' : ''}`);
        if (isH) for (const c of champs.slice(0, 5)) console.log(`     ${c.name}`);
      }
    } catch { /* skip */ }
  }
} catch (e) { console.log(`  ERR: ${e.message}`); }

console.log('\n═══ FIN PROBE HOCKEY — utilise ces sport IDs pour ajouter le mapping hockey aux books ═══');
process.exit(0);
