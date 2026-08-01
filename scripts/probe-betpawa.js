// Probe BetPawa v2 : élargi + dump du contenu des réponses.
// v1 a montré 96-byte JSON errors sur cg/ug/ke/rw/mw → il faut voir ce message
// pour comprendre le vrai path API.
const CANDIDATES_PATHS = [
  '/api/sportsbook/v3/events',
  '/api/sportsbook/v2/events',
  '/api/sportsbook/events',
  '/api/prematch/events',
  '/api/events',
  '/api/v1/events',
  '/api/v2/events',
  '/api/football/events',
  '/api/upcoming',
  '/api/highlights',
  '/api/query',
  '/graphql',
  '/api/pwa/events',
  '/api/mobile/events',
  // Test HEAD de l'app pour voir si redirect
  '/',
];

const HDR = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
  'X-Pawa-Language': 'fr',
  'X-Pawa-Brand': 'betpawa-congo',
};

async function tryOne(url) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      headers: HDR,
      signal: AbortSignal.timeout(8_000),
      redirect: 'follow',
    });
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    return {
      status: res.status,
      ct,
      len: text.length,
      body: text.slice(0, 500).replace(/\s+/g, ' '),
      elapsed: Date.now() - start,
    };
  } catch (e) {
    return { error: e.message, elapsed: Date.now() - start };
  }
}

// Test sur cg seulement (domaine attendu principal) + affiche corps réponse
const cc = 'cg';
const base = `https://www.betpawa.${cc}`;
console.log(`=== BETPAWA PROBE v2 : www.betpawa.${cc} — dump réponses ===\n`);

for (const path of CANDIDATES_PATHS) {
  const url = `${base}${path}`;
  const r = await tryOne(url);
  console.log(`--- ${path} ---`);
  console.log(`status=${r.status ?? 'ERR'} ct=${r.ct ?? ''} len=${r.len ?? '?'} t=${r.elapsed}ms`);
  if (r.error) console.log(`  err: ${r.error}`);
  else console.log(`  body: ${r.body}`);
  console.log('');
}

// Test aussi sous-domaine api.betpawa.cg
console.log(`\n=== SUB-DOMAINE api.betpawa.${cc} ===\n`);
for (const path of ['/', '/events', '/api/events', '/v1/events', '/sportsbook/events']) {
  const url = `https://api.betpawa.${cc}${path}`;
  const r = await tryOne(url);
  console.log(`--- ${path} ---`);
  console.log(`status=${r.status ?? 'ERR'} ct=${r.ct ?? ''} len=${r.len ?? '?'} t=${r.elapsed}ms`);
  if (r.error) console.log(`  err: ${r.error}`);
  else console.log(`  body: ${r.body}`);
  console.log('');
}

// Récupère aussi le HTML de la homepage pour trouver des références à l'API
console.log(`\n=== HOMEPAGE HTML SCAN ===\n`);
const home = await tryOne(`${base}/fr/events`);
console.log(`homepage /fr/events status=${home.status ?? 'ERR'} len=${home.len ?? 0}`);
if (home.body && home.len > 100) {
  // Cherche URLs de type api/xxx dans le HTML
  const apiRefs = [...home.body.matchAll(/["'](\/api\/[a-z0-9\/-]+)["']/gi)].map(m => m[1]);
  const jsRefs = [...home.body.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
  console.log(`  API refs found in HTML: ${[...new Set(apiRefs)].slice(0, 20).join(', ')}`);
  console.log(`  JS bundles: ${jsRefs.slice(0, 3).join(', ')}`);
}

process.exit(0);
