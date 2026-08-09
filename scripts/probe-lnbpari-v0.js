#!/usr/bin/env node
// PROBE LNBPARI /api/v0/ — pattern reel decouvert par F12 user :
//   /api/v0/sport/feed/localization/market-tabs?stage=1&sport=F&language=fr-BENIN
//
// Explore /api/v0/sport/feed/* pour trouver endpoints prematch/events/odds.

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  Origin: 'https://lnbpari.com',
  Referer: 'https://lnbpari.com/fr/',
  'x-api-key': '9ba6608f-c15b-4d37-83e8-bb89aa22d2e7',
  'x-application-id': '0e4a4d8d-46a5-483e-ba1c-893d909244ee',
  'x-clientid': '47042a87cc0faa478835774073a814cf',
  'x-teamname': 'common',
  'x-place': 'common_stage',
  'x-language': 'fr',
  'x-channel': 'MOBILE_WEB',
  'x-platform': 'web-mobile',
  'x-betsterversion': '2.4.0',
  'x-betster-team-consumer': 'common',
};

async function req(url, opts = {}) {
  const { timeoutMs = 10_000 } = opts;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: HEADERS,
    });
    return { status: res.status, body: await res.text(), ct: res.headers.get('content-type') };
  } catch (e) { return { status: 0, body: null, err: e.message }; }
}

function classify(r) {
  if (!r.body) return 'ERR';
  if (r.body.length >= 242000 && r.body.length < 243000) return 'SHELL';
  if (r.body === '404 page not found' || r.body === '404 page not found\n') return 'NF';
  if (r.status === 401) return 'AUTH';
  if (r.status === 405) return 'MBAD';
  if (r.ct?.includes('json')) return 'JSON';
  return `${r.status}`;
}

console.log('▶ LNBPARI /api/v0/ PROBE\n');

// ═══ 1. Confirmer market-tabs ═══
console.log('══ 1. CONFIRM market-tabs ══');
const r0 = await req('https://lnbpari.com/api/v0/sport/feed/localization/market-tabs?stage=1&sport=F&language=fr-BENIN');
console.log(`  status=${r0.status} ct=${r0.ct?.split(';')[0]} len=${r0.body?.length || 0}`);
if (r0.body && r0.body.length < 500) console.log(`  body: ${r0.body}`);

// ═══ 2. Discover /sport/feed/* endpoints ═══
console.log('\n══ 2. BRUTEFORCE /api/v0/sport/feed/* ══');
const BASE = 'https://lnbpari.com/api/v0/sport/feed';
const QS = '?stage=1&sport=F&language=fr-BENIN';
const QSs = ['?stage=1&sport=F&language=fr-BENIN', '?sport=F&language=fr-BENIN', '?language=fr-BENIN', ''];
const paths = [
  // Base level
  '',
  '/',
  // Sports/tournaments/events
  '/sports',
  '/tournaments',
  '/tournaments/list',
  '/tournaments/all',
  '/events',
  '/events/list',
  '/events/all',
  '/events/prematch',
  '/matches',
  '/matches/list',
  '/matches/prematch',
  // Prematch specific
  '/prematch',
  '/prematch/tournaments',
  '/prematch/events',
  '/prematch/sports',
  '/prematch/categories',
  // Categories
  '/categories',
  '/categories/list',
  // Odds/markets
  '/odds',
  '/markets',
  '/markets/list',
  // Localization variants (we know this pattern works)
  '/localization/sports',
  '/localization/tournaments',
  '/localization/events',
  '/localization/markets',
  '/localization/categories',
  '/localization/main',
  // Direct sports code
  '/F',
  '/F/tournaments',
  '/F/events',
  '/F/prematch',
  // Feed content
  '/content',
  '/content/prematch',
  '/data',
  '/data/prematch',
];

const jsonHits = [];
for (const p of paths) {
  for (const qs of QSs) {
    const url = `${BASE}${p}${qs}`;
    const r = await req(url);
    const cls = classify(r);
    if (cls === 'SHELL' || cls === 'NF' || cls === 'ERR') continue;
    const prev = r.body ? r.body.slice(0, 150).replace(/\s+/g, ' ') : '';
    console.log(`  [${cls}] status=${r.status} len=${r.body?.length || 0} ${p}${qs}${prev ? ' | ' + prev : ''}`);
    if (cls === 'JSON' && r.body.length > 3) jsonHits.push({ url, len: r.body.length, sample: r.body.slice(0, 500) });
    break; // Once we found non-shell/non-nf, no need to try other query strings for this path
  }
}

// ═══ 3. Autres prefixes potentiels ═══
console.log('\n══ 3. AUTRES PREFIXES /api/v0/* ══');
const prefixes = [
  '/api/v0/sport',
  '/api/v0/sportsbook',
  '/api/v0/betting',
  '/api/v0/prematch',
  '/api/v0/live',
  '/api/v0/config',
  '/api/v0/sport/prematch',
  '/api/v0/sport/config',
  '/api/v0/sport/tournaments',
  '/api/v0/sport/events',
  '/api/v0/sport/matches',
];
for (const p of prefixes) {
  const r = await req(`https://lnbpari.com${p}${QS}`);
  const cls = classify(r);
  if (cls === 'SHELL' || cls === 'NF' || cls === 'ERR') continue;
  const prev = r.body ? r.body.slice(0, 150).replace(/\s+/g, ' ') : '';
  console.log(`  [${cls}] status=${r.status} len=${r.body?.length || 0} ${p}${QS}${prev ? ' | ' + prev : ''}`);
  if (cls === 'JSON' && r.body.length > 3) jsonHits.push({ url: `https://lnbpari.com${p}${QS}`, len: r.body.length, sample: r.body.slice(0, 500) });
}

// ═══ 4. Test avec autres stages/sports ═══
console.log('\n══ 4. STAGE/SPORT VARIANTS ══');
const found = jsonHits[0]?.url || `${BASE}/localization/market-tabs${QS}`;
// Try stage=2, 3, other sport codes
const variants = [
  found.replace('stage=1', 'stage=2'),
  found.replace('stage=1', 'stage=0'),
  found.replace('sport=F', 'sport=B'), // Basket ?
  found.replace('sport=F', 'sport=T'), // Tennis ?
];
for (const url of variants) {
  const r = await req(url);
  const cls = classify(r);
  console.log(`  [${cls}] status=${r.status} len=${r.body?.length || 0} ${url}`);
}

// Recap
console.log(`\n══ JSON HITS (${jsonHits.length}) ══`);
for (const h of jsonHits.slice(0, 20)) {
  console.log(`  ▸ ${h.url} → ${h.len}B`);
  console.log(`    ${h.sample}`);
}

console.log('\n▶ Fin.');
process.exit(0);
