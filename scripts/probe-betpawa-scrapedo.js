#!/usr/bin/env node
// Probe BetPawa v4 : grep MAIN bundle + inspect SSR data injecte dans HTML

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

console.log('=== 1 : fetch /events (contient SSR data probablement) ===');
const events = await get(BASE + '/events');
console.log(`  status=${events.status} len=${events.len}`);
// Find __NEXT_DATA__ payload
const nextDataMatch = events.body.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
if (nextDataMatch) {
  try {
    const nd = JSON.parse(nextDataMatch[1]);
    console.log(`  __NEXT_DATA__ found, ${nextDataMatch[1].length} bytes`);
    console.log(`  page: ${nd.page || '?'}`);
    console.log(`  buildId: ${nd.buildId || '?'}`);
    console.log(`  runtimeConfig keys: ${Object.keys(nd.runtimeConfig || {}).join(',')}`);
    console.log(`  props keys: ${Object.keys(nd.props || {}).join(',')}`);
    if (nd.runtimeConfig) console.log(`  runtimeConfig: ${JSON.stringify(nd.runtimeConfig).slice(0, 400)}`);
    // pageProps might contain initial events
    const pp = nd.props?.pageProps;
    if (pp) {
      console.log(`  pageProps keys: ${Object.keys(pp).join(',')}`);
      console.log(`  pageProps sample: ${JSON.stringify(pp).slice(0, 500)}`);
    }
  } catch (e) {
    console.log(`  __NEXT_DATA__ parse error: ${e.message}`);
    console.log(`  raw: ${nextDataMatch[1].slice(0, 400)}`);
  }
} else {
  console.log('  no __NEXT_DATA__ found');
}

console.log('\n=== 2 : fetch env.js pour identifier API base URL ===');
const env = await get(BASE + '/env.js?v=2.236.103');
console.log(`  status=${env.status} len=${env.len}`);
console.log(`  content: ${env.body.slice(0, 1500)}`);

console.log('\n=== 3 : fetch main JS chunk et grep /api/ patterns ===');
const main = await get(BASE + '/_next/static/chunks/main-c36231d4f7515711.js');
console.log(`  status=${main.status} len=${main.len}`);
if (main.status === 200) {
  const apiPaths = new Set();
  for (const m of main.body.matchAll(/["'`](\/api\/[a-zA-Z0-9\/_.-]+)["'`]/g)) apiPaths.add(m[1]);
  for (const m of main.body.matchAll(/["'`](https?:\/\/[a-z0-9.-]+\.betpawa\.[a-z]+[^"'`\s]*)["'`]/gi)) apiPaths.add(m[0]);
  console.log(`  ${apiPaths.size} API paths:`);
  [...apiPaths].slice(0, 40).forEach(p => console.log(`    ${p}`));
}

console.log('\n=== 4 : lister tous les chunks _app + _document + pages ===');
const chunks = [
  '/_next/static/chunks/pages/_app-',
  '/_next/static/chunks/pages/index-',
  '/_next/static/chunks/pages/events-',
];
// Extract exact chunk paths from shell
const shell = await get(BASE + '/');
const chunkPaths = [...shell.body.matchAll(/["']([^"']*\/_next\/static\/chunks\/pages\/[^"']+\.js)["']/g)].map(m => m[1]);
console.log(`  pages chunks in shell: ${chunkPaths.length}`);
chunkPaths.slice(0, 8).forEach(p => console.log(`    ${p}`));

// Fetch _app chunk (typically has API config)
const appChunk = chunkPaths.find(p => p.includes('_app'));
if (appChunk) {
  console.log(`\n  ↳ fetching ${appChunk}`);
  const app = await get(BASE + appChunk);
  console.log(`  status=${app.status} len=${app.len}`);
  const apiPaths = new Set();
  for (const m of app.body.matchAll(/["'`](\/api\/[a-zA-Z0-9\/_.\-{}]+)["'`]/g)) apiPaths.add(m[1]);
  console.log(`  ${apiPaths.size} API paths in _app:`);
  [...apiPaths].slice(0, 30).forEach(p => console.log(`    ${p}`));
}

console.log('\n=== FIN ===');
