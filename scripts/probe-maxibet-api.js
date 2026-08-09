#!/usr/bin/env node
// PROBE MAXIBET API — trouve l'API interne via reverse-engineering des JS bundles
//
// Strategies :
//   1. Fetch HTML listing brut → extract data-eventid + hrefs match
//   2. Fetch JS bundles (MarketEventNew, GameDetails, etc.) → grep API URLs
//   3. Jina avec wait-for-selector pour force lazy-load
//   4. Test URLs API decouvertes

async function jina(url, opts = {}) {
  const { format = 'text', timeoutMs = 45_000, extra = {} } = opts;
  const headers = { Accept: '*/*', 'X-Return-Format': format, ...extra };
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      signal: AbortSignal.timeout(timeoutMs), headers,
    });
    if (!res.ok) return { status: res.status, body: null };
    return { status: res.status, body: await res.text() };
  } catch (e) {
    return { status: 0, body: null, err: e.message };
  }
}

console.log('▶ MAXIBET API DISCOVERY\n');

// ═══ 1. HTML listing full pour extraire eventIds + JS bundles ═══
console.log('══ 1. HTML LISTING (extract eventIds + bundles) ══');
const html = await jina('https://m.maxibet.bet/fr/sports/prematch/Soccer', { format: 'html', timeoutMs: 60_000 });
console.log(`  status=${html.status} len=${html.body?.length || 0}`);

const jsBundles = new Set();
const eventIds = new Set();
const dataAttrs = new Set();
const apiCalls = new Set();

if (html.body) {
  // JS bundles
  for (const m of html.body.matchAll(/["'](\/assets\/[^"'\s]+\.js)["']/g)) jsBundles.add(m[1]);
  // Data attributes
  for (const m of html.body.matchAll(/data-(event-?id|game-?id|match-?id|betradar-?id)=["']?(\d+)["']?/gi)) {
    dataAttrs.add(`${m[1]}=${m[2]}`);
    eventIds.add(m[2]);
  }
  // Any large digits in URL fragments
  for (const m of html.body.matchAll(/["'](?:\/fr\/sports\/(?:event|match|pre-?match)\/[^"'\s]*?)(\d{7,15})[^"'\s]*["']/g)) {
    eventIds.add(m[1]);
  }
  // API-like URLs in inline scripts
  for (const m of html.body.matchAll(/["'](https?:\/\/[^"'\s]*?(?:api|graphql)[^"'\s]*)["']/gi)) apiCalls.add(m[1].slice(0, 200));
  for (const m of html.body.matchAll(/["'](\/api\/[^"'\s]+)["']/g)) apiCalls.add(m[1].slice(0, 200));

  console.log(`  JS bundles: ${jsBundles.size}`);
  console.log(`  data-*id attrs: ${dataAttrs.size} → ${[...dataAttrs].slice(0, 5).join(', ')}`);
  console.log(`  event IDs candidats: ${eventIds.size} → ${[...eventIds].slice(0, 5).join(', ')}`);
  console.log(`  API URLs dans HTML: ${apiCalls.size} → ${[...apiCalls].slice(0, 10).join(' | ')}`);

  // Cherche aussi window.__INITIAL_STATE__, window.__PRELOADED_STATE__, __NEXT_DATA__
  const initialState = html.body.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]{0,10000}?})[;<]/);
  if (initialState) console.log(`  __INITIAL_STATE__ found ${initialState[1].length}B (first 500): ${initialState[1].slice(0, 500)}`);
  const nextData = html.body.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]{0,15000}?)<\/script>/);
  if (nextData) console.log(`  __NEXT_DATA__ found ${nextData[1].length}B (first 800): ${nextData[1].slice(0, 800)}`);
}

// ═══ 2. Fetch JS bundles cles pour trouver API endpoints ═══
console.log('\n══ 2. JS BUNDLES (grep API URLs) ══');
const targetBundles = [...jsBundles].filter((u) => /Market|Game|Event|API|Details|Odds/i.test(u)).slice(0, 4);
console.log(`  Bundles cibles (${targetBundles.length}) : ${targetBundles.join(', ')}`);
const apiFromBundles = new Set();
for (const bundle of targetBundles) {
  const url = `https://m.maxibet.bet${bundle}`;
  // JS bundles sont statiques, on peut essayer direct fetch (probablement pas CF-blocked)
  const r = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120' },
  }).catch((e) => ({ err: e.message }));
  if (r.err) { console.log(`  ❌ ${bundle}: ${r.err}`); continue; }
  if (!r.ok) { console.log(`  ❌ ${bundle}: HTTP ${r.status}`); continue; }
  const src = await r.text();
  console.log(`  ✅ ${bundle}: ${src.length}B`);
  // Search fetch/axios URLs
  for (const m of src.matchAll(/["'`]((?:https?:)?\/\/[^"'`\s]*?\/(?:api|graphql|v\d+)[^"'`\s]*)["'`]/g)) apiFromBundles.add(m[1].slice(0, 200));
  for (const m of src.matchAll(/fetch\s*\(\s*["'`]([^"'`]+)["'`]/g)) apiFromBundles.add(m[1].slice(0, 200));
  for (const m of src.matchAll(/["'`](\/(?:api|graphql|v\d+)\/[^"'`\s]*)["'`]/g)) apiFromBundles.add(m[1].slice(0, 200));
  // baseURL / axios instance patterns
  const baseUrl = src.match(/baseURL:\s*["']([^"']+)["']|API_(?:URL|BASE|HOST):\s*["']([^"']+)["']/);
  if (baseUrl) console.log(`    → baseURL/API_HOST : ${baseUrl[0].slice(0, 200)}`);
  // Environment variables
  for (const m of src.matchAll(/["']((?:VITE|REACT_APP|NEXT_PUBLIC)_[A-Z_]+)["']\s*[:,]\s*["']([^"']+)["']/g)) {
    console.log(`    → env: ${m[1]}=${m[2]}`);
  }
}
console.log(`\n  Total API URLs decouvertes : ${apiFromBundles.size}`);
[...apiFromBundles].slice(0, 25).forEach((u) => console.log(`    - ${u}`));

// ═══ 3. Test URLs API decouvertes ═══
console.log('\n══ 3. TEST APIS DECOUVERTES ══');
const toTest = [...apiFromBundles].filter((u) => !/casino|slots|game-view|virtual|jackpot|payment|user|auth|login|balance|deposit/i.test(u)).slice(0, 8);
console.log(`  URLs testables (${toTest.length}) :`);
for (const rawUrl of toTest) {
  const url = rawUrl.startsWith('http') ? rawUrl : `https://m.maxibet.bet${rawUrl}`;
  const r = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120',
      'Accept': 'application/json',
      'Origin': 'https://m.maxibet.bet',
      'Referer': 'https://m.maxibet.bet/',
    },
  }).catch((e) => ({ err: e.message }));
  if (r.err) { console.log(`  ❌ ${url.slice(-80)} : ${r.err}`); continue; }
  const t = r.ok ? await r.text() : '';
  console.log(`  status=${r.status} len=${t.length} ${url.slice(-90)}${t ? ' | ' + t.slice(0, 100).replace(/\s+/g, ' ') : ''}`);
}

console.log('\n▶ Fin.');
process.exit(0);
