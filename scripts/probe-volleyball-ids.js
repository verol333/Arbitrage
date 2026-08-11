#!/usr/bin/env node
// PROBE Volleyball sport IDs sur tous les books.
// Teste plusieurs IDs candidats par book, log le count de matchs.
import { viaWorker, FEED, COUNTRY } from '../src/bookmakers/xbet/api.js';
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { mget } from '../src/bookmakers/premierbet/api.js';
import { apolloGet, APOLLO_SID } from '../src/bookmakers/apollo/api.js';
import { evapi } from '../src/bookmakers/yellowbet/api.js';
import { swarmSession, BETMOMO_SITE_ID } from '../src/bookmakers/betmomo/api.js';
import { bpFetchList, buildEventsListUrl } from '../src/bookmakers/betpawa/api.js';

// ═══════════════════════════════════════════════════════════════
// Candidates volleyball IDs par book (issus des commentaires + logique).
// ═══════════════════════════════════════════════════════════════
async function probe1xbet() {
  console.log('\n═══ 1xbet ═══');
  // Foot=1, hockey=2, basket=3, tennis=4 → volleyball probablement 5, 6, ou 12
  for (const sid of [5, 6, 12, 25, 91]) {
    try {
      const url = `${FEED}/service-api/LineFeed/Get1x2_Zip?count=200&sports=${sid}&lng=fr&tf=6600000&mode=4&country=${COUNTRY}&partner=${192}&getEmpty=true`;
      const j = await viaWorker(url);
      const items = j?.Value || [];
      const sports = new Set(items.map(x => x.SN || '?').filter(Boolean));
      console.log(`  sid=${sid} : ${items.length} events (sports names: ${[...sports].slice(0, 3).join(', ') || 'none'})`);
    } catch (e) { console.log(`  sid=${sid} err=${e.message}`); }
  }
}

async function probe1win() {
  console.log('\n═══ 1win ═══');
  // Foot=18, basket=23, TT=24, tennis=33, hockey=35 → volleyball ?
  // WTT Table Tennis is 24, so volleyball probably around 27, 34, 36
  const { API_BASE, PLATFORM } = await import('../src/bookmakers/onewin/api.js');
  for (const sid of [22, 25, 27, 34, 36, 55, 78]) {
    try {
      const url = `${API_BASE}/parser/api/v1/prematch/sports?externalPartnerId=${PLATFORM}&language=en-001&country=NG&isCyber=0`;
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      const s = (j?.data || []).find(x => x.id === sid);
      if (s) console.log(`  sid=${sid} : ${s.name || '?'} (${s.matchCount || '?'} matchs)`);
    } catch (e) { console.log(`  sid=${sid} err=${e.message}`); }
  }
  // Alt : lister TOUS les sports pour trouver volleyball par nom
  try {
    const url = `${API_BASE}/parser/api/v1/prematch/sports?externalPartnerId=${PLATFORM}&language=en-001&country=NG&isCyber=0`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    const volley = (j?.data || []).filter(s => /volley/i.test(s.name || ''));
    console.log(`  DISCOVERY : ${volley.map(s => `id=${s.id} name="${s.name}" (${s.matchCount || 0})`).join(' | ') || 'aucun volleyball trouve'}`);
  } catch (e) { console.log(`  discovery err=${e.message}`); }
}

async function probeCongobet() {
  console.log('\n═══ Congobet ═══');
  // Foot=101, basket=102, tennis=103, hockey=111 → volleyball ?
  // Try listing all categories to find volleyball
  try {
    const j = await congoJson(`${CONGO_API}eventCategoriesTreeCounts?l=fr`);
    const cats = j?.data?.eventCategoriesTree || j?.data || j?.eventCategoriesTree || [];
    const findVolley = (arr, path = '') => {
      for (const c of (arr || [])) {
        const name = (c.name || c.Name || c.label || '').toLowerCase();
        if (name.includes('volley')) console.log(`  FOUND id=${c.id} name="${c.name || c.Name}" path=${path}`);
        if (c.children || c.subCategories) findVolley(c.children || c.subCategories, `${path}/${c.name}`);
      }
    };
    findVolley(cats);
  } catch (e) { console.log(`  err=${e.message}`); }
  // Alt : test IDs directs
  for (const sid of ['104','105','106','107','108','109','110','112','113','114','115']) {
    try {
      const j = await congoJson(`${CONGO_API}events?eventCategoryIds=${sid}&offset=0&length=5&l=fr`);
      const events = (j?.data?.events || j?.data || []);
      if (events.length) console.log(`  sid=${sid} : ${events.length} events (sample: "${events[0]?.name || events[0]?.title || ''}")`);
    } catch (e) {}
  }
}

async function probeApollo() {
  console.log('\n═══ Apollo ═══');
  // Foot, tennis, basket, hockey=398. Volleyball ?
  // Apollo utilise sportId numerique (foot ~1?, basket ~101?, hockey=398)
  // Trying common Apollo sportIds
  // Apollo SIDs connus : foot=388, tennis=389, basket=391, hockey=398
  // Volleyball probablement dans plage 385-400
  for (const sid of [385, 386, 387, 390, 392, 393, 394, 395, 396, 397, 399, 400]) {
    try {
      const path = `/sportsofferapi/v1/sports/${sid}/leagues/list?languageId=en&responseGrouping=classic`;
      const j = await apolloGet(path);
      const total = j?.leagues?.length || j?.data?.length || 0;
      if (total > 0) console.log(`  sid=${sid} : ${total} leagues`);
    } catch (e) {}
  }
}

