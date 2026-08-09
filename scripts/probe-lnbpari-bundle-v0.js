#!/usr/bin/env node
// PROBE LNBPARI BUNDLE v0 — cherche TOUTES les URLs /api/v0/* dans les JS
// bundles pour extraire la liste exhaustive des endpoints DATA.

async function req(url, opts = {}) {
  const { timeoutMs = 20_000, headers = {} } = opts;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/151.0.0.0 Safari/537.36',
        Accept: '*/*',
        ...headers,
      },
    });
    return { status: res.status, body: await res.text() };
  } catch (e) { return { status: 0, body: null, err: e.message }; }
}

console.log('▶ LNBPARI BUNDLE v0 GREP\n');

// Fetch tous les bundles connus + le HTML pour trouver les nouveaux bundles
const html = await req('https://lnbpari.com/');
const bundleUrls = new Set([
  'https://lnbpari.com/framework.5444ef5936ef393e6e79.js',
  'https://lnbpari.com/main.5fcd52623ca380d7a726.js',
  'https://lnbpari.com/shell.1785836544908.js',
  'https://lnbpari.com/69407.bdfc6415db8c60251867.js',
  'https://lnbpari.com/bootstrap.f939f1595817f0496fde.bundle.js',
]);
if (html.body) {
  for (const m of html.body.matchAll(/["']([^"']*\.js)["']/g)) {
    const u = m[1];
    if (u.endsWith('.js') && !u.includes('polyfill')) {
      const full = u.startsWith('http') ? u : (u.startsWith('/') ? `https://lnbpari.com${u}` : `https://lnbpari.com/${u}`);
      bundleUrls.add(full);
    }
  }
}
console.log(`  Bundles a fetcher: ${bundleUrls.size}`);

const allPaths = new Set();
const allTemplates = new Set();
const hostRefs = new Set();

for (const bu of bundleUrls) {
  const r = await req(bu);
  if (r.status !== 200 || !r.body) continue;
  const src = r.body;
  console.log(`  ✅ ${bu.slice(-50)} → ${src.length}B`);
  // /api/v0/xxx literal paths
  for (const m of src.matchAll(/["'`](\/api\/v0\/[a-zA-Z0-9/_:.-]{2,100})["'`]/g)) allPaths.add(m[1]);
  for (const m of src.matchAll(/["'`](\/api\/v\d+\/[a-zA-Z0-9/_:.-]{2,100})["'`]/g)) allPaths.add(m[1]);
  // Template literals: `/api/v0/xxx/${id}/yyy`
  for (const m of src.matchAll(/`\/api\/v0\/[^`]{2,150}`/g)) allTemplates.add(m[0].replace(/`/g, '').replace(/\$\{[^}]+\}/g, ':param'));
  for (const m of src.matchAll(/`\/api\/v\d+\/[^`]{2,150}`/g)) allTemplates.add(m[0].replace(/`/g, '').replace(/\$\{[^}]+\}/g, ':param'));
  // Host refs
  for (const m of src.matchAll(/["'`](https?:\/\/[a-z0-9.-]+(?:mdlr|ubo|betster|lnbpari|hg-event|sporty)[a-z0-9.-]*\.(?:com|tech|io|net))["'`]/gi)) hostRefs.add(m[1]);
}

console.log(`\n══ /api/vN/ PATHS TROUVES (${allPaths.size}) ══`);
[...allPaths].sort().forEach((p) => console.log(`  - ${p}`));

console.log(`\n══ TEMPLATE LITERALS (${allTemplates.size}) ══`);
[...allTemplates].sort().forEach((p) => console.log(`  - ${p}`));

console.log(`\n══ HOSTS REFS (${hostRefs.size}) ══`);
[...hostRefs].sort().forEach((h) => console.log(`  - ${h}`));

console.log('\n▶ Fin.');
process.exit(0);
