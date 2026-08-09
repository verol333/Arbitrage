#!/usr/bin/env node
// PROBE LNBPARI APG — utilise les headers Betster reels captures depuis le
// navigateur du user. API accessible SANS auth user, juste avec x-api-key
// publique + x-application-id + x-clientid embarques dans le JS bundle.

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  Accept: '*/*',
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
  'x-extensionname': 'cms-extension',
  'x-extensionversion': '1.10.0',
};

async function req(url, opts = {}) {
  const { method = 'GET', body, timeoutMs = 12_000, extraHeaders = {} } = opts;
  try {
    const res = await fetch(url, {
      method, body,
      signal: AbortSignal.timeout(timeoutMs),
      headers: { ...HEADERS, ...extraHeaders },
    });
    return { status: res.status, body: await res.text(), ct: res.headers.get('content-type') };
  } catch (e) { return { status: 0, body: null, err: e.message }; }
}

console.log('▶ LNBPARI /apg/v0/ PROBE (avec headers Betster reels)\n');

// ═══ 1. Reproduire la requete exacte ═══
console.log('══ 1. REPLICATE /apg/v0/widgets/v0/application ══');
const r1 = await req('https://lnbpari.com/apg/v0/widgets/v0/application');
console.log(`  status=${r1.status} ct=${r1.ct?.split(';')[0]} len=${r1.body?.length || 0}`);
if (r1.body && r1.ct?.includes('json')) {
  try {
    const j = JSON.parse(r1.body);
    console.log(`  Keys top-level: ${Object.keys(j).slice(0, 20).join(', ')}`);
    console.log(`  Sample first 2000:\n${JSON.stringify(j, null, 2).slice(0, 2000)}`);
  } catch { console.log(`  raw first 1000: ${r1.body.slice(0, 1000)}`); }
}

// ═══ 2. Brute force endpoints /apg/v0/ ═══
console.log('\n══ 2. BRUTEFORCE /apg/v0/ ENDPOINTS ══');
const candidates = [
  // Sports/prematch
  '/apg/v0/sports',
  '/apg/v0/sports/list',
  '/apg/v0/sportsbook/sports',
  '/apg/v0/sportsbook/prematch',
  '/apg/v0/sportsbook/prematch/sports',
  '/apg/v0/sportsbook/prematch/tournaments',
  '/apg/v0/sportsbook/prematch/events',
  '/apg/v0/sportsbook/prematch/events/list',
  '/apg/v0/prematch',
  '/apg/v0/prematch/sports',
  '/apg/v0/prematch/tournaments',
  '/apg/v0/prematch/events',
  '/apg/v0/prematch/events?sportId=1',
  '/apg/v0/prematch/events?sport_id=1',
  '/apg/v0/prematch/events?sport=Soccer',
  '/apg/v0/tournaments',
  '/apg/v0/tournaments/list',
  '/apg/v0/tournaments/list?sportId=1',
  '/apg/v0/events',
  '/apg/v0/events/list',
  '/apg/v0/events?sport=Soccer',
  '/apg/v0/matches',
  '/apg/v0/matches/list',
  '/apg/v0/matches/prematch',
  '/apg/v0/odds',
  '/apg/v0/markets',
  // Widgets variants
  '/apg/v0/widgets/v0/prematch',
  '/apg/v0/widgets/v0/sportsbook',
  '/apg/v0/widgets/v0/events',
  '/apg/v0/widgets/v0/sports',
  '/apg/v0/widgets/v0/tournaments',
  // API root discovery
  '/apg/v0/',
  '/apg/',
  '/apg/v0/config',
  '/apg/v0/sportsbook/config',
];

const promising = [];
for (const p of candidates) {
  const r = await req(`https://lnbpari.com${p}`);
  const isJson = r.ct?.includes('json');
  const is242 = r.body?.length >= 242000 && r.body?.length < 243000;
  const isNotFound = r.body === '404 page not found' || r.body === '404 page not found\n';
  if (is242 || isNotFound) continue; // skip noise
  const prev = r.body ? r.body.slice(0, 200).replace(/\s+/g, ' ') : '';
  const tag = isJson ? '✅ JSON' : r.status === 200 ? '⚠️ 200-nonjson' : `⚠️ ${r.status}`;
  console.log(`  ${tag} len=${r.body?.length || 0} ${p}${prev ? ' | ' + prev.slice(0, 150) : ''}`);
  if (isJson && r.body.length > 3) promising.push({ p, len: r.body.length, sample: r.body.slice(0, 500) });
}

// ═══ 3. Recap endpoints prometteurs ═══
if (promising.length) {
  console.log(`\n══ 3. ENDPOINTS JSON PROMETTEURS (${promising.length}) ══`);
  for (const e of promising) {
    console.log(`\n  ▸ ${e.p} (${e.len}B)`);
    console.log(`    ${e.sample}`);
  }
}

console.log('\n▶ Fin.');
process.exit(0);
