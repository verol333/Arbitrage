#!/usr/bin/env node
// Test API guineegames = PremierBet backend (confirme par user via F12)
// Endpoint decouvert : https://sports-api.guineegames.com/v1/
// Params : country=GN&group=g6&platform=desktop&locale=fr

const BASE = 'https://sports-api.guineegames.com/v1';
const HEADERS = {
  accept: 'application/json',
  origin: 'https://www.guineegames.com',
  referer: 'https://www.guineegames.com/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36',
  'accept-language': 'fr-FR,fr;q=0.9',
};

async function get(path, extra = {}) {
  const params = new URLSearchParams({
    country: 'GN',
    group: 'g6',
    platform: 'desktop',
    locale: 'fr',
    ...extra,
  }).toString();
  const url = `${BASE}${path}?${params}`;
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
    const body = await res.text();
    console.log(`\n${path}?${params.slice(0, 60)}...\n  status=${res.status} size=${body.length}`);
    if (res.status === 200) {
      try {
        const j = JSON.parse(body);
        return j;
      } catch { return null; }
    }
    console.log(`  err body: ${body.slice(0, 300)}`);
    return null;
  } catch (e) {
    console.log(`  err: ${e.message}`);
    return null;
  }
}

// 1. events-count pour identifier sportId foot
console.log('=== events-count PRE_MATCH ===');
const counts = await get('/sports/events-count', { eventState: 'PRE_MATCH' });
if (counts) {
  console.log(JSON.stringify(counts, null, 2).slice(0, 800));
}

// 2. Essai formats de listing (comme PremierBet)
console.log('\n=== upcoming ===');
const upcoming = await get('/events/upcoming', { limit: 5 });
if (upcoming) console.log('  keys:', Object.keys(upcoming).slice(0, 6), 'data keys:', upcoming.data ? Object.keys(upcoming.data).slice(0, 6) : null);

console.log('\n=== featured ===');
const featured = await get('/events/featured', { limit: 5 });
if (featured) console.log('  keys:', Object.keys(featured).slice(0, 6));

console.log('\n=== highlights ===');
const highlights = await get('/events/highlights', { limit: 5 });
if (highlights) console.log('  keys:', Object.keys(highlights).slice(0, 6));

// 3. Test sportId=1 (footbll probablement)
for (const sid of [1, 2, 3, 4, 5]) {
  console.log(`\n=== sports/${sid}/upcoming ===`);
  const s = await get(`/sports/${sid}/upcoming`, { limit: 3 });
  if (s?.data) {
    const cats = s.data.categories || [];
    const totalEvs = cats.reduce((n, c) => n + (c.competitions?.reduce((k, cp) => k + (cp.events?.length || 0), 0) || 0), 0);
    console.log(`  categories=${cats.length} totalEvents=${totalEvs}`);
    // Show first event to understand structure
    for (const cat of cats.slice(0, 1)) {
      for (const cp of (cat.competitions || []).slice(0, 1)) {
        for (const ev of (cp.events || []).slice(0, 1)) {
          console.log(`  sample event : sportId=${sid} category="${cat.name}" competition="${cp.name}"`);
          console.log(`    id=${ev.id} eventNames=${JSON.stringify(ev.eventNames)} startTime=${ev.startTime || ev.startDate}`);
          // Show 1 sample event id for details fetch
          if (ev.id && !global.firstFootEventId) global.firstFootEventId = { sid, id: ev.id, home: ev.eventNames?.[0], away: ev.eventNames?.[1] };
        }
      }
    }
  }
}

// 4. Dump full details d'un event (avec markets) — pour voir la structure des cotes
if (global.firstFootEventId) {
  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`=== DETAILS event ${global.firstFootEventId.id} (${global.firstFootEventId.home} vs ${global.firstFootEventId.away}, sportId=${global.firstFootEventId.sid}) ===`);
  console.log(`═══════════════════════════════════════════════`);
  const evDetails = await get(`/events/${global.firstFootEventId.id}`);
  if (evDetails) {
    const d = evDetails.data || evDetails;
    console.log(`  event top keys: ${Object.keys(d).slice(0, 15).join(', ')}`);
    if (d.markets) console.log(`  markets: ${d.markets.length}`);
    if (d.marketGroups) console.log(`  marketGroups: ${d.marketGroups.length}`);
    // Extract flat markets
    const markets = [];
    if (Array.isArray(d.markets)) markets.push(...d.markets);
    if (Array.isArray(d.marketGroups)) for (const g of d.marketGroups) markets.push(...(g.markets || []));
    console.log(`\n  TOTAL markets uniques (par id): ${new Set(markets.map((m) => m.id)).size}`);
    console.log(`\n  ═══ Premiers 20 markets avec leurs outcomes ═══`);
    const seen = new Set();
    let n = 0;
    for (const m of markets) {
      if (seen.has(m.id) || n >= 20) continue;
      seen.add(m.id); n++;
      const line = m.baseValue ?? m.base ?? m.argument ?? m.line ?? m.handicap ?? m.specifier ?? '';
      const outs = (m.outcomes || []).map((o) => `${o.name}=${o.price || o.odds || o.value}`).join(' | ');
      console.log(`    id=${m.id} "${m.name}"${line ? ` line=${line}` : ''} : ${outs}`);
    }
  }
}
