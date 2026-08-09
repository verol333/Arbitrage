#!/usr/bin/env node
// PROBE LNBPARI ENDPOINTS — grep exhaustif TOUS les strings /api/v[12]/xxx
// dans les 5 bundles + test chaque endpoint avec Accept: application/json
// pour trouver ceux qui retournent JSON (pas HTML shell 242KB).

async function req(url, opts = {}) {
  const { timeoutMs = 8_000 } = opts;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120',
        Accept: 'application/json',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        Origin: 'https://lnbpari.com',
        Referer: 'https://lnbpari.com/',
      },
    });
    return { status: res.status, body: await res.text(), ct: res.headers.get('content-type') };
  } catch (e) { return { status: 0, body: null, err: e.message }; }
}

async function get(url, opts = {}) {
  const r = await req(url, opts);
  return r;
}

console.log('▶ LNBPARI ENDPOINTS PROBE\n');

// ═══ 1. Fetch tous les bundles + grep /api paths ═══
const bundles = [
  'https://lnbpari.com/framework.5444ef5936ef393e6e79.js',
  'https://lnbpari.com/main.5fcd52623ca380d7a726.js',
  'https://lnbpari.com/shell.1785836544908.js',
  'https://lnbpari.com/69407.bdfc6415db8c60251867.js',
  'https://lnbpari.com/bootstrap.f939f1595817f0496fde.bundle.js',
];

const allPaths = new Set();
for (const bu of bundles) {
  const r = await get(bu, { timeoutMs: 20_000 });
  if (r.status !== 200) continue;
  const src = r.body;
  // Cherche /api/v[12]/... paths dans strings
  for (const m of src.matchAll(/["'`](\/api\/v[12]\/[a-zA-Z0-9/_:.-]+)["'`]/g)) allPaths.add(m[1]);
  // Aussi /api/xxx sans version
  for (const m of src.matchAll(/["'`](\/api\/[a-zA-Z][a-zA-Z0-9/_:.-]+)["'`]/g)) allPaths.add(m[1]);
  // Aussi patterns dans template literals: `...api/${x}/...`
  for (const m of src.matchAll(/`[^`]*\/api\/([a-zA-Z0-9/_$:.-]{2,80})[^`]*`/g)) {
    const clean = m[0].replace(/\$\{[^}]+\}/g, ':param').replace(/`/g, '');
    allPaths.add(clean);
  }
}

// Filter meaningful
const testPaths = [...allPaths]
  .filter((p) => p.startsWith('/api/'))
  .filter((p) => !/logout|password|register|recover|otp|verification/i.test(p))
  .sort();

console.log(`  Paths /api decouverts (${testPaths.length}) :`);
testPaths.forEach((p) => console.log(`    - ${p}`));

// ═══ 2. Normaliser les patterns Angular (:version, :playerId) → v1, 1 ═══
console.log('\n══ TEST ENDPOINTS (Accept: application/json) ══');
const jsonEndpoints = [];
for (const rawPath of testPaths) {
  // Skip auth endpoints
  if (/login|logout|register|password|otp/i.test(rawPath)) continue;
  // Remplacer :version → v1, :playerId → 1, :id → 1, autres :xxx → 1
  const p = rawPath
    .replace(/:version/g, 'v1')
    .replace(/:playerId/g, '1')
    .replace(/:id\b/g, '1')
    .replace(/:[a-zA-Z]+/g, '1');
  const url = `https://lnbpari.com${p}`;
  const r = await get(url);
  const isJson = r.ct?.includes('json');
  const is242 = r.body?.length === 242456 || r.body?.length === 242436 || r.body?.length === 242374 || r.body?.length === 242386;
  if (isJson || (r.status !== 200) || !is242) {
    const prev = r.body ? r.body.slice(0, 200).replace(/\s+/g, ' ') : '';
    console.log(`  status=${r.status} ct=${r.ct?.split(';')[0] || '?'} len=${r.body?.length || 0} ${p}${prev ? ' | ' + prev : ''}`);
    if (isJson || (r.status !== 200 && r.status !== 0)) {
      jsonEndpoints.push({ path: p, status: r.status, ct: r.ct, isJson });
    }
  }
}

console.log(`\n══ ENDPOINTS INTERESSANTS (${jsonEndpoints.length}) ══`);
jsonEndpoints.forEach((e) => console.log(`  status=${e.status} json=${e.isJson} ${e.path}`));

// ═══ 3. Test patterns supposes pour prematch sports ═══
console.log('\n══ TESTS PATTERNS PREMATCH SUPPOSES ══');
const supposedPaths = [
  '/api/v1/prematch/categories',
  '/api/v1/prematch/sport/1',
  '/api/v1/prematch/sports',
  '/api/v1/prematch/soccer',
  '/api/v1/prematch/events?sportId=1',
  '/api/v1/prematch/events?sport_id=1',
  '/api/v1/prematch/tournaments/1',
  '/api/v1/sport/list',
  '/api/v1/sport/1',
  '/api/v1/sport/1/tournaments',
  '/api/v1/sport/1/categories',
  '/api/v1/sport/1/prematch',
  '/api/v1/tournaments',
  '/api/v1/tournaments/list',
  '/api/v1/matches',
  '/api/v1/matches/prematch',
  '/api/v1/odds',
  '/api/v2/sport/getSports',
  '/api/v2/prematch/getEvents',
  '/api/v2/prematch/events',
  '/api/v2/events/list',
];
for (const p of supposedPaths) {
  const r = await get(`https://lnbpari.com${p}`);
  const isJson = r.ct?.includes('json');
  const is242 = r.body?.length >= 242000 && r.body?.length < 243000;
  const prev = r.body ? r.body.slice(0, 200).replace(/\s+/g, ' ') : '';
  const flag = isJson ? '✅ JSON' : (r.status !== 200 || !is242) ? '⚠️ NON-HTML' : '  html-shell';
  if (isJson || !is242) {
    console.log(`  ${flag} status=${r.status} len=${r.body?.length || 0} ${p}${prev ? ' | ' + prev.slice(0, 120) : ''}`);
  }
}

console.log('\n▶ Fin.');
process.exit(0);
