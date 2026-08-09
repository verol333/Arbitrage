#!/usr/bin/env node
// PROBE HOCKEY DISCOVERY v2 — focus 4 books non identifies (CongoBet, PremierBet, 1win, BetPawa)
// v1 a confirme : Apollo=398, 1xbet=2, BetMomo=2, SportyBet=sr:sport:4, YellowBet=absent
import { CONGO_API, congoJson } from '../src/bookmakers/congobet/api.js';
import { mget } from '../src/bookmakers/premierbet/api.js';
import { API_BASE, ORIGIN, UA, PLATFORM } from '../src/bookmakers/onewin/api.js';
import { bpFetchList, buildEventsListUrl } from '../src/bookmakers/betpawa/api.js';

console.log('▶ PROBE HOCKEY v2 — 4 books restants\n');

// ═══════════════════════════════════════════════════════════════
// CONGOBET — parcourir plus large + endpoint /sports natif
// ═══════════════════════════════════════════════════════════════
console.log('════════════ CONGOBET ════════════\n');
try {
  // /sports natif
  const sports = await congoJson(`${CONGO_API}sports?l=fr`);
  if (Array.isArray(sports)) {
    console.log(`  ${sports.length} sports natifs :`);
    for (const s of sports.slice(0, 30)) {
      const isH = /hockey|glace|ice/i.test(s.name || '');
      console.log(`    id=${s.id} "${s.name}"${isH ? '  ★' : ''}`);
    }
    const h = sports.find((s) => /hockey|glace|ice/i.test(s.name || ''));
    if (h) {
      console.log(`\n  ✓ HOCKEY sport : id=${h.id}`);
      // Fetch events pour ce sport
      const evts = await congoJson(`${CONGO_API}events?eventCategoryIds=${h.id}&offset=0&length=30&l=fr`);
      const items = Array.isArray(evts) ? evts : (evts?.data || []);
      console.log(`  ${items.length} matchs :`);
      for (const ev of items.slice(0, 10)) {
        console.log(`    [${ev.categoryPath}] ${ev.homeTeamName} vs ${ev.awayTeamName}`);
      }
    }
  } else {
    console.log(`  /sports pas dispo (${typeof sports}) — probe wide categoryIds`);
  }
  // Probe wide plage plus large 106..200
  console.log('\n  Wide probe eventCategoryIds :');
  for (const id of [106, 112, 115, 116, 117, 118, 119, 120, 121, 125, 130, 140, 150, 200]) {
    try {
      const cats = await congoJson(`${CONGO_API}eventCategories/${id}?l=fr`);
      if (Array.isArray(cats) && cats.length) {
        const name = cats[0]?.name || '?';
        const cnt = cats[0]?.eventsCount || 0;
        const isH = /hockey|glace|ice/i.test(name);
        if (cnt || isH) console.log(`    catId=${id} → "${name}" (${cnt} events)${isH ? '  ★' : ''}`);
      }
    } catch { /* ignore */ }
  }
} catch (e) { console.log(`  ERR: ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// PREMIERBET (guineegames) — probe /events/highlights avec sportId varies
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ PREMIERBET ════════════\n');
try {
  // Tenter /categories ou /sports alternatives
  for (const path of ['/categories', '/sports/categories', '/tree']) {
    const r = await mget(path, {}, 8000);
    if (r) console.log(`  ${path} → OK, keys=${Object.keys(r).slice(0, 5).join(',')}`);
  }
  // Probe wide sportIds 2..30 sur /events/highlights (basket=2 est connu)
  console.log('\n  Probe wide /events/highlights sportId 2..30 :');
  for (const sid of [3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 25, 30]) {
    try {
      const j = await mget('/events/highlights', { sportId: String(sid) }, 6000);
      // Structure retour connue : data.categories[].competitions[].events[]
      const cats = j?.data?.categories || j?.categories || [];
      let totalEvents = 0;
      let sampleName = '';
      for (const c of cats) {
        for (const cp of (c.competitions || [])) {
          totalEvents += (cp.events || []).length;
          if (!sampleName && cp.events?.length) {
            const ev = cp.events[0];
            sampleName = `${ev.eventNames?.join(' vs ') || ev.name} [${cp.name || c.name}]`;
          }
        }
      }
      if (totalEvents) {
        console.log(`    sportId=${sid} → ${totalEvents} matchs, ex: ${sampleName}`);
      }
    } catch { /* ignore */ }
  }
} catch (e) { console.log(`  ERR: ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 1WIN — vrai endpoint /matches/get-many (comme dans list.js)
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ 1WIN ════════════\n');
try {
  const now = Math.floor(Date.now() / 1000);
  // Hockey standard 1xbet=2 ; 1win peut avoir 2, 3, 4, 19, 25, 28
  for (const sid of [2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 19, 25, 28, 34]) {
    try {
      const body = { sportId: sid, startAtFrom: now - 3600, startAtTo: now + 3 * 86400, limit: 30, offset: 0, l: 'en-001', p: PLATFORM };
      const res = await fetch(`${API_BASE}/matches/get-many`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Referer: ORIGIN + '/', 'User-Agent': UA },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const j = await res.json();
      const items = j?.result?.items || [];
      if (items.length) {
        const first = items[0];
        const home = first.homeTeam?.name || first.competitors?.[0]?.name;
        const away = first.awayTeam?.name || first.competitors?.[1]?.name;
        const lg = first.tournament?.name || first.league?.name || first.category?.slug || '?';
        console.log(`  sportId=${sid} → ${items.length} matchs, ex: ${home} vs ${away} [${lg}]`);
      }
    } catch { /* ignore */ }
  }
} catch (e) { console.log(`  ERR: ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// BETPAWA — probe categoryId plage large + variant marketTypes
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ BETPAWA ════════════\n');
try {
  // Essayer sans filtre marketTypes (empty array = tout)
  console.log('  Sans filtre marketTypes, catIds 4..30 :');
  for (const catId of ['4', '5', '6', '7', '8', '10', '11', '12', '13', '15', '20', '25', '30']) {
    try {
      const url = buildEventsListUrl({ eventType: 'UPCOMING', categories: [catId], marketTypes: [], skip: 0, take: 20 });
      const strings = await bpFetchList(url, 6000);
      const teams = strings.filter((s) => / - /.test(s) && s.length < 60).slice(0, 3);
      const hockeyKw = strings.filter((s) => /hockey|nhl|khl|shl/i.test(s)).slice(0, 3);
      if (teams.length) {
        console.log(`    catId=${catId} :`);
        for (const t of teams) console.log(`      ${t}`);
        if (hockeyKw.length) console.log(`      ★ HOCKEY : ${hockeyKw.join(' | ')}`);
      }
    } catch { /* ignore */ }
  }
} catch (e) { console.log(`  ERR: ${e.message}`); }

console.log('\n═══ FIN PROBE v2 ═══');
process.exit(0);
