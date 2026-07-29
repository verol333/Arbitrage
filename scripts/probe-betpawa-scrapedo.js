#!/usr/bin/env node
// Probe BetPawa v5 : trouve exact endpoints sportsbook/v3 pour events + odds

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
    body,
  };
}

const BASE = 'https://www.betpawa.ke';

console.log('=== 1 : fetch [[...page]] chunk pour lire endpoints reels ===');
const catchAll = await get(BASE + '/_next/static/chunks/pages/%5B%5B...page%5D%5D-5ca187021eb1ea15.js');
console.log(`  status=${catchAll.status} len=${catchAll.len}`);
if (catchAll.status === 200) {
  const eps = new Set();
  // Capture path templates like /api/sportsbook/v3/... including template literals ${}
  for (const m of catchAll.body.matchAll(/["'`](\/api\/sportsbook\/[^"'`\s]+)["'`]/g)) eps.add(m[1]);
  for (const m of catchAll.body.matchAll(/["'`](\/api\/betslip\/[^"'`\s]+)["'`]/g)) eps.add(m[1]);
  for (const m of catchAll.body.matchAll(/["'`](\/api\/integration\/[^"'`\s]+)["'`]/g)) eps.add(m[1]);
  console.log(`  ${eps.size} sportsbook/betslip/integration paths:`);
  [...eps].sort().forEach(p => console.log(`    ${p}`));
}

console.log('\n=== 2 : tester patterns evidents /api/sportsbook/v3/* ===');
const candidates = [
  '/api/sportsbook/v3/events?eventType=PRE_MATCH&categoryId=2',
  '/api/sportsbook/v3/events/upcoming?categoryId=2&hoursOffset=48',
  '/api/sportsbook/v3/sports',
  '/api/sportsbook/v3/categories',
  '/api/sportsbook/v3/competitions?categoryId=2',
  '/api/sportsbook/v2/events?type=PRE_MATCH',
  '/api/sportsbook/v3/menu?type=PRE_MATCH',
  '/api/sportsbook/v3/marketsCategories',
  '/api/sportsbook/v3/highlights?categoryId=2',
];
for (const p of candidates) {
  const r = await get(BASE + p);
  const preview = r.body.slice(0, 250).replace(/\s+/g, ' ');
  console.log(`  ${p}: status=${r.status} len=${r.len} isJson=${r.isJson}`);
  console.log(`    ↳ ${preview}`);
}

console.log('\n=== 3 : tester avec headers x-pawa-brand / x-pawa-language ===');
// BetPawa often uses x-pawa-* custom headers
const headers = 'x-pawa-brand:betpawa-kenya|x-pawa-language:en';
for (const p of ['/api/sportsbook/v3/menu?type=PRE_MATCH', '/api/sportsbook/v3/sports']) {
  const r = await get(BASE + p, {
    customHeaders: 'true',
    forwardHeaders: 'x-pawa-brand,x-pawa-language',
  });
  console.log(`  ${p}: status=${r.status} len=${r.len} isJson=${r.isJson}`);
  console.log(`    ↳ ${r.body.slice(0, 200).replace(/\s+/g, ' ')}`);
}

console.log('\n=== FIN ===');
