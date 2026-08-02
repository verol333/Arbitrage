// DUMP brut d'events LIVE PremierBet + SportyBet.
// Objectif : identifier pourquoi on envoie des cotes qui ne correspondent
// pas à ce que le book affiche réellement en live.
// Compare :
//  - Ce que l'API retourne
//  - Ce que notre parseur retient
//  - Les market IDs présents en LIVE vs ceux mappés (baseline prematch)

const log = (m) => console.log(m);

// ─── PREMIERBET LIVE ─────────────────────────────────────────────
const PB_HDR = {
  'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://www.guineegames.com/',
  'Origin': 'https://www.guineegames.com',
};
const PB_BASE = 'https://sports-api.guineegames.com/v1';
const PB_PARAMS = 'country=GN&group=g6&platform=desktop&locale=fr';

// IDs mappés dans notre parseur PB (parse.js)
const PB_MAPPED = new Set(['3','7','17','18','23','29','353','352','35','16','6','155','44','19','119','392','393','396','96','156','45','120','397','398','111','107','1852','1853','109','113','110']);

async function probePBLive() {
  log('\n═══════════ PREMIERBET LIVE DUMP ═══════════');
  const t0 = Date.now();
  const listUrl = `${PB_BASE}/events/live?${PB_PARAMS}&sportId=1&zoomSportId=61`;
  const listRes = await fetch(listUrl, { headers: PB_HDR, signal: AbortSignal.timeout(30_000) });
  const listJson = await listRes.json();
  log(`[list] ${Date.now() - t0}ms status=${listRes.status}`);

  const events = [];
  for (const cat of (listJson?.data?.categories || [])) {
    for (const comp of (cat?.competitions || [])) {
      for (const ev of (comp?.events || [])) events.push({ ...ev, catName: cat.name, compName: comp.name });
    }
  }
  log(`[list] ${events.length} live events\n`);
  if (!events.length) return;

  const sample = events.slice(0, 2);
  for (const ev of sample) {
    log(`── ${ev.eventNames?.join(' vs ')} (${ev.compName}) — id=${ev.id}`);
    const url = `${PB_BASE}/events/${ev.id}?${PB_PARAMS}&_t=${Date.now()}`;
    const res = await fetch(url, { headers: PB_HDR, signal: AbortSignal.timeout(20_000) });
    const j = await res.json();
    const evObj = j?.data || j;
    // Score
    log(`   score=${evObj?.matchScore || evObj?.score || '?'} status=${evObj?.status || '?'} time=${evObj?.matchTime || evObj?.playedSeconds || '?'}`);
    // All markets
    const markets = evObj?.markets || (evObj?.marketGroups || []).flatMap((g) => g.markets || []);
    log(`   ${markets.length} markets:`);
    for (const m of markets) {
      const id = String(m.id);
      const mapped = PB_MAPPED.has(id) ? '✅' : '❌ NON MAPPÉ';
      const outcomesStr = (m.outcomes || []).map((o) => `${o.name}${o.handicap != null ? `[${o.handicap}]` : ''}=${o.value}`).join(' ');
      log(`     id=${id} name="${m.name || ''}" ${mapped} outcomes=[${outcomesStr}]`);
    }
    log('');
  }
}

// ─── SPORTYBET LIVE ────────────────────────────────────────────
const SB_HDR = {
  'User-Agent': 'Mozilla/5.0 Chrome/151.0.0.0',
  'Accept': '*/*', 'Accept-Language': 'en',
  'Referer': 'https://www.sportybet.com/ng/sport/football/live',
  'Origin': 'https://www.sportybet.com',
  'Cookie': 'locale=en; device-id=b0671631-24f3-4e60-a281-117254ea1551; sb_country=ng',
  'clientid': 'web', 'operid': '2', 'platform': 'web',
};

// IDs mappés dans notre parseur SB (parse.js sportybet)
const SB_MAPPED = new Set(['1','18','10','29','11','26','16','60','68','78','79']);

async function probeSBLive() {
  log('\n═══════════ SPORTYBET LIVE DUMP ═══════════');
  const t0 = Date.now();
  const listUrl = `https://www.sportybet.com/api/ng/factsCenter/liveOrPrematchEvents?sportId=sr%3Asport%3A1&_t=${Date.now()}`;
  const listRes = await fetch(listUrl, { headers: SB_HDR, signal: AbortSignal.timeout(20_000) });
  const listJson = await listRes.json();
  log(`[list] ${Date.now() - t0}ms status=${listRes.status}`);
  const events = [];
  for (const t of (listJson?.data || [])) for (const e of (t?.events || [])) events.push(e);
  const live = events.filter((e) => e?.status === 1 || /^(H1|H2|HT|LIVE)$/i.test(e?.matchStatus || ''));
  log(`[list] ${live.length} live events (total ${events.length})\n`);
  if (!live.length) return;

  const sample = live.slice(0, 2);
  for (const ev of sample) {
    log(`── ${ev.homeTeamName} vs ${ev.awayTeamName} — id=${ev.eventId}`);
    log(`   score=${ev.setScore} status=${ev.matchStatus} time=${ev.playedSeconds}`);
    // Refetch event details for fresh markets — productId=1 = LIVE (3 = PREMATCH, retourne 0 markets pour live)
    const url = `https://www.sportybet.com/api/ng/factsCenter/event?eventId=${encodeURIComponent(ev.eventId)}&productId=1&_t=${Date.now()}`;
    const res = await fetch(url, { headers: SB_HDR, signal: AbortSignal.timeout(20_000) });
    const j = await res.json();
    const evObj = j?.data || {};
    const markets = evObj?.markets || [];
    log(`   ${markets.length} markets:`);
    for (const m of markets) {
      const id = String(m.id);
      const mapped = SB_MAPPED.has(id) ? '✅' : '❌ NON MAPPÉ';
      const outcomesStr = (m.outcomes || []).map((o) => `${o.desc}=${o.odds}(status=${o.isActive != null ? o.isActive : '?'})`).join(' ');
      log(`     id=${id} name="${m.desc || m.name || ''}" specifier="${m.specifier || ''}" ${mapped} outcomes=[${outcomesStr}]`);
    }
    log('');
  }
}

await probePBLive();
await probeSBLive();
log('\nDONE');