async function probeBetMomo() {
  console.log('\n═══ BetMomo ═══');
  // Deja documente : volleyball = 5 (dans commentaire api.js)
  try {
    const result = await swarmSession(async (send) => {
      const raw = await send({ sport: {} }, { partner: BETMOMO_SITE_ID, site: BETMOMO_SITE_ID });
      return raw?.data?.sport || {};
    }, { timeoutMs: 25000 });
    const sports = Object.values(result);
    const volley = sports.filter(s => /volley/i.test(s.name || ''));
    for (const s of volley) console.log(`  FOUND id=${s.id} name="${s.name}" matches=${s.game_count || s.count || '?'}`);
    if (!volley.length) console.log('  (via sport list) : aucun match volleyball dans catalogue actuel');
  } catch (e) { console.log(`  err=${e.message}`); }
}

async function probeYellowBet() {
  console.log('\n═══ YellowBet ═══');
  // Deja documente : volleyball = 323 dans commentaire list.js
  try {
    const j = await evapi(`https://yellowbet.cg/services/evapi/event/GetEvents?skip=0&take=500&count=500`);
    const events = j?.data || [];
    const bySid = new Map();
    for (const ev of events) {
      const sid = ev.sid, sn = ev.sn || '';
      if (!bySid.has(sid)) bySid.set(sid, { sn, count: 0 });
      bySid.get(sid).count++;
    }
    const volley = [...bySid.entries()].filter(([, v]) => /volley/i.test(v.sn));
    for (const [sid, v] of volley) console.log(`  FOUND sid=${sid} name="${v.sn}" count=${v.count}`);
    if (!volley.length) console.log(`  aucun sid volleyball dans les ${events.length} events fetches (peut-etre lot different)`);
    // aussi checker sid=323 direct
    const sid323 = bySid.get(323);
    if (sid323) console.log(`  sid=323 : ${sid323.count} events (name: "${sid323.sn}")`);
  } catch (e) { console.log(`  err=${e.message}`); }
}

async function probeBetPawa() {
  console.log('\n═══ BetPawa ═══');
  // Foot=2, basket=3, tennis=452 → volleyball probablement 4-10 ou une autre plage
  for (const cat of ['4','5','6','7','8','9','10','20','453']) {
    try {
      const url = buildEventsListUrl({ eventType: 'UPCOMING', categories: [cat], marketTypes: ['3743','4791'], skip: 0, take: 10 });
      const strings = await bpFetchList(url);
      const ids = new Set();
      for (let i = 0; i < strings.length; i++) {
        if (/^\d{7,10}$/.test(strings[i])) {
          const name = strings[i + 1] || '';
          if (name.includes(' - ')) ids.add(strings[i]);
        }
      }
      if (ids.size) console.log(`  cat=${cat} : ${ids.size} matchs (sample: ${[...ids].slice(0, 2).join(',')})`);
    } catch (e) {}
  }
}

async function probePremierBet() {
  console.log('\n═══ PremierBet (guineegames) ═══');
  // Foot=1, basket=2, baseball=3, hockey=4, tennis=5 → volleyball probablement 6-8
  for (const sid of [6, 7, 8, 9, 10, 11, 12, 13]) {
    try {
      const j = await mget('/events/highlights', { sportId: sid });
      const events = [];
      for (const cat of (j?.data?.categories || [])) {
        for (const comp of (cat.competitions || [])) events.push(...(comp.events || []));
      }
      if (events.length) {
        const catNames = new Set((j?.data?.categories || []).map(c => c.name).filter(Boolean));
        console.log(`  sid=${sid} : ${events.length} events (cats: ${[...catNames].slice(0, 2).join(', ')})`);
      }
    } catch (e) {}
  }
}

async function probeSportyBet() {
  console.log('\n═══ SportyBet ═══');
  // SportRadar : volleyball = sr:sport:23 (standard)
  const url = `https://www.sportybet.com/api/ng/factsCenter/pcUpcomingEvents?sportId=sr%3Asport%3A23&marketId=1%2C18%2C10&pageSize=10&pageNum=1&timeline=24`;
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/151.0.0.0',
        Accept: '*/*', 'Accept-Language': 'en',
        clientid: 'web', operid: '2', platform: 'web',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) { console.log(`  sr:sport:23 status=${r.status}`); return; }
    const j = await r.json();
    const tournaments = j?.data?.tournaments || j?.data || [];
    const totalEvents = tournaments.reduce((sum, t) => sum + (t.events?.length || 0), 0);
    console.log(`  sr:sport:23 (volleyball) : ${tournaments.length} tournaments / ${totalEvents} events`);
    if (tournaments[0]?.events?.[0]) console.log(`    sample: ${tournaments[0].events[0].homeTeamName} vs ${tournaments[0].events[0].awayTeamName}`);
  } catch (e) { console.log(`  err=${e.message}`); }
}

console.log('▶ PROBE Volleyball Sport IDs — 10 books\n');
await probe1xbet();
await probe1win();
await probeCongobet();
await probeApollo();
await probeBetMomo();
await probeYellowBet();
await probeBetPawa();
await probePremierBet();
await probeSportyBet();
console.log('\n═══ FIN PROBE ═══');
process.exit(0);
