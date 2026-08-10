#!/usr/bin/env node
// PROBE CASONGO #2 — tester le proxy casongo.cg/hapi/velisports/* (bypass CF probable)
// + extraire scripts casongo.cg avec regex robuste.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

const HEADERS = {
  'User-Agent': UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.8',
  Referer: 'https://casongo.cg/fr-CG',
  Origin: 'https://casongo.cg',
};

async function req(url, opts = {}) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(opts.timeoutMs || 15_000),
      method: opts.method || 'GET',
      headers: { ...HEADERS, ...(opts.headers || {}) },
      body: opts.body,
    });
    return { status: res.status, body: await res.text(), ct: res.headers.get('content-type') };
  } catch (e) { return { status: 0, body: null, err: e.message }; }
}

function summary(r, url, maxPreview = 500) {
  const ct = r.ct || '';
  const len = r.body?.length || 0;
  let js = null;
  if (ct.includes('json') && len > 2) { try { js = JSON.parse(r.body); } catch {} }
  const keys = js && typeof js === 'object' && !Array.isArray(js) ? Object.keys(js).slice(0, 15) : null;
  const arrLen = Array.isArray(js) ? js.length : null;
  const status = r.status === 200 ? '✅' : (r.status === 401 || r.status === 403 || r.status === 400) ? `🔒 ${r.status}` : `⚠️ ${r.status}`;
  console.log(`  [${status}] len=${len} ${url}`);
  if (keys) console.log(`      keys: ${keys.join(', ')}`);
  if (arrLen !== null) console.log(`      Array[${arrLen}]`);
  if (r.body && len < 3000) console.log(`      ${r.body.slice(0, maxPreview).replace(/\s+/g, ' ')}`);
  return js;
}

// ═════ 1. casongo.cg/hapi/velisports/* — proxy layer (Kong) ═════
console.log('══ 1. CASONGO.CG /hapi/velisports/* PROXY ══\n');
const hapiPaths = [
  '/hapi/velisports/public/start_game?deviceType=desktop&internalGameId=1000%3ADESKTOP_AND_MOBILE%3Avelisports%3Avelisports&lang=fr&brandId=paridirect&currency=XAF&country=CG',
  '/hapi/velisports/WebSite/GetMatches?SportId=1&CurrencyId=XAF&LanguageId=fr&PartnerId=2&PartnerName=casongo&TimeZone=1',
  '/hapi/velisports/websitewebapi/WebSite/GetMatches?SportId=1&CurrencyId=XAF&LanguageId=fr&PartnerId=2&PartnerName=casongo&TimeZone=1',
  '/hapi/velisports/GetMatches?SportId=1&CurrencyId=XAF&LanguageId=fr&PartnerId=2&PartnerName=casongo&TimeZone=1',
  '/hapi/velisports/prematch?SportId=1',
  '/hapi/velisports/sport/1',
  '/hapi/velisports/sports',
  '/hapi/velisports/matches?SportId=1',
  '/hapi/velisports/events?SportId=1',
  '/hapi/velisports/menu?SportId=1',
];
for (const p of hapiPaths) summary(await req(`https://casongo.cg${p}`), p);

// ═════ 2. Extraire scripts casongo.cg avec regex ROBUSTE ═════
console.log('\n══ 2. CASONGO.CG HOME — extraction scripts avancée ══\n');
const home = await req('https://casongo.cg/fr-CG');
console.log(`  Home: status=${home.status} len=${home.body?.length || 0}`);

const scripts = new Set();
if (home.body) {
  // regex robustes multiples
  const patterns = [
    /<script[^>]*src=["']([^"']+)["']/gi,
    /<link[^>]*rel=["']modulepreload["'][^>]*href=["']([^"']+)["']/gi,
    /<link[^>]*rel=["']preload["'][^>]*href=["']([^"']+\.js[^"']*)["']/gi,
    /["'](\/(?:assets|static|js|scripts|bundles|dist|_next|app)\/[^"']+\.js[^"']*)["']/gi,
    /["'](\/[a-zA-Z0-9._-]+\.js[^"']*)["']/gi,
  ];
  for (const re of patterns) {
    for (const m of home.body.matchAll(re)) {
      let u = m[1];
      if (u.startsWith('//')) u = 'https:' + u;
      else if (u.startsWith('/')) u = 'https://casongo.cg' + u;
      else if (!u.startsWith('http')) u = 'https://casongo.cg/' + u;
      // filter out gtag, firebase, GA, cookieconsent, chunks CSS
      if (/gtag|firebase|cookieconsent|gstatic|googletagmanager|hotjar|matomo/i.test(u)) continue;
      scripts.add(u);
    }
  }
}

console.log(`  Scripts trouvés (${scripts.size}):`);
[...scripts].slice(0, 20).forEach((s) => console.log(`    - ${s}`));

// Grep each script pour URLs API
const allApiRefs = new Set();
const allHosts = new Set();
const allHapiPaths = new Set();
console.log('\n  Grep bundles pour URLs API :');
for (const s of [...scripts].slice(0, 10)) {
  const r = await req(s);
  if (r.status !== 200 || !r.body) { console.log(`    ❌ ${r.status} ${s.slice(-60)}`); continue; }
  console.log(`    ✅ ${r.body.length}B ${s.slice(-60)}`);
  // Paths /hapi/*
  for (const m of r.body.matchAll(/["'`](\/hapi\/[a-zA-Z0-9/_?=&.-]{2,120})["'`]/g)) allHapiPaths.add(m[1]);
  // Paths /websitewebapi/* & /api/*
  for (const m of r.body.matchAll(/["'`](\/(?:websitewebapi|api|WebSite)\/[a-zA-Z0-9/_?=&.-]{2,120})["'`]/g)) allApiRefs.add(m[1]);
  // Hosts velisports/casongo/veligroup
  for (const m of r.body.matchAll(/["'`](https?:\/\/[a-z0-9.-]*(?:velisports|casongo|veligroup|betgenius)[a-z0-9.-]*\.[a-z]{2,6})/gi)) allHosts.add(m[1]);
  // GetXxxx patterns
  for (const m of r.body.matchAll(/["'`](\/?Get[A-Z][a-zA-Z0-9]{2,30})["'`]/g)) allApiRefs.add(m[1]);
}
console.log(`\n  → /hapi/* paths (${allHapiPaths.size}):`);
[...allHapiPaths].sort().slice(0, 30).forEach((p) => console.log(`     - ${p}`));
console.log(`\n  → /websitewebapi|/api|/WebSite/Getxxx paths (${allApiRefs.size}):`);
[...allApiRefs].sort().slice(0, 40).forEach((p) => console.log(`     - ${p}`));
console.log(`\n  → Hosts velisports/casongo/veligroup (${allHosts.size}):`);
[...allHosts].forEach((h) => console.log(`     - ${h}`));

// ═════ 3. HTML raw first 1000 chars pour identifier framework ═════
console.log('\n══ 3. HOME PAGE HEAD (framework detect) ══');
if (home.body) console.log(home.body.slice(0, 2000).replace(/\s+/g, ' '));

console.log('\n▶ Fin.');
process.exit(0);
