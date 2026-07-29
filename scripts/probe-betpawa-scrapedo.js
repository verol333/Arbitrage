#!/usr/bin/env node
// Probe BetPawa v3 : sports-api.betpawa.<TLD> ne resolve pas.
// On explore www.betpawa.ke/* pour identifier le vrai endpoint API.

const TOKEN = process.env.SCRAPE_DO_KEY;
if (!TOKEN) { console.log('SCRAPE_DO_KEY missing'); process.exit(1); }

async function get(targetUrl, params = {}) {
  const qs = new URLSearchParams({ token: TOKEN, url: targetUrl, ...params }).toString();
  const start = Date.now();
  const res = await fetch(`https://api.scrape.do/?${qs}`, {
    method: 'GET', signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  return {
    ms: Date.now() - start, status: res.status, len: body.length,
    isJson: body.trim().startsWith('{') || body.trim().startsWith('['),
    isCf: /cloudflare|just a moment|attention required/i.test(body.slice(0, 500)),
    body,
  };
}

const BASE = 'https://www.betpawa.ke';

console.log('=== 1 : dump SPA shell www.betpawa.ke/ pour extraire endpoints ===');
const shell = await get(BASE + '/');
console.log(`  status=${shell.status} len=${shell.len}`);
// Extract JS bundle URLs and API-like patterns
const jsMatches = [...shell.body.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
console.log(`  JS bundles found: ${jsMatches.length}`);
jsMatches.slice(0, 5).forEach(u => console.log(`    ${u}`));
const apiHints = [...shell.body.matchAll(/(https?:\/\/[^"\s'<>]+(?:api|events|odds|sports)[^"\s'<>]*)/gi)]
  .map(m => m[1]).slice(0, 10);
console.log(`  API-like URLs in shell: ${apiHints.length}`);
apiHints.forEach(u => console.log(`    ${u}`));

console.log('\n=== 2 : tester routes SSR /upcoming/football, /events, /event/... ===');
const routes = [
  '/upcoming/football',
  '/events',
  '/live',
  '/sports/football',
];
for (const r of routes) {
  const res = await get(BASE + r);
  const preview = res.body.slice(0, 200).replace(/\s+/g, ' ');
  const hasOdds = /(\d\.\d{2,})/.test(res.body);
  console.log(`  ${r}: status=${res.status} len=${res.len} hasOddsPattern=${hasOdds}`);
  console.log(`    preview: ${preview}`);
}

console.log('\n=== 3 : tester patterns API relatifs ===');
const apiRoutes = [
  '/api/sports-service/v1/sports/events-count?eventState=PRE_MATCH',
  '/api/sports-service/v1/events/upcoming?sportId=1&limit=5',
  '/_next/data/latest/upcoming/football.json',
  '/api/v1/sports',
  '/api/events',
];
for (const r of apiRoutes) {
  const res = await get(BASE + r);
  const preview = res.body.slice(0, 200).replace(/\s+/g, ' ');
  console.log(`  ${r}: status=${res.status} len=${res.len} isJson=${res.isJson}`);
  console.log(`    preview: ${preview}`);
}

console.log('\n=== 4 : chercher subdomains dans les JS bundles ===');
// Fetch first JS bundle and grep for URL patterns
if (jsMatches.length > 0) {
  const bundleUrl = jsMatches[0].startsWith('http') ? jsMatches[0] : BASE + jsMatches[0];
  console.log(`  fetching ${bundleUrl}`);
  const bundle = await get(bundleUrl);
  console.log(`  status=${bundle.status} len=${bundle.len}`);
  const urls = new Set();
  for (const m of bundle.body.matchAll(/(?:https?:)?\/\/[a-z0-9.-]+\.betpawa\.[a-z]{2,3}[^"'\s`)]*/gi)) urls.add(m[0]);
  for (const m of bundle.body.matchAll(/["'](\/api[^"'`\s]*)["']/g)) urls.add(m[1]);
  for (const m of bundle.body.matchAll(/["'](\/v\d\/[^"'`\s]*)["']/g)) urls.add(m[1]);
  console.log(`  ${urls.size} unique API-ish URLs in bundle:`);
  [...urls].slice(0, 30).forEach(u => console.log(`    ${u}`));
}

console.log('\n=== FIN ===');
