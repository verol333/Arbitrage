#!/usr/bin/env node
// Probe BetPawa v7 : grep TOUS chunks anonymes pour trouver endpoint exact

const TOKEN = process.env.SCRAPE_DO_KEY;
if (!TOKEN) { console.log('SCRAPE_DO_KEY missing'); process.exit(1); }

async function get(targetUrl, params = {}) {
  const qs = new URLSearchParams({ token: TOKEN, url: targetUrl, ...params }).toString();
  const res = await fetch(`https://api.scrape.do/?${qs}`, {
    method: 'GET', signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  return { status: res.status, len: body.length, body };
}

const BASE = 'https://www.betpawa.ke';

const shell = await get(BASE + '/');
const chunks = [...shell.body.matchAll(/["']([^"']*\/_next\/static\/chunks\/[^"']+\.js)["']/g)].map(m => m[1]);
console.log(`=== ${chunks.length} chunks à scanner ===`);

const allEndpoints = new Set();
const bySrc = {};

for (const chunk of chunks) {
  if (chunk.includes('polyfill') || chunk.includes('build-version') || chunk.includes('zod') || chunk.includes('calculator') || chunk.includes('redux') || chunk.includes('proto-json') || chunk.includes('webpack')) continue;
  const c = await get(BASE + chunk);
  if (c.status !== 200) { console.log(`  ✗ ${chunk} status=${c.status}`); continue; }

  const eps = new Set();
  // Match static paths
  for (const m of c.body.matchAll(/["'`](\/api\/[a-zA-Z0-9\/_.\-]+)["'`]/g)) eps.add(m[1]);
  // Match template literals starting with /api/sportsbook
  for (const m of c.body.matchAll(/`(\/api\/sportsbook[^`]{0,200})`/g)) eps.add('TMPL:' + m[1]);
  // Match concatenations like "/api/sportsbook/v3/" + something
  for (const m of c.body.matchAll(/["'](\/api\/sportsbook\/v\d[^"']*)["']/g)) eps.add(m[1]);

  const short = chunk.split('/').pop().slice(0, 30);
  bySrc[short] = [...eps];
  eps.forEach(e => allEndpoints.add(e));
  console.log(`  ${short}: len=${c.len} eps=${eps.size}`);
}

console.log(`\n=== ${allEndpoints.size} endpoints uniques ===`);
[...allEndpoints].sort().forEach(e => console.log(`  ${e}`));

console.log('\n=== Par chunk ===');
for (const [src, eps] of Object.entries(bySrc)) {
  if (eps.length === 0) continue;
  console.log(`\n${src}:`);
  eps.slice(0, 20).forEach(e => console.log(`  ${e}`));
}

console.log('\n=== FIN ===');
