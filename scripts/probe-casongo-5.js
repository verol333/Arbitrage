#!/usr/bin/env node
// PROBE CASONGO #5 — via Scrape.do (bypass CF), teste les patterns list matches Velisports.

const TOKEN = 'NWI1Mzg3NWNjMDVhNGE3NmEwMTBmM2FiYTU5MWU1NTAuMi4xNzg2MzY4NTc0LjE3ODg5NjA1NzQ.iS2kU2nL0H_9-F2XwGrNF5Yc7SptnajlLI-WoBmcCMw';
const SCRAPE_DO_KEY = process.env.SCRAPE_DO_KEY || '';

function browserHeaders() {
  return {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'fr-FR,fr;q=0.8',
    authorization: `Bearer ${TOKEN}`,
    'content-type': 'application/json',
    origin: 'https://launcher.velisports.com',
    referer: 'https://launcher.velisports.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    'vsb-integration-token': '',
    'vsb-start-time': new Date().toISOString(),
    'vsb-trace-id': 'TRACEWEBAPPproduction' + Math.random().toString(36).slice(2, 22),
  };
}

async function sd(target) {
  const proxied = `https://api.scrape.do/?token=${SCRAPE_DO_KEY}&url=${encodeURIComponent(target)}&customHeaders=true&super=true&geoCode=us`;
  try {
    const res = await fetch(proxied, {
      signal: AbortSignal.timeout(60_000),
      headers: browserHeaders(),
    });
    return { status: res.status, body: await res.text() };
  } catch (e) { return { status: 0, body: null, err: e.message }; }
}

function summary(r, url) {
  const status = r.status === 200 ? '✅' : r.status === 404 ? '❌ 404' : `⚠️ ${r.status}`;
  const len = r.body?.length || 0;
  console.log(`  [${status}] len=${len} ${url.split('/').pop().slice(0, 100)}`);
  if (r.body) {
    try {
      const j = JSON.parse(r.body);
      if (Array.isArray(j)) console.log(`      Array[${j.length}] first=${JSON.stringify(j[0]).slice(0, 300)}`);
      else if (typeof j === 'object') {
        console.log(`      keys=${Object.keys(j).slice(0, 12).join(', ')}`);
        // Print structured content
        for (const k of Object.keys(j)) {
          const v = j[k];
          if (Array.isArray(v) && v.length > 0) console.log(`      ${k}[${v.length}] first=${JSON.stringify(v[0]).slice(0, 250)}`);
        }
      }
    } catch { console.log(`      ${r.body.slice(0, 300).replace(/\s+/g, ' ')}`); }
  }
}

const QS = 'CurrencyId=XAF&LanguageId=fr&PartnerId=2&PartnerName=casongo&TimeZone=1';
const BASE = 'https://prod-api.velisports.com/websitewebapi';

console.log('══ CASONGO #5 — LIST MATCHES via Scrape.do ══\n');

const candidates = [
  // Tree / hierarchy endpoints
  `${BASE}/WebSite/GetTree?SportId=1&${QS}`,
  `${BASE}/WebSite/GetSportTree?SportId=1&${QS}`,
  `${BASE}/WebSite/GetPrematchTree?SportId=1&${QS}`,
  `${BASE}/WebSite/GetSportPrematchTree?SportId=1&${QS}`,
  `${BASE}/WebSite/GetHomePage?SportId=1&${QS}`,
  `${BASE}/WebSite/GetSportsTree?${QS}`,
  // List patterns
  `${BASE}/WebSite/GetSportMatches?SportId=1&${QS}`,
  `${BASE}/WebSite/GetLeagueMatches?SportId=1&${QS}`,
  `${BASE}/WebSite/GetTournamentMatches?SportId=1&${QS}`,
  `${BASE}/WebSite/GetLeagueEvents?SportId=1&${QS}`,
  `${BASE}/WebSite/GetTournamentEvents?SportId=1&${QS}`,
  `${BASE}/WebSite/GetTopEvents?SportId=1&${QS}`,
  `${BASE}/WebSite/GetTopMatches?SportId=1&${QS}`,
  `${BASE}/WebSite/GetSportEvents?SportId=1&${QS}`,
  // Coupons / featured
  `${BASE}/WebSite/GetCoupons?SportId=1&${QS}`,
  `${BASE}/WebSite/GetPopularMatches?SportId=1&${QS}`,
  `${BASE}/WebSite/GetHomeMatches?SportId=1&${QS}`,
  // Search / filter
  `${BASE}/WebSite/SearchMatches?SportId=1&${QS}`,
  `${BASE}/WebSite/GetMatchesByFilter?SportId=1&${QS}`,
  `${BASE}/WebSite/GetFilteredMatches?SportId=1&${QS}`,
  // Sport-scoped
  `${BASE}/WebSite/GetSportPrematchMatches?SportId=1&${QS}`,
  `${BASE}/WebSite/GetSportPrematchEvents?SportId=1&${QS}`,
  `${BASE}/WebSite/GetSportLiveMatches?SportId=1&${QS}`,
  `${BASE}/WebSite/GetPrematchEvents?SportId=1&${QS}`,
  // Menu / navigation
  `${BASE}/WebSite/GetMenu?SportId=1&${QS}`,
  `${BASE}/WebSite/GetSportMenu?SportId=1&${QS}`,
  // Sports listing shape
  `${BASE}/WebSite/GetSportsWithCounts?${QS}`,
];

for (const url of candidates) summary(await sd(url), url);

console.log('\n▶ Fin.');
process.exit(0);
