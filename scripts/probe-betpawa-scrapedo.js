#!/usr/bin/env node
// Probe BetPawa v6 : render=true sur /events pour capturer HTML hydraté

const TOKEN = process.env.SCRAPE_DO_KEY;
if (!TOKEN) { console.log('SCRAPE_DO_KEY missing'); process.exit(1); }

async function get(targetUrl, params = {}) {
  const qs = new URLSearchParams({ token: TOKEN, url: targetUrl, ...params }).toString();
  const start = Date.now();
  const res = await fetch(`https://api.scrape.do/?${qs}`, {
    method: 'GET', signal: AbortSignal.timeout(90_000),
  });
  const body = await res.text();
  return {
    ms: Date.now() - start, status: res.status, len: body.length,
    isJson: body.trim().startsWith('{') || body.trim().startsWith('['),
    body,
  };
}

const BASE = 'https://www.betpawa.ke';

console.log('=== 1 : render=true sur /events/list/upcoming (5 credits) ===');
const rendered = await get(BASE + '/events/list/upcoming', {
  render: 'true',
  customWait: '3000',
});
console.log(`  status=${rendered.status} len=${rendered.len} ms=${rendered.ms}`);
// look for odds patterns like data-testid, event ids, odd values
const oddsMatches = [...rendered.body.matchAll(/(\d\.\d{2,3})/g)].map(m => m[1]);
console.log(`  numeric odds-like values: ${oddsMatches.length}`);
console.log(`  sample: ${oddsMatches.slice(0, 20).join(', ')}`);

// Search for links to events (usually /event/{id}/...)
const eventLinks = [...rendered.body.matchAll(/href="([^"]*\/event\/[^"]+)"/g)].map(m => m[1]);
console.log(`  event links: ${eventLinks.length}`);
eventLinks.slice(0, 10).forEach(l => console.log(`    ${l}`));

// Look for team names in typical patterns
const teams = [...rendered.body.matchAll(/data-testid="event-(?:home|away)-team[^"]*"[^>]*>([^<]+)</g)]
  .map(m => m[1]);
console.log(`  team names: ${teams.length}`);
teams.slice(0, 10).forEach(t => console.log(`    ${t}`));

// Dump first 800 chars of body middle (skip Next.js boilerplate at start)
const mid = rendered.body.slice(2000, 4000).replace(/\s+/g, ' ');
console.log(`  body middle: ${mid.slice(0, 800)}`);

console.log('\n=== 2 : chercher URLs API dans HTML rendu ===');
const apiUrls = new Set();
for (const m of rendered.body.matchAll(/["'`](\/api\/[a-zA-Z0-9\/_.\-{}]+)["'`]/g)) apiUrls.add(m[1]);
for (const m of rendered.body.matchAll(/(https?:\/\/[a-z0-9.-]+\/api\/[a-zA-Z0-9\/_.\-{}]+)/gi)) apiUrls.add(m[0]);
console.log(`  ${apiUrls.size} API-like URLs:`);
[...apiUrls].slice(0, 30).forEach(u => console.log(`    ${u}`));

console.log('\n=== 3 : tester chunks framework + webpack + main-app ===');
const shell = await get(BASE + '/');
const allChunks = [...shell.body.matchAll(/["']([^"']*\/_next\/static\/chunks\/[^"']+\.js)["']/g)].map(m => m[1]);
console.log(`  total chunks in shell: ${allChunks.length}`);
allChunks.forEach(c => console.log(`    ${c}`));

// Fetch webpack chunk which contains route manifest
const webpackChunk = allChunks.find(c => c.includes('webpack-'));
if (webpackChunk) {
  console.log(`\n  ↳ fetching webpack chunk ${webpackChunk}`);
  const w = await get(BASE + webpackChunk);
  console.log(`  status=${w.status} len=${w.len}`);
  const chunkIds = [...w.body.matchAll(/(\d{4,5})/g)].map(m => m[1]);
  console.log(`  chunk numeric IDs: ${chunkIds.length}`);
}

console.log('\n=== FIN ===');
