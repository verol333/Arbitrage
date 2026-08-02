// Probe latence live : mesure le temps entre "cote captée" et "cote envoyée"
// simulée pour chaque book. Fait aussi 5 lectures espacées de 3s pour détecter
// si un cache upstream sert les mêmes cotes (donc info stale envoyée en live).

const HDR_PB = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  'Referer': 'https://www.guineegames.com/',
  'Origin': 'https://www.guineegames.com',
};
const PB_BASE = 'https://sports-api.guineegames.com/v1';
const PB_PARAMS = 'country=GN&group=g6&platform=desktop&locale=fr';

const log = (m) => console.log(m);

async function probePBLive() {
  log('\n═══════ PREMIERBET LIVE LATENCY ═══════');
  const t0 = Date.now();
  const listUrl = `${PB_BASE}/events/live?${PB_PARAMS}&sportId=1&zoomSportId=61`;
  const listRes = await fetch(listUrl, { headers: HDR_PB, signal: AbortSignal.timeout(30_000) });
  const listJson = await listRes.json();
  log(`[list] ${Date.now() - t0}ms status=${listRes.status}`);

  const events = [];
  for (const cat of (listJson?.data?.categories || [])) {
    for (const comp of (cat?.competitions || [])) {
      for (const ev of (comp?.events || [])) events.push({ ...ev, catName: cat.name, compName: comp.name });
    }
  }
  log(`[list] ${events.length} live events found`);
  if (!events.length) { log('No live events, skip'); return; }

  // Take first 3 events with 1X2 market probable
  const sample = events.slice(0, 3);
  for (const ev of sample) {
    const label = ev.eventNames?.join(' vs ') || `id=${ev.id}`;
    log(`\n── ${label} (${ev.compName}) ──`);
    const snapshots = [];
    for (let i = 0; i < 5; i++) {
      const tS = Date.now();
      const url = `${PB_BASE}/events/${ev.id}?${PB_PARAMS}`;
      const res = await fetch(url, { headers: HDR_PB, signal: AbortSignal.timeout(20_000) });
      const j = await res.json();
      const dt = Date.now() - tS;
      const evObj = j?.data || j;
      const markets = evObj?.markets || (evObj?.marketGroups || []).flatMap((g) => g.markets || []);
      const m1x2 = markets.find((m) => String(m.id) === '3');
      const outcomes = m1x2 ? m1x2.outcomes.map((o) => `${o.name}=${o.value}`).join(' ') : 'NO_1X2';
      // Score if available
      const score = evObj?.matchScore || evObj?.score || evObj?.livePeriod || '';
      const cacheHdrs = ['cf-cache-status', 'x-cache', 'age', 'x-served-by', 'x-varnish']
        .map((h) => `${h}=${res.headers.get(h) || ''}`).filter((s) => !s.endsWith('=')).join(' ');
      log(`  [${i + 1}] +${dt}ms status=${res.status} 1X2=[${outcomes}] score="${score}" ${cacheHdrs}`);
      snapshots.push(outcomes);
      if (i < 4) await new Promise((r) => setTimeout(r, 3000));
    }
    const allSame = snapshots.every((s) => s === snapshots[0]);
    log(`  → CACHE ANALYSIS: 5 lectures identiques ? ${allSame ? '⚠️  OUI (cache probable)' : '✅ NON (fresh)'}`);
  }
}

// ─── SPORTYBET LIVE ────────────────────────────────────────────────
const HDR_SB = {
  'User-Agent': 'Mozilla/5.0 Chrome/151.0.0.0',
  'Accept': '*/*', 'Accept-Language': 'en',
  'Referer': 'https://www.sportybet.com/ng/sport/football/live',
  'Origin': 'https://www.sportybet.com',
  'Cookie': 'locale=en; device-id=b0671631-24f3-4e60-a281-117254ea1551; sb_country=ng',
  'clientid': 'web', 'operid': '2', 'platform': 'web',
};

async function probeSBLive() {
  log('\n═══════ SPORTYBET LIVE LATENCY ═══════');
  const tL = Date.now();
  const listUrl = `https://www.sportybet.com/api/ng/factsCenter/liveOrPrematchEvents?sportId=sr%3Asport%3A1&_t=${Date.now()}`;
  const listRes = await fetch(listUrl, { headers: HDR_SB, signal: AbortSignal.timeout(20_000) });
  const listJson = await listRes.json();
  log(`[list] ${Date.now() - tL}ms status=${listRes.status}`);
  const events = [];
  for (const t of (listJson?.data || [])) for (const e of (t?.events || [])) events.push(e);
  const live = events.filter((e) => e?.status === 1 || /^(H1|H2|HT|LIVE)$/i.test(e?.matchStatus || ''));
  log(`[list] ${live.length} live events (total ${events.length})`);
  if (!live.length) { log('No live events, skip'); return; }

  const sample = live.slice(0, 3);
  for (const ev of sample) {
    log(`\n── ${ev.homeTeamName} vs ${ev.awayTeamName} (status=${ev.matchStatus} score=${ev.setScore}) ──`);
    const snapshots = [];
    for (let i = 0; i < 5; i++) {
      const tS = Date.now();
      const url = `https://www.sportybet.com/api/ng/factsCenter/event?eventId=${encodeURIComponent(ev.eventId)}&productId=3&_t=${Date.now()}`;
      const res = await fetch(url, { headers: HDR_SB, signal: AbortSignal.timeout(20_000) });
      const j = await res.json();
      const dt = Date.now() - tS;
      const evObj = j?.data || {};
      const m1 = (evObj?.markets || []).find((m) => String(m.id) === '1');
      const outcomes = m1 ? m1.outcomes.map((o) => `${o.desc}=${o.odds}`).join(' ') : 'NO_1X2';
      log(`  [${i + 1}] +${dt}ms status=${res.status} 1X2=[${outcomes}] score=${evObj?.setScore || ''} time=${evObj?.playedSeconds || ''}`);
      snapshots.push(outcomes);
      if (i < 4) await new Promise((r) => setTimeout(r, 3000));
    }
    const allSame = snapshots.every((s) => s === snapshots[0]);
    log(`  → CACHE ANALYSIS: 5 lectures identiques ? ${allSame ? '⚠️  OUI (cache probable)' : '✅ NON (fresh)'}`);
  }
}

await probePBLive();
await probeSBLive();
log('\nDONE');
