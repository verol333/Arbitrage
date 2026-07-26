// Probe intelligent Betclic.ci : cible le pattern CDN Betclic (offer.cdn.betclic.*)
// puis fallback Scrape.do render=true si tout bloque.
const TOKEN = process.env.SCRAPE_DO_KEY || '';

async function tryDirect(url, extra = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        accept: 'application/json,*/*',
        'accept-language': 'fr-FR,fr;q=0.9',
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
        origin: 'https://www.betclic.ci',
        referer: 'https://www.betclic.ci/',
        ...extra,
      },
    });
    const body = await res.text();
    return { url, elapsed: Date.now() - t0, status: res.status, len: body.length, start: body.slice(0, 300).replace(/\s+/g, ' ') };
  } catch (e) { return { url, elapsed: Date.now() - t0, error: e.message }; }
}

async function viaScrape(url, render = false, timeoutMs = 30_000) {
  if (!TOKEN) return null;
  const t0 = Date.now();
  const params = { token: TOKEN, url };
  if (render) params.render = 'true';
  const qs = new URLSearchParams(params).toString();
  try {
    const res = await fetch(`https://api.scrape.do/?${qs}`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.text();
    return { url, render, elapsed: Date.now() - t0, status: res.status, len: body.length, start: body.slice(0, 400).replace(/\s+/g, ' ') };
  } catch (e) { return { url, render, elapsed: Date.now() - t0, error: e.message }; }
}

// Betclic France utilise offer.cdn.betclic.fr/api/pub/v4/*
// Test si le pattern equivalent existe pour .ci
const CDN_TESTS = [
  // Pattern offer.cdn (le plus commun Betclic)
  'https://offer.cdn.betclic.ci/api/pub/v4/sports?application=48&countrycode=ci&language=fr&sitecode=cifr',
  'https://offer.cdn.betclic.ci/api/pub/v4/events?application=48&countrycode=ci&sitecode=cifr&language=fr',
  'https://offer.cdn.betclic.ci/api/v3/sports',
  // Pattern sportsbook
  'https://sb-api.betclic.ci/api/v1/sports',
  // Pattern promotion
  'https://promotions.betclic.ci/api/sports',
  // Direct on main domain (ceux qui ont donne 403)
  'https://www.betclic.ci/api/pub/v4/sports',
];

console.log('=== DIRECT CDN PATTERNS ===');
const results = await Promise.all(CDN_TESTS.map((u) => tryDirect(u)));
for (const r of results) {
  console.log(`  ${r.status ?? 'ERR'} ${r.elapsed}ms len=${r.len ?? '-'} ${r.url.slice(0, 100)}  ${(r.error || r.start || '').slice(0, 150)}`);
}

// Whatever works direct -> stop
const success = results.find((r) => r.status === 200 && r.len > 100 && r.start && r.start.trim().startsWith('{'));
if (success) {
  console.log(`\n✅ DIRECT WORKS: ${success.url}`);
  process.exit(0);
}

console.log('\n=== VIA SCRAPE.DO (basic, no render) ===');
// Test 2 candidats les plus prometteurs via Scrape.do basic (1cr)
for (const u of CDN_TESTS.slice(0, 3)) {
  const r = await viaScrape(u, false, 20_000);
  console.log(`  ${r.status ?? 'ERR'} ${r.elapsed}ms len=${r.len ?? '-'} ${u.slice(0, 100)}\n     ${(r.error || r.start || '').slice(0, 250)}`);
}

// Si toujours rien, on rend la homepage avec Scrape.do render (5cr, une seule fois)
// pour EXTRAIRE le vrai API endpoint depuis le SPA JS
console.log('\n=== SCRAPE.DO RENDER homepage (5cr) — extract API from SPA ===');
const home = await viaScrape('https://www.betclic.ci/', true, 60_000);
if (home?.status === 200 && home.len > 1000) {
  const body = home.start; // premier 400 chars limite, on refait un fetch complet
  const full = await viaScrape('https://www.betclic.ci/', true, 60_000);
  if (full?.status === 200) {
    // Refetch complet body:
    const qs = new URLSearchParams({ token: TOKEN, url: 'https://www.betclic.ci/', render: 'true' }).toString();
    const fullRes = await fetch(`https://api.scrape.do/?${qs}`, { signal: AbortSignal.timeout(60_000) });
    const fullBody = await fullRes.text();
    console.log(`  render status=${fullRes.status} len=${fullBody.length}`);
    // Extract patterns d'URL API
    const apiUrls = new Set();
    for (const m of fullBody.matchAll(/https?:\/\/[a-z0-9.-]*betclic[a-z0-9.-]*(?:\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=%-]*)?/g)) {
      const u = m[0].replace(/["'\\]/g, '');
      if (u.includes('api') || u.includes('sports') || u.includes('offer') || u.includes('cdn')) apiUrls.add(u.slice(0, 200));
    }
    console.log('\n  ── URLS API detectees dans HTML ──');
    for (const u of [...apiUrls].slice(0, 30)) console.log('    ' + u);
    // Aussi les vars env de config
    for (const m of fullBody.matchAll(/(?:apiBaseUrl|apiUrl|apiEndpoint|API_URL|offerUrl)["'\s:=]+["']?(https?:\/\/[^"'\s,]+)/g)) {
      console.log('  CONFIG:', m[1]);
    }
  }
} else {
  console.log(`  render failed: status=${home?.status} err=${home?.error}`);
}

process.exit(0);
