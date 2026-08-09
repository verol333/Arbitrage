#!/usr/bin/env node
// PROBE LNBPARI TOURNAMENTS — trouve les params pour /api/v1/tournaments/list
// + brute force siblings paths sport/matches/events avec sportId etc.
//
// Backend detecte: Go/Echo (404="page not found" 18B vs SPA shell 242KB).

async function req(url, opts = {}) {
  const { method = 'GET', headers = {}, body, timeoutMs = 8_000 } = opts;
  try {
    const res = await fetch(url, {
      method, body,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120',
        Accept: 'application/json',
        'Accept-Language': 'fr,fr-FR;q=0.9,en;q=0.8',
        'Content-Type': 'application/json',
        Origin: 'https://lnbpari.com',
        Referer: 'https://lnbpari.com/',
        ...headers,
      },
    });
    return { status: res.status, body: await res.text(), ct: res.headers.get('content-type') };
  } catch (e) { return { status: 0, body: null, err: e.message }; }
}

function classify(r) {
  if (!r.body) return 'ERR';
  if (r.body.length >= 242000 && r.body.length < 243000) return 'HTML-SHELL';
  if (r.body === '404 page not found' || r.body === '404 page not found\n') return 'NOT-FOUND';
  if (r.status === 401) return 'AUTH-REQ';
  if (r.status === 405) return 'METH-BAD';
  if (r.ct?.includes('json')) return 'JSON';
  return `OTHER-${r.status}`;
}

console.log('▶ LNBPARI TOURNAMENTS + BRUTEFORCE\n');

// ═══ 1. Test /api/v1/tournaments/list avec differents params ═══
console.log('══ 1. TOURNAMENTS LIST variantes ══');
const tournamentVariants = [
  '/api/v1/tournaments/list',
  '/api/v1/tournaments/list?sportId=1',
  '/api/v1/tournaments/list?sport_id=1',
  '/api/v1/tournaments/list?sport=1',
  '/api/v1/tournaments/list?sport=Soccer',
  '/api/v1/tournaments/list?sport=soccer',
  '/api/v1/tournaments/list?lineType=prematch',
  '/api/v1/tournaments/list?type=prematch',
  '/api/v1/tournaments/list?prematch=true',
  '/api/v1/tournaments/list?sportId=1&lineType=prematch',
  '/api/v1/tournaments/list?category=1',
  '/api/v1/tournaments/list?categoryId=1',
  '/api/v1/tournaments/list?limit=100',
  '/api/v1/tournaments/list?playerId=1',
  '/api/v1/tournaments/list?language=fr',
];
const jsonResults = [];
for (const p of tournamentVariants) {
  const r = await req(`https://lnbpari.com${p}`);
  const cls = classify(r);
  const prev = r.body ? r.body.slice(0, 200).replace(/\s+/g, ' ') : '';
  console.log(`  [${cls}] status=${r.status} len=${r.body?.length || 0} ${p}${cls === 'JSON' ? ' | ' + prev : ''}`);
  if (cls === 'JSON' && r.body.length > 3) jsonResults.push({ p, len: r.body.length, prev });
}

// ═══ 2. POST variantes ═══
console.log('\n══ 2. POST variantes ══');
const postBodies = [
  { url: '/api/v1/tournaments/list', body: '{}' },
  { url: '/api/v1/tournaments/list', body: '{"sportId":1}' },
  { url: '/api/v1/tournaments/list', body: '{"sport":"Soccer"}' },
  { url: '/api/v1/tournaments/list', body: '{"lineType":"prematch"}' },
  { url: '/api/v1/tournaments/list', body: '{"filter":{"sportId":1}}' },
  { url: '/api/v2/tournaments/list', body: '{"sportId":1}' },
];
for (const t of postBodies) {
  const r = await req(`https://lnbpari.com${t.url}`, { method: 'POST', body: t.body });
  const cls = classify(r);
  const prev = r.body ? r.body.slice(0, 200).replace(/\s+/g, ' ') : '';
  console.log(`  [${cls}] status=${r.status} len=${r.body?.length || 0} POST ${t.url} body=${t.body}${cls === 'JSON' ? ' | ' + prev : ''}`);
}

// ═══ 3. Brute force siblings paths ═══
console.log('\n══ 3. BRUTEFORCE PATHS ══');
const bruteforce = [
  // sports
  '/api/v1/sports/list', '/api/v1/sports', '/api/v2/sports/list', '/api/v2/sports',
  // categories
  '/api/v1/categories/list', '/api/v1/categories', '/api/v2/categories/list',
  // events
  '/api/v1/events/list', '/api/v1/events', '/api/v2/events/list',
  '/api/v1/events/prematch', '/api/v1/events/live',
  // matches
  '/api/v1/matches/list', '/api/v1/matches',
  // odds
  '/api/v1/odds/list', '/api/v1/odds',
  // markets
  '/api/v1/markets/list', '/api/v1/markets',
  // Combinaisons plurals/singular
  '/api/v1/tournament/list', '/api/v1/sport/list',
  // Prematch specifique
  '/api/v1/prematch/tournaments/list',
  '/api/v1/prematch/events/list',
  '/api/v1/prematch/sports/list',
  '/api/v1/prematch/categories/list',
  // Line type
  '/api/v1/line/prematch',
  '/api/v1/line/list',
];
for (const p of bruteforce) {
  const r = await req(`https://lnbpari.com${p}`);
  const cls = classify(r);
  if (cls === 'HTML-SHELL' || cls === 'NOT-FOUND') continue; // skip noise
  const prev = r.body ? r.body.slice(0, 200).replace(/\s+/g, ' ') : '';
  console.log(`  [${cls}] status=${r.status} len=${r.body?.length || 0} ${p}${prev ? ' | ' + prev.slice(0, 120) : ''}`);
}

// ═══ 4. Meme paths avec sportId=1 ═══
console.log('\n══ 4. BRUTEFORCE avec ?sportId=1 ══');
for (const p of bruteforce.slice(0, 20)) {
  const r = await req(`https://lnbpari.com${p}?sportId=1`);
  const cls = classify(r);
  if (cls === 'HTML-SHELL' || cls === 'NOT-FOUND') continue;
  const prev = r.body ? r.body.slice(0, 200).replace(/\s+/g, ' ') : '';
  console.log(`  [${cls}] status=${r.status} len=${r.body?.length || 0} ${p}?sportId=1${prev ? ' | ' + prev.slice(0, 120) : ''}`);
}

// Recap
if (jsonResults.length) {
  console.log('\n══ JSON PAYLOAD PROMETTEURS ══');
  jsonResults.forEach((r) => console.log(`  ${r.p} → ${r.len}B | ${r.prev}`));
}

console.log('\n▶ Fin.');
process.exit(0);
