#!/usr/bin/env node
// PROBE LNBPARI REAL — tente les 3 hypotheses restantes :
//   A. Meme origine + Accept: application/json header
//   B. Sous-domaine construit dynamiquement (api-benin.lnbpari.com, sportsbook.lnbpari.com)
//   C. Grep TOUS bundles pour patterns fetch/http.get + host construction

async function req(url, opts = {}) {
  const { timeoutMs = 10_000, headers = {} } = opts;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120',
        Accept: 'application/json',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        Origin: 'https://lnbpari.com',
        Referer: 'https://lnbpari.com/',
        ...headers,
      },
    });
    return { status: res.status, body: await res.text(), ct: res.headers.get('content-type') };
  } catch (e) { return { status: 0, body: null, err: e.message }; }
}

console.log('▶ LNBPARI REAL API PROBE\n');

// ═══ A. Meme origine + Accept: application/json ═══
console.log('══ A. lnbpari.com/api/xxx avec Accept: application/json ══');
const knownPaths = [
  '/api/v1/growthbook/features',
  '/api/v1/sports',
  '/api/v2/sports',
  '/api/v2/user/getStatusDocs/1',
  '/api/prematch',
  '/api/prematch/sport/1',
  '/api/prematch/sports',
  '/api/prematch/soccer',
  '/api/sportsbook/prematch',
  '/api/sports/list',
  '/api/events',
  '/api/events/prematch',
  '/api/tournaments',
];
for (const p of knownPaths) {
  const r = await req(`https://lnbpari.com${p}`);
  const isJson = r.ct?.includes('json');
  const prev = r.body ? r.body.slice(0, 150).replace(/\s+/g, ' ') : '';
  console.log(`  status=${r.status} ct=${r.ct?.split(';')[0] || '?'} len=${r.body?.length || 0} json=${isJson} ${p}${prev ? ' | ' + prev : ''}`);
}

// ═══ B. Sous-domaines candidats ═══
console.log('\n══ B. Sous-domaines candidats ══');
const subs = [
  'api.lnbpari.com', 'api-benin.lnbpari.com', 'sportsbook.lnbpari.com',
  'sports-api.lnbpari.com', 'backend.lnbpari.com', 'prematch.lnbpari.com',
  'benin-api.mdlr.tech', 'luks-api.mdlr.tech', 'sportsbook.mdlr.tech',
  'api.mdlr.tech', 'sports-api.mdlr.tech', 'prematch.mdlr.tech',
];
for (const sub of subs) {
  const r = await req(`https://${sub}/api/v1/sports`, { timeoutMs: 6_000 });
  console.log(`  status=${r.status} len=${r.body?.length || 0} https://${sub}/api/v1/sports`);
}

// ═══ C. Fetch bootstrap + 69407 (les 2 plus gros) et grep patterns dynamiques ═══
console.log('\n══ C. GREP BUNDLES POUR CONSTRUCTIONS DYNAMIQUES ══');
const bundles = [
  'https://lnbpari.com/bootstrap.f939f1595817f0496fde.bundle.js',
  'https://lnbpari.com/69407.bdfc6415db8c60251867.js',
];
for (const bu of bundles) {
  const r = await req(bu, { timeoutMs: 20_000, headers: { Accept: '*/*' } });
  if (r.status !== 200 || !r.body) { console.log(`  ❌ ${bu.slice(-40)}: status=${r.status}`); continue; }
  console.log(`\n  ✅ ${bu.slice(-50)} → ${r.body.length}B`);
  const src = r.body;

  // Cherche "prematch", "sport", "odds", "event", "market" patterns
  const keywords = ['prematch', 'preMatch', 'sportsbook', 'sports/', 'events/', 'markets/', 'odds/', 'tournament', 'category'];
  for (const kw of keywords) {
    const re = new RegExp(`["'\`]([^"'\`]*${kw}[^"'\`]{0,60})["'\`]`, 'gi');
    const matches = new Set();
    for (const m of src.matchAll(re)) {
      const val = m[1];
      if (val.length < 80 && /[/:]/.test(val)) matches.add(val);
    }
    if (matches.size) {
      console.log(`    ▸ ${kw} (${matches.size}): ${[...matches].slice(0, 6).join(' | ')}`);
    }
  }

  // Cherche baseUrl construction, tokens
  for (const m of src.matchAll(/(?:baseUrl|apiUrl|BASE_URL|API_URL|apiHost|host)\s*[:=]\s*["'`]([^"'`\s]{2,150})["'`]/gi)) {
    console.log(`    → CONFIG: ${m[0].slice(0, 200)}`);
  }
  // Concat patterns: `${xxx}/api/...`
  for (const m of src.matchAll(/`\$\{[^}]*\}\/([^`\s]{2,80})`/g)) {
    console.log(`    → tpl: \${...}/${m[1]}`);
  }
  // Domain templates
  for (const m of src.matchAll(/["'`]([a-z-]+\.(?:mdlr|lnbpari)\.(?:tech|com))["'`]/gi)) {
    console.log(`    → domain literal: ${m[1]}`);
  }
  // Auth headers
  for (const m of src.matchAll(/(?:Authorization|X-Api-Key|X-Auth-Token|Bearer)\s*[:=]/gi)) {
    console.log(`    → auth header ref: ${src.slice(m.index, m.index + 100).replace(/\s+/g, ' ')}`);
    break;
  }
}

console.log('\n▶ Fin.');
process.exit(0);
