#!/usr/bin/env node
// PROBE Volleyball v5 — dump equipes 1win + confirm Congobet 114.
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { API_BASE, ORIGIN, UA, PLATFORM } from '../src/bookmakers/onewin/api.js';

async function probe1winTeams() {
  console.log('\n═══ 1win — dump teams par sportId ═══');
  const now = Math.floor(Date.now() / 1000);
  for (const sid of [22, 25, 27, 34, 78]) {
    try {
      const body = { sportId: sid, startAtFrom: now - 3600, startAtTo: now + 72 * 3600, limit: 5, offset: 0, l: 'en-001', p: PLATFORM };
      const r = await fetch(`${API_BASE}/matches/get-many`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Referer: `${ORIGIN}/`, 'User-Agent': UA },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      const items = j?.result?.items || [];
      if (!items.length) continue;
      console.log(`\n  sid=${sid} : ${items.length} matchs — samples:`);
      for (const m of items.slice(0, 4)) {
        const home = m.homeTeam?.name || m.competitors?.[0]?.name || m.team1?.name || '?';
        const away = m.awayTeam?.name || m.competitors?.[1]?.name || m.team2?.name || '?';
        const league = m.tournament?.name || m.league?.name || m.category?.slug || m.categorySlug || '?';
        const cat = m.category?.name || m.sport?.name || '?';
        console.log(`    "${home}" vs "${away}" [tourn: "${league}", cat: "${cat}"]`);
      }
    } catch (e) { console.log(`  sid=${sid} err=${e.message}`); }
  }
}

async function probeCongobet114() {
  console.log('\n═══ Congobet sid=114 — dump complet leagues ═══');
  try {
    const cats = await congoJson(`${CONGO_API}eventCategories/114?l=fr`);
    console.log(`  ${cats?.length || 0} categories root`);
    for (const cat of (cats || [])) {
      console.log(`  ▸ "${cat.name}" (${cat.eventsCount || 0} events)`);
      for (const sub of (cat.subCategories || []).slice(0, 5)) {
        console.log(`    └─ "${sub.name}" (${sub.eventsCount || 0})`);
      }
    }
    // Aussi fetch un event pour confirmer c'est volleyball
    const ev = await congoJson(`${CONGO_API}events?eventCategoryIds=114&offset=0&length=3&l=fr`);
    const events = ev?.data?.events || ev?.data || ev?.events || [];
    console.log(`\n  Sample events:`);
    for (const e of events.slice(0, 3)) {
      const teams = e.eventNames || [];
      console.log(`    "${teams[0]}" vs "${teams[1] || '?'}" [name: "${e.name || e.title || ''}"]`);
    }
  } catch (e) { console.log(`  err=${e.message}`); }
}

async function probePremierBetCatalog() {
  console.log('\n═══ PremierBet — dump categories page HTML sports ═══');
  // Try to scrape the HTML sports page from guineegames.com to identify volleyball sportId
  const HDR = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0',
    Accept: 'text/html',
  };
  const urls = [
    'https://www.guineegames.com/sports',
    'https://www.guineegames.com/sports/en',
    'https://sports-api.guineegames.com/v1/sports?country=GN&group=g6&platform=desktop&locale=fr',
    'https://sports-api.guineegames.com/v1/config?country=GN&group=g6&platform=desktop&locale=fr',
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(10000) });
      const txt = await r.text();
      const volley = txt.match(/(?:volley[^"]*|"volley[^"]*")/gi);
      console.log(`  ${url.split('.com/')[1] || url.split('.net/')[1]} → ${r.status} len=${txt.length} volley-refs=${volley?.length || 0}`);
      if (volley && volley.length) {
        console.log(`    samples: ${[...new Set(volley)].slice(0, 5).join(' | ')}`);
        // Try to find sportId associated
        const near = txt.match(/(?:sportId["'\s:]{1,10}\d+[^}]{0,100}[Vv]olley|[Vv]olley[^{]{0,50}sportId["'\s:]{1,10}\d+)/g);
        if (near) console.log(`    NEAR sportId: ${near.slice(0, 2).join(' || ')}`);
      }
    } catch (e) {}
  }
}

async function probeBetPawaCatalog() {
  console.log('\n═══ BetPawa — probe HTML sports page ═══');
  const HDR = {
    'x-pawa-brand': 'betpawa-congobrazzaville',
    'x-pawa-language': 'fr',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0',
    Accept: 'text/html',
  };
  const urls = [
    'https://cg.betpawa.com/events?marketId=1X2',
    'https://cg.betpawa.com/sports',
    'https://cg.betpawa.com/api/sportsbook/v4/sports-list',
    'https://cg.betpawa.com/api/sportsbook/v4/mainpage',
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(10000) });
      const txt = await r.text();
      const volley = txt.match(/(?:volley[^"]{0,40})/gi);
      console.log(`  ${url.split('.com/')[1]} → ${r.status} len=${txt.length} volley-refs=${volley?.length || 0}`);
      if (volley && volley.length) {
        console.log(`    samples: ${[...new Set(volley)].slice(0, 4).join(' | ')}`);
        // near category
        const near = txt.match(/(?:categoryId["'\s=:]{1,10}\d+[^}]{0,100}[Vv]olley|[Vv]olley[^{]{0,80}categoryId["'\s=:]{1,10}\d+)/g);
        if (near) console.log(`    NEAR cat: ${near.slice(0, 2).join(' || ')}`);
      }
    } catch (e) {}
  }
}

console.log('▶ PROBE Volleyball v5 (dump teams + confirmations)\n');
await probe1winTeams();
await probeCongobet114();
await probePremierBetCatalog();
await probeBetPawaCatalog();
console.log('\n═══ FIN ═══');
process.exit(0);
