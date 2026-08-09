#!/usr/bin/env node
// PROBE LNBPARI BUNDLE — fetch les JS bundles + grep pour trouver le vrai API host
// Brand="BENIN" | "LUKS" (autre book sur meme plateforme Modulor).
// Bundles pattern Angular/PWA: framework, main, shell, chunk numerique.

async function direct(url, timeoutMs = 15_000) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120',
        Accept: '*/*',
        Origin: 'https://lnbpari.com',
        Referer: 'https://lnbpari.com/',
      },
    });
    return { status: res.status, body: await res.text(), headers: Object.fromEntries(res.headers) };
  } catch (e) { return { status: 0, body: null, err: e.message }; }
}

console.log('▶ LNBPARI BUNDLE PROBE\n');

// ═══ 1. Re-fetch HTML pour extraire URLs bundles complets ═══
const html = await direct('https://lnbpari.com/');
const bundleUrls = new Set();
if (html.body) {
  for (const m of html.body.matchAll(/["']([^"']*(?:framework|main|shell|chunk|runtime|polyfills)[^"']*\.js)["']/gi)) bundleUrls.add(m[1]);
  for (const m of html.body.matchAll(/src=["']([^"']*\.js)["']/g)) bundleUrls.add(m[1]);
  for (const m of html.body.matchAll(/<link[^>]*href=["']([^"']*\.js)["']/g)) bundleUrls.add(m[1]);
}
console.log(`  Bundles URLs trouvees: ${bundleUrls.size}`);
[...bundleUrls].forEach((u) => console.log(`    - ${u}`));

// Normalise (absolutise)
const absoluteUrls = [...bundleUrls].map((u) => {
  if (u.startsWith('http')) return u;
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return 'https://lnbpari.com' + u;
  return 'https://lnbpari.com/' + u;
});

// ═══ 2. Fetch chaque bundle et grep API URLs ═══
console.log('\n══ FETCH BUNDLES + GREP API ══');
const foundApiUrls = new Set();
const foundHosts = new Set();
for (const url of absoluteUrls.slice(0, 8)) {
  const r = await direct(url, 25_000);
  if (r.status !== 200 || !r.body) { console.log(`  ❌ ${url.slice(-60)} status=${r.status}`); continue; }
  console.log(`  ✅ ${url.slice(-60)} → ${r.body.length}B`);
  const src = r.body;
  // Cherche URLs API completes
  for (const m of src.matchAll(/["'`](https?:\/\/[a-z0-9.-]+(?:\.com|\.tech|\.io|\.net|\.co)(?:\/[^"'`\s]*)?)["'`]/gi)) {
    const u = m[1];
    if (/googletag|googleapis|hotjar|hoory|sentry|analytics|cdn\.|jsdelivr|fonts\.|gstatic/i.test(u)) continue;
    foundApiUrls.add(u.slice(0, 200));
    try { foundHosts.add(new URL(u).host); } catch {}
  }
  // Cherche baseURL / API_URL patterns
  for (const m of src.matchAll(/(?:baseURL|API_(?:URL|BASE|HOST)|apiUrl|apiBase|apiHost)\s*[:=]\s*["'`]([^"'`\s]+)["'`]/gi)) {
    console.log(`    → CONFIG: ${m[0].slice(0, 200)}`);
    foundApiUrls.add(m[1]);
    if (m[1].startsWith('http')) try { foundHosts.add(new URL(m[1]).host); } catch {}
  }
  // Cherche env vars
  for (const m of src.matchAll(/(?:NG_APP|VITE|REACT_APP|NEXT_PUBLIC)_(?:[A-Z_]+)\s*[:=]\s*["'`]([^"'`\s]+)["'`]/g)) {
    console.log(`    → ENV: ${m[0].slice(0, 200)}`);
  }
  // Cherche endpoint paths /api/xxx
  const paths = new Set();
  for (const m of src.matchAll(/["'`](\/api\/[^"'`\s?]+)["'`]/g)) paths.add(m[1]);
  for (const m of src.matchAll(/["'`](\/v\d+\/[^"'`\s?]+)["'`]/g)) paths.add(m[1]);
  if (paths.size) {
    console.log(`    → paths (${paths.size} sample): ${[...paths].slice(0, 5).join(', ')}`);
  }
}

console.log(`\n══ HOSTS UNIQUES trouves (${foundHosts.size}) ══`);
[...foundHosts].forEach((h) => console.log(`    - ${h}`));

console.log(`\n══ API URLs UNIQUES (${foundApiUrls.size} echantillon) ══`);
[...foundApiUrls].slice(0, 30).forEach((u) => console.log(`    - ${u}`));

// ═══ 3. Test hosts decouverts avec paths standards ═══
console.log('\n══ TEST HOSTS DECOUVERTS ══');
for (const host of [...foundHosts].filter((h) => !/mdlr\.tech$/.test(h)).slice(0, 5)) {
  for (const p of ['/api/v1/sports', '/api/sports', '/api/prematch/soccer', '/graphql']) {
    const u = `https://${host}${p}`;
    const r = await direct(u, 8_000);
    const prev = r.body ? r.body.slice(0, 100).replace(/\s+/g, ' ') : '';
    console.log(`  status=${r.status} len=${r.body?.length || 0} ${u}${prev ? ' | ' + prev : ''}`);
  }
}

console.log('\n▶ Fin.');
process.exit(0);
