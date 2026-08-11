#!/usr/bin/env node
// PROBE Volleyball v3 — investigation ciblee sur suspects.
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { mget } from '../src/bookmakers/premierbet/api.js';
import { apolloGet } from '../src/bookmakers/apollo/api.js';
import { bpFetchList, buildEventsListUrl } from '../src/bookmakers/betpawa/api.js';
import { fetchJson } from '../src/net/fetcher.js';

async function probeCongobetDeep() {
  console.log('\n═══ Congobet DEEP ═══');
  // Suspects prometteurs : 108, 113, 114. Investiguer noms des leagues.
  for (const sid of ['108','113','114','116','119','122','130']) {
    try {
      const cats = await congoJson(`${CONGO_API}eventCategories/${sid}?l=fr`);
      if (!Array.isArray(cats) || !cats.length) continue;
      const allLeagueNames = [];
      const walk = (n) => {
        if (n.subCategories?.length) n.subCategories.forEach(walk);
        else allLeagueNames.push(n.name || '');
      };
      cats.forEach(walk);
      const isVolley = allLeagueNames.some(n => /volley/i.test(n));
      const marker = isVolley ? ' ← VOLLEY!' : '';
      console.log(`  sid=${sid} : ${allLeagueNames.length} leagues${marker}`);
      console.log(`    samples: ${allLeagueNames.slice(0, 5).join(' | ')}`);
    } catch (e) {}
  }
}

async function probePremierBetWide() {
  console.log('\n═══ PremierBet WIDE 21-45 ═══');
  for (const sid of [21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 40, 45]) {
    try {
      const j = await mget('/events/highlights', { sportId: sid });
      const events = [];
      const catNames = new Set();
      for (const cat of (j?.data?.categories || [])) {
        catNames.add(cat.name || '');
        for (const comp of (cat.competitions || [])) events.push(...(comp.events || []));
      }
      if (events.length) {
        const marker = /volley/i.test([...catNames].join(' ')) ? ' ← VOLLEY!' : '';
        console.log(`  sid=${sid} : ${events.length} events (${[...catNames].slice(0, 2).join(', ')})${marker}`);
      }
    } catch (e) {}
  }
}

async function probeApolloWide() {
  console.log('\n═══ Apollo WIDE ═══');
  // Try common tenant sports IDs range
  const now = new Date().toISOString();
  const to = new Date(Date.now() + 72 * 3600_000).toISOString();
  for (const sid of [1, 2, 3, 4, 5, 10, 15, 20, 30, 40, 50, 100, 200, 300, 380, 381, 382, 383, 384, 385, 386, 387, 390, 391, 392, 393, 394, 395, 396, 397, 399, 400, 401, 402, 500]) {
    try {
      const path = `/sport/offer/v3/sports/offer?Offset=0&Limit=3&DateFrom=${now}&DateTo=${to}&SportIds=${sid}`;
      const j = await apolloGet(path);
      const matches = j?.Matches || j?.matches || [];
      if (matches.length) {
        const home = matches[0]?.Home || '';
        const away = matches[0]?.Away || '';
        const league = matches[0]?.LeagueName || matches[0]?.League?.Name || '';
        console.log(`  sid=${sid} : ${matches.length} matches (sample: "${home} vs ${away}" league="${league}")`);
      }
    } catch (e) {}
  }
}

async function probeBetPawaCategoryDiscovery() {
  console.log('\n═══ BetPawa - Category discovery via HTML page ═══');
  // BetPawa expose la liste des categories via une page publique
  try {
    const r = await fetch('https://cg.betpawa.com/events', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) { console.log(`  status=${r.status}`); return; }
    const html = await r.text();
    // Chercher categoryId dans le HTML
    const catPattern = /categoryId=(\d+)[^>]*>([^<]{1,50})</g;
    const seen = new Map();
    let m;
    while ((m = catPattern.exec(html)) !== null) {
      const cid = m[1];
      const name = m[2].trim();
      if (!seen.has(cid)) seen.set(cid, name);
    }
    for (const [cid, name] of seen) {
      const isVolley = /volley/i.test(name);
      if (isVolley) console.log(`  ← VOLLEY! cat=${cid} name="${name}"`);
    }
    console.log(`  ${seen.size} categoryIds trouvees dans HTML page`);
  } catch (e) { console.log(`  err=${e.message}`); }
}

async function probe1winSports() {
  console.log('\n═══ 1win — sport tree via GraphQL/REST ═══');
  // Try common endpoints for 1win
  const { API_BASE, PLATFORM } = await import('../src/bookmakers/onewin/api.js');
  const endpoints = [
    `${API_BASE}/parser/api/v1/prematch/getSports?platformId=${PLATFORM}&language=en-001&country=NG`,
    `${API_BASE}/parser/api/v1/pre-match/sports?externalPartnerId=${PLATFORM}&language=en-001&country=NG`,
    `${API_BASE}/parser/api/v1/prematch/all-sports?externalPartnerId=${PLATFORM}&language=en-001`,
    `${API_BASE}/parser/api/v1/prematch/list?externalPartnerId=${PLATFORM}&language=en-001`,
    `${API_BASE}/parser/api/v1/sports-list?externalPartnerId=${PLATFORM}`,
  ];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const txt = await r.text();
      console.log(`  ${url.split('parser/api/v1/')[1].slice(0, 40)} → ${r.status} len=${txt.length}${txt.length > 5 && txt.length < 200 ? ' body="' + txt.slice(0, 100) + '"' : ''}`);
      if (r.ok && txt.length > 500) {
        // JSON likely
        try {
          const j = JSON.parse(txt);
          const sports = j?.data || j;
          const arr = Array.isArray(sports) ? sports : Object.values(sports || {});
          const volley = arr.filter(s => /volley/i.test((s.name || s.title || '')));
          if (volley.length) {
            for (const v of volley) console.log(`    ← VOLLEY! id=${v.id || v.sportId} name="${v.name || v.title}"`);
          } else {
            console.log(`    ${arr.length} sports total, aucun volleyball`);
          }
        } catch (e) {}
      }
    } catch (e) {}
  }
}

console.log('▶ PROBE Volleyball v3 (investigation ciblee)\n');
await probeCongobetDeep();
await probePremierBetWide();
await probeApolloWide();
await probeBetPawaCategoryDiscovery();
await probe1winSports();
console.log('\n═══ FIN PROBE ═══');
process.exit(0);
