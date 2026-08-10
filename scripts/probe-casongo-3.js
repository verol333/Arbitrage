#!/usr/bin/env node
// PROBE CASONGO #3 — utilise le Bearer JWT sur /hapi/velisports/*
// + grep TOUS les chunks Next.js pour trouver les endpoints list matchs.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const TOKEN = 'NWI1Mzg3NWNjMDVhNGE3NmEwMTBmM2FiYTU5MWU1NTAuMi4xNzg2MzY4NTc0LjE3ODg5NjA1NzQ.iS2kU2nL0H_9-F2XwGrNF5Yc7SptnajlLI-WoBmcCMw';

const H_BASE = {
  'User-Agent': UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.8',
  Referer: 'https://launcher.velisports.com/',
  Origin: 'https://launcher.velisports.com',
  'content-type': 'application/json',
};
const H_AUTH = { ...H_BASE, authorization: `Bearer ${TOKEN}` };

async function req(url, opts = {}) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(opts.timeoutMs || 15_000),
      method: opts.method || 'GET',
      headers: opts.headers,
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
  const status = r.status === 200 ? '✅' : (r.status === 401 || r.status === 403 || r.status === 400) ? `🔒 ${r.status}` : `⚠️ ${r.status}`;
  console.log(`  [${status}] len=${len} ${url}`);
  if (js && typeof js === 'object' && !Array.isArray(js)) console.log(`      keys: ${Object.keys(js).slice(0, 20).join(', ')}`);
  if (Array.isArray(js)) console.log(`      Array[${js.length}]`);
  if (r.body && len < 2500) console.log(`      ${r.body.slice(0, 600).replace(/\s+/g, ' ')}`);
  return { js, len };
}

const QS = 'CurrencyId=XAF&LanguageId=fr&PartnerId=2&PartnerName=casongo&TimeZone=1';

// ═════ 1. AVEC JWT — /hapi/velisports/* et prod-api.velisports.com ═════
console.log('══ 1. AVEC BEARER TOKEN sur /hapi/velisports/* ══\n');
const endpoints = [
  '/hapi/velisports/websitewebapi/WebSite/GetMatches?SportId=1&' + QS,
  '/hapi/velisports/websitewebapi/WebSite/GetPrematchMatches?SportId=1&' + QS,
  '/hapi/velisports/websitewebapi/WebSite/GetSports?' + QS,
  '/hapi/velisports/websitewebapi/WebSite/GetSportEvents?SportId=1&' + QS,
  '/hapi/velisports/websitewebapi/WebSite/GetLeagues?SportId=1&' + QS,
  '/hapi/velisports/websitewebapi/WebSite/GetTournaments?SportId=1&' + QS,
  '/hapi/velisports/websitewebapi/WebSite/GetMarketTypeGroups?' + QS,
  '/hapi/velisports/websitewebapi/WebSite/GetMatchById?MatchId=2504990&' + QS,
  '/hapi/velisports/websitewebapi/WebSite/GetMatchByMatchTournamentId?MatchTournamentId=14075592&' + QS,
  '/hapi/velisports/websitewebapi/WebSite/GetTopMatches?SportId=1&' + QS,
  '/hapi/velisports/websitewebapi/WebSite/GetCategories?SportId=1&' + QS,
  '/hapi/velisports/websitewebapi/WebSite/GetPrematchTree?SportId=1&' + QS,
  '/hapi/velisports/websitewebapi/WebSite/GetPrematchLeagues?SportId=1&' + QS,
];
for (const p of endpoints) summary(await req(`https://casongo.cg${p}`, { headers: H_AUTH }), p);

// ═════ 2. Direct sur prod-api.velisports.com (via GitHub Actions — CF blocké mais essayons) ═════
console.log('\n══ 2. DIRECT prod-api.velisports.com AVEC TOKEN ══\n');
const direct = [
  'https://prod-api.velisports.com/websitewebapi/WebSite/GetMatchById?MatchId=2504990&' + QS,
  'https://prod-api.velisports.com/websitewebapi/WebSite/GetMarketTypeGroups?' + QS,
  'https://prod-api.velisports.com/websitewebapi/WebSite/GetSports?' + QS,
];
for (const url of direct) summary(await req(url, { headers: H_AUTH }), url);

// ═════ 3. Grep TOUS les 35 chunks Next.js pour endpoints ═════
console.log('\n══ 3. GREP TOUS CHUNKS NEXT.JS (35) ══\n');
const home = await req('https://casongo.cg/fr-CG', { headers: { 'User-Agent': UA } });
const scripts = new Set();
if (home.body) {
  for (const m of home.body.matchAll(/<script[^>]*src=["']([^"']+)["']/gi)) {
    let u = m[1];
    if (u.startsWith('/')) u = 'https://casongo.cg' + u;
    scripts.add(u);
  }
}
console.log(`  Scripts: ${scripts.size}`);
const apiPaths = new Set();
const hosts = new Set();
const gets = new Set();
for (const s of scripts) {
  const r = await req(s, { headers: { 'User-Agent': UA } });
  if (r.status !== 200 || !r.body) continue;
  for (const m of r.body.matchAll(/["'`](\/hapi\/velisports\/[a-zA-Z0-9/_?=&.-]{2,150})["'`]/g)) apiPaths.add(m[1]);
  for (const m of r.body.matchAll(/["'`](\/(?:websitewebapi|api|WebSite)\/[a-zA-Z0-9/_?=&.-]{2,150})["'`]/g)) apiPaths.add(m[1]);
  for (const m of r.body.matchAll(/["'`](Get[A-Z][a-zA-Z0-9]{3,40})["'`]/g)) gets.add(m[1]);
  for (const m of r.body.matchAll(/["'`](https?:\/\/[a-z0-9.-]*(?:velisports|veligroup|betgenius|casongo)[a-z0-9.-]*\.[a-z]{2,6})/gi)) hosts.add(m[1]);
}
console.log(`\n  → /hapi ou /api paths (${apiPaths.size}):`);
[...apiPaths].sort().slice(0, 40).forEach((p) => console.log(`     ${p}`));
console.log(`\n  → Get* method names (${gets.size}):`);
[...gets].sort().forEach((g) => console.log(`     ${g}`));
console.log(`\n  → Hosts velisports (${hosts.size}):`);
[...hosts].forEach((h) => console.log(`     ${h}`));

console.log('\n▶ Fin.');
process.exit(0);
