#!/usr/bin/env node
// PROBE CASONGO — découverte endpoints Velisports (prod-api.velisports.com)
// L'user a fourni : GetMatchById, GetMarketTypeGroups. Il me manque le LIST des matchs.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const TOKEN = 'NWI1Mzg3NWNjMDVhNGE3NmEwMTBmM2FiYTU5MWU1NTAuMi4xNzg2MzY4NTc0LjE3ODg5NjA1NzQ.iS2kU2nL0H_9-F2XwGrNF5Yc7SptnajlLI-WoBmcCMw';

const HEADERS = {
  'User-Agent': UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.8',
  Origin: 'https://launcher.velisports.com',
  Referer: 'https://launcher.velisports.com/',
  authorization: `Bearer ${TOKEN}`,
  'content-type': 'application/json',
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

function summary(r, url) {
  const ct = r.ct || '';
  const len = r.body?.length || 0;
  let js = null;
  if (ct.includes('json') && len > 2) { try { js = JSON.parse(r.body); } catch {} }
  const keys = js && typeof js === 'object' ? Object.keys(js).slice(0, 15) : null;
  const isArr = Array.isArray(js) ? js.length : null;
  const preview = js ? JSON.stringify(js).slice(0, 400) : (r.body || '').slice(0, 200);
  const status = r.status === 200 ? '✅' : `⚠️ ${r.status}`;
  console.log(`  [${status}] len=${len} ${url}`);
  if (keys) console.log(`      keys: ${keys.join(', ')}${isArr !== null ? ` (Array len=${isArr})` : ''}`);
  if (r.body?.length && r.body?.length < 5000 && preview) console.log(`      ${preview.replace(/\s+/g, ' ')}`);
  return js;
}

const BASE = 'https://prod-api.velisports.com/websitewebapi';
const QS = 'CurrencyId=XAF&LanguageId=fr&PartnerId=2&PartnerName=casongo&TimeZone=1';

// ═════ 1. Endpoint list matchs — patterns typiques Velisports ═════
console.log('══ 1. LIST MATCHES ENDPOINTS ══\n');
const listPaths = [
  `/WebSite/GetMatches?SportId=1&${QS}`,
  `/WebSite/GetPrematchMatches?SportId=1&${QS}`,
  `/WebSite/GetFixtures?SportId=1&${QS}`,
  `/WebSite/GetSportMatches?SportId=1&${QS}`,
  `/WebSite/GetTopMatches?SportId=1&${QS}`,
  `/WebSite/GetEvents?SportId=1&${QS}`,
  `/WebSite/GetAllMatches?SportId=1&${QS}`,
  `/WebSite/GetLeagues?SportId=1&${QS}`,
  `/WebSite/GetTournaments?SportId=1&${QS}`,
  `/WebSite/GetCategories?SportId=1&${QS}`,
  `/WebSite/GetSports?${QS}`,
  `/WebSite/GetMenu?${QS}`,
  `/WebSite/GetSportMenu?${QS}`,
  `/WebSite/GetPrematchMenu?SportId=1&${QS}`,
  `/WebSite/GetLiveMatches?SportId=1&${QS}`,
  `/WebSite/GetFilteredMatches?SportId=1&${QS}`,
  `/WebSite/GetMatchesBySport?SportId=1&${QS}`,
  `/WebSite/GetSportEvents?SportId=1&${QS}`,
  `/WebSite/GetCoupons?SportId=1&${QS}`,
  `/WebSite/GetTree?SportId=1&${QS}`,
  `/WebSite/GetNavigation?${QS}`,
  `/WebSite/GetHomePage?SportId=1&${QS}`,
  `/WebSite/GetBySport?SportId=1&${QS}`,
];
for (const p of listPaths) await new Promise((r) => setTimeout(r, 150)).then(async () => summary(await req(`${BASE}${p}`), p));

// ═════ 2. POST variants (car certains Velisports c'est POST) ═════
console.log('\n══ 2. POST VARIANTS ══\n');
const postPaths = [
  { path: '/WebSite/GetMatches', body: { SportId: 1, CurrencyId: 'XAF', LanguageId: 'fr', PartnerId: 2, PartnerName: 'casongo', TimeZone: 1 } },
  { path: '/WebSite/GetPrematchMatches', body: { SportId: 1, CurrencyId: 'XAF', LanguageId: 'fr', PartnerId: 2, PartnerName: 'casongo', TimeZone: 1 } },
  { path: '/WebSite/GetSports', body: { CurrencyId: 'XAF', LanguageId: 'fr', PartnerId: 2, PartnerName: 'casongo', TimeZone: 1 } },
];
for (const { path, body } of postPaths) {
  const r = await req(`${BASE}${path}`, { method: 'POST', body: JSON.stringify(body) });
  summary(r, `POST ${path}`);
}

// ═════ 3. Rechercher les JS bundles casongo.cg pour extraire les VRAIS endpoints ═════
console.log('\n══ 3. CASONGO.CG BUNDLE GREP ══\n');
const home = await req('https://casongo.cg/fr-CG', { headers: {} });
console.log(`  Home: status=${home.status} len=${home.body?.length || 0}`);
if (home.body) {
  const scripts = [...home.body.matchAll(/["']([^"']+\.js)["']/g)]
    .map((m) => m[1])
    .filter((u) => !u.includes('gtag') && !u.includes('firebase'))
    .map((u) => u.startsWith('http') ? u : (u.startsWith('//') ? 'https:' + u : `https://casongo.cg${u.startsWith('/') ? u : '/' + u}`))
    .filter((u, i, a) => a.indexOf(u) === i)
    .slice(0, 10);
  console.log(`  Scripts (${scripts.length}):`);
  const allEndpoints = new Set();
  for (const u of scripts) {
    const r = await req(u, { headers: {} });
    if (r.status !== 200 || !r.body) { console.log(`    ❌ ${r.status} ${u.slice(-60)}`); continue; }
    console.log(`    ✅ ${r.body.length}B ${u.slice(-60)}`);
    for (const m of r.body.matchAll(/["'`](\/websitewebapi\/[a-zA-Z0-9/_?=&.-]{2,120})["'`]/g)) allEndpoints.add(m[1]);
    for (const m of r.body.matchAll(/["'`](\/hapi\/velisports\/[a-zA-Z0-9/_?=&.-]{2,120})["'`]/g)) allEndpoints.add(m[1]);
    for (const m of r.body.matchAll(/["'`](\/WebSite\/[a-zA-Z0-9]{2,60})["'`]/g)) allEndpoints.add(m[1]);
  }
  console.log(`\n  → Endpoints extraits (${allEndpoints.size}):`);
  [...allEndpoints].sort().forEach((e) => console.log(`     - ${e}`));
}

// ═════ 4. Test launcher.velisports.com bundle qui contient l'app ═════
console.log('\n══ 4. LAUNCHER.VELISPORTS BUNDLE ══\n');
const launcher = await req('https://launcher.velisports.com/');
console.log(`  Launcher home: status=${launcher.status} len=${launcher.body?.length || 0}`);
if (launcher.body) {
  const scripts = [...launcher.body.matchAll(/["']([^"']+\.js)["']/g)]
    .map((m) => m[1])
    .map((u) => u.startsWith('http') ? u : (u.startsWith('//') ? 'https:' + u : `https://launcher.velisports.com${u.startsWith('/') ? u : '/' + u}`))
    .filter((u, i, a) => a.indexOf(u) === i)
    .slice(0, 8);
  console.log(`  Scripts (${scripts.length}):`);
  const endpoints = new Set();
  for (const u of scripts) {
    const r = await req(u, { headers: {} });
    if (r.status !== 200 || !r.body) { console.log(`    ❌ ${r.status} ${u.slice(-60)}`); continue; }
    console.log(`    ✅ ${r.body.length}B ${u.slice(-60)}`);
    for (const m of r.body.matchAll(/["'`](\/WebSite\/[a-zA-Z0-9]{2,60})["'`]/g)) endpoints.add(m[1]);
    for (const m of r.body.matchAll(/["'`](\/websitewebapi\/[a-zA-Z0-9/_?=&.-]{2,120})["'`]/g)) endpoints.add(m[1]);
  }
  console.log(`\n  → Endpoints extraits (${endpoints.size}):`);
  [...endpoints].sort().slice(0, 40).forEach((e) => console.log(`     - ${e}`));
}

console.log('\n▶ Fin.');
process.exit(0);
