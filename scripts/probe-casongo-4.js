#!/usr/bin/env node
// PROBE CASONGO #4 — REJOUE exactement la requête navigateur qui a marché (200 OK GetMarketTypeGroups).
// Test direct sur prod-api.velisports.com + fallback Scrape.do si CF IP block.

const TOKEN = 'NWI1Mzg3NWNjMDVhNGE3NmEwMTBmM2FiYTU5MWU1NTAuMi4xNzg2MzY4NTc0LjE3ODg5NjA1NzQ.iS2kU2nL0H_9-F2XwGrNF5Yc7SptnajlLI-WoBmcCMw';
const SCRAPE_DO_KEY = process.env.SCRAPE_DO_KEY || '';

function browserHeaders() {
  return {
    accept: 'application/json, text/plain, */*',
    'accept-encoding': 'gzip, deflate, br, zstd',
    'accept-language': 'fr-FR,fr;q=0.8',
    authorization: `Bearer ${TOKEN}`,
    'content-type': 'application/json',
    origin: 'https://launcher.velisports.com',
    priority: 'u=1, i',
    referer: 'https://launcher.velisports.com/',
    'sec-ch-ua': '"Not=A?Brand";v="99", "Brave";v="151", "Chromium";v="151"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'sec-gpc': '1',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    'vsb-integration-token': '',
    'vsb-start-time': new Date().toISOString(),
    'vsb-trace-id': 'TRACEWEBAPPproduction' + Math.random().toString(36).slice(2, 22),
  };
}

async function req(url, opts = {}) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(opts.timeoutMs || 20_000),
      method: opts.method || 'GET',
      headers: opts.headers,
      body: opts.body,
    });
    return { status: res.status, body: await res.text(), ct: res.headers.get('content-type'), cf: res.headers.get('cf-ray') };
  } catch (e) { return { status: 0, body: null, err: e.message }; }
}

function summary(r, url) {
  const status = r.status === 200 ? '✅ 200' : (r.status === 403 || r.status === 400 || r.status === 401) ? `🔒 ${r.status}` : `⚠️ ${r.status}`;
  const len = r.body?.length || 0;
  const cf = r.cf ? ` cf=${r.cf}` : '';
  console.log(`  [${status}] len=${len}${cf} ${url}`);
  if (r.body && len < 3000) console.log(`      ${r.body.slice(0, 500).replace(/\s+/g, ' ')}`);
  else if (r.body && len < 100000) {
    try {
      const j = JSON.parse(r.body);
      if (Array.isArray(j)) console.log(`      Array[${j.length}] first=${JSON.stringify(j[0]).slice(0, 300)}`);
      else console.log(`      keys=${Object.keys(j).slice(0, 15).join(', ')}`);
    } catch {}
  }
  return r;
}

const QS = 'CurrencyId=XAF&LanguageId=fr&PartnerId=2&PartnerName=casongo&TimeZone=1';
const BASE = 'https://prod-api.velisports.com/websitewebapi';

// ═════ 1. DIRECT avec EXACT browser headers ═════
console.log('══ 1. DIRECT prod-api.velisports.com + browser headers exacts ══\n');
const direct = [
  `${BASE}/WebSite/GetMarketTypeGroups?${QS}`,  // celui qui a marché côté user
  `${BASE}/WebSite/GetMatchById?MatchId=2504990&${QS}`,
  `${BASE}/WebSite/GetSports?${QS}`,
  `${BASE}/WebSite/GetPrematchMatches?SportId=1&${QS}`,
  `${BASE}/WebSite/GetMatches?SportId=1&${QS}`,
  `${BASE}/WebSite/GetSportEvents?SportId=1&${QS}`,
  `${BASE}/WebSite/GetLeagues?SportId=1&${QS}`,
  `${BASE}/WebSite/GetTournaments?SportId=1&${QS}`,
  `${BASE}/WebSite/GetPrematchLeagues?SportId=1&${QS}`,
  `${BASE}/WebSite/GetPrematchTree?SportId=1&${QS}`,
];
for (const url of direct) summary(await req(url, { headers: browserHeaders() }), url);

// ═════ 2. Si CF bloque → Scrape.do (comme PremierBet) ═════
if (SCRAPE_DO_KEY) {
  console.log('\n══ 2. VIA SCRAPE.DO (premium residential) ══\n');
  const sdOpts = { render: 'false', super: 'true', geoCode: 'us' };
  const sdParams = Object.entries(sdOpts).map(([k, v]) => `${k}=${v}`).join('&');
  const targets = direct.slice(0, 5);  // test 5 seulement
  for (const target of targets) {
    const proxied = `https://api.scrape.do/?token=${SCRAPE_DO_KEY}&url=${encodeURIComponent(target)}&customHeaders=true&${sdParams}`;
    // customHeaders=true → passer nos headers via X-*
    const r = await req(proxied, { headers: browserHeaders(), timeoutMs: 60_000 });
    const status = r.status === 200 ? '✅ 200' : `⚠️ ${r.status}`;
    console.log(`  [${status}] len=${r.body?.length || 0} ${target.split('/').pop().slice(0, 80)}`);
    if (r.body && r.body.length < 3000) console.log(`      ${r.body.slice(0, 500).replace(/\s+/g, ' ')}`);
    else if (r.body) {
      try {
        const j = JSON.parse(r.body);
        if (Array.isArray(j)) console.log(`      Array[${j.length}] first=${JSON.stringify(j[0]).slice(0, 200)}`);
        else console.log(`      keys=${Object.keys(j).slice(0, 15).join(', ')}`);
      } catch {}
    }
  }
} else {
  console.log('\n⚠️  SCRAPE_DO_KEY absent — skip Scrape.do fallback');
}

console.log('\n▶ Fin.');
process.exit(0);
