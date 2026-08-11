#!/usr/bin/env node
// PROBE Volleyball sport IDs — v2 avec bons endpoints par book.
import { viaWorker, FEED, COUNTRY } from '../src/bookmakers/xbet/api.js';
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { mget } from '../src/bookmakers/premierbet/api.js';
import { apolloGet } from '../src/bookmakers/apollo/api.js';
import { bpFetchList, buildEventsListUrl } from '../src/bookmakers/betpawa/api.js';
import { API_BASE, PLATFORM } from '../src/bookmakers/onewin/api.js';

async function probe1win() {
  console.log('\n═══ 1win ═══');
  // 1win utilise WS + top-parser. Endpoint sport-list REST : /parser/api/v1/prematch/sport-tree
  try {
    const url = `${API_BASE}/parser/api/v1/prematch/sport-tree/all?platformId=${PLATFORM}&language=en-001&country=NG&isCyber=0`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    const sports = j?.data || j || [];
    const arr = Array.isArray(sports) ? sports : Object.values(sports);
    const volley = arr.filter(s => /volley/i.test((s.name || s.sportName || '') + (s.title || '')));
    for (const s of volley) console.log(`  FOUND id=${s.id || s.sportId} name="${s.name || s.title}" matches=${s.matchCount || s.count || '?'}`);
    // fallback : dump all sports
    if (!volley.length) {
      console.log(`  (aucun via sport-tree — dump 20 premiers sports pour info):`);
      for (const s of arr.slice(0, 30)) console.log(`    id=${s.id || s.sportId} name="${s.name || s.title}"`);
    }
  } catch (e) { console.log(`  err=${e.message}`); }
}

async function probeCongobet() {
  console.log('\n═══ Congobet ═══');
  // Tester chaque sportId candidate via eventCategories
  for (const sid of ['104','105','106','107','108','109','110','112','113','114','115','116','117','118','119','120']) {
    try {
      const cats = await congoJson(`${CONGO_API}eventCategories/${sid}?l=fr`);
      if (!Array.isArray(cats) || !cats.length) continue;
      const firstName = (cats[0]?.name || '').toLowerCase();
      const isVolley = /volley/i.test(cats.map(c => c.name || '').join(' '));
      const marker = isVolley ? ' ← VOLLEY' : '';
      const totalEvents = cats.reduce((s, c) => s + (c.eventsCount || 0), 0);
      if (totalEvents > 0 || isVolley) console.log(`  sid=${sid} : first="${cats[0]?.name}" total=${totalEvents}${marker}`);
    } catch (e) {}
  }
}

async function probeApollo() {
  console.log('\n═══ Apollo ═══');
  // Apollo utilise /sport/offer/v3/sports/offer?SportIds=X. Tester 385-400.
  const now = new Date().toISOString();
  const to = new Date(Date.now() + 48 * 3600_000).toISOString();
  for (const sid of [385, 386, 387, 390, 392, 393, 394, 395, 396, 397, 399, 400]) {
    try {
      const path = `/sport/offer/v3/sports/offer?Offset=0&Limit=5&DateFrom=${now}&DateTo=${to}&SportIds=${sid}`;
      const j = await apolloGet(path);
      const matches = j?.Matches || j?.matches || j?.Data || [];
      if (matches.length) {
        const league = matches[0]?.League?.Name || matches[0]?.LeagueName || '';
        const home = matches[0]?.Home || matches[0]?.HomeName || '';
        const away = matches[0]?.Away || matches[0]?.AwayName || '';
        console.log(`  sid=${sid} : ${matches.length} matchs (sample: "${home} vs ${away}" league="${league}")`);
      }
    } catch (e) {}
  }
}

async function probeBetPawa() {
  console.log('\n═══ BetPawa ═══');
  // Foot=2, basket=3, tennis=452 → tester range plus large
  for (const cat of ['4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','30','40','50','100','200','300','400','453','454','455']) {
    try {
      const url = buildEventsListUrl({ eventType: 'UPCOMING', categories: [cat], marketTypes: ['3743','4791','2043818','5000','5009','4895'], skip: 0, take: 5 });
      const strings = await bpFetchList(url);
      const ids = new Set();
      for (let i = 0; i < strings.length; i++) {
        if (/^\d{7,10}$/.test(strings[i])) {
          const name = strings[i + 1] || '';
          if (name.includes(' - ')) ids.add(strings[i]);
        }
      }
      if (ids.size > 0) {
        // Fetch first event details to see sport name
        console.log(`  cat=${cat} : ${ids.size} matchs (sample id=${[...ids][0]})`);
      }
    } catch (e) {}
  }
}

async function probePremierBet() {
  console.log('\n═══ PremierBet ═══');
  // Foot=1, basket=2, baseball=3, hockey=4, tennis=5. Volleyball probable 6-15.
  for (const sid of [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) {
    try {
      const j = await mget('/events/highlights', { sportId: sid });
      const events = [];
      const catNames = new Set();
      for (const cat of (j?.data?.categories || [])) {
        catNames.add(cat.name || '');
        for (const comp of (cat.competitions || [])) events.push(...(comp.events || []));
      }
      if (events.length || catNames.size) {
        const nameStr = [...catNames].slice(0, 2).join(', ');
        const marker = /volley/i.test(nameStr) ? ' ← VOLLEY' : '';
        console.log(`  sid=${sid} : ${events.length} events (cats: ${nameStr})${marker}`);
      }
    } catch (e) {}
  }
}

console.log('▶ PROBE Volleyball v2 (5 books restants)\n');
await probe1win();
await probeCongobet();
await probeApollo();
await probeBetPawa();
await probePremierBet();
console.log('\n═══ FIN PROBE ═══');
process.exit(0);
