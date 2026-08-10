#!/usr/bin/env node
// PROBE LONABET CHUNKS + LNBPARI TRANSPORT — 2 objectifs :
// 1. Extraire le vrai backend de lonabet.bf (grep tous les .js pour URLs API)
// 2. Trouver le chemin exact hashé du bundle betbook-transport.js de lnbpari

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

async function req(url, opts = {}) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(opts.timeoutMs || 15_000),
      headers: { 'User-Agent': UA, Accept: '*/*', ...(opts.headers || {}) },
    });
    return { status: res.status, body: await res.text(), ct: res.headers.get('content-type') };
  } catch (e) { return { status: 0, body: null, err: e.message }; }
}

// ═════ LONABET.BF ═════
console.log('══ LONABET.BF — Grep chunks pour backend ══\n');
const homeLona = await req('https://m.lonabet.bf/');
const scriptsLona = [...(homeLona.body || '').matchAll(/["']([^"']+\.js)["']/g)]
  .map((m) => m[1])
  .filter((u) => !u.includes('firebase') && !u.includes('cookieconsent') && !u.includes('gstatic'))
  .map((u) => u.startsWith('http') ? u : (u.startsWith('//') ? 'https:' + u : (u.startsWith('/') ? 'https://m.lonabet.bf' + u : 'https://m.lonabet.bf/' + u)))
  .filter((u, i, a) => a.indexOf(u) === i)
  .slice(0, 15);
console.log(`Scripts à fetcher: ${scriptsLona.length}`);
scriptsLona.forEach((u) => console.log(`  - ${u}`));

const lonaHosts = new Set();
const lonaApiPaths = new Set();
const lonaWs = new Set();
for (const u of scriptsLona) {
  const r = await req(u);
  if (!r.body || r.status !== 200) { console.log(`  ❌ ${r.status} ${u.slice(-40)}`); continue; }
  console.log(`  ✅ ${r.body.length}B ${u.slice(-40)}`);
  // Hosts API
  for (const m of r.body.matchAll(/["'`](https?:\/\/[a-z0-9.-]+(?:api|feed|sport|odds|widget)[a-z0-9.-]*\.[a-z]{2,6})/gi)) lonaHosts.add(m[1]);
  // Hosts génériques (mais on filtre trivialités)
  for (const m of r.body.matchAll(/["'`](https?:\/\/[a-z0-9.-]{4,80}\.(?:com|net|io|tech|bj|sn|ci|bf|dev|app))/gi)) {
    const h = m[1];
    if (!/(google|gstatic|firebase|facebook|twitter|jquery|bootstrap|cloudflare|jsdelivr|cdnjs|fonts|analytics|tag|adobe|hotjar|sentry|newrelic|onetrust|zopim|zendesk|matomo|paypal|stripe|mixpanel|amplitude|segment|hubspot|intercom|adnxs|doubleclick|adobedtm)/i.test(h)) lonaHosts.add(h);
  }
  // API paths
  for (const m of r.body.matchAll(/["'`](\/(?:api|v\d|sport|odds|widget|feed)\/[a-zA-Z0-9/_:.?-]{3,80})["'`]/g)) lonaApiPaths.add(m[1]);
  // WebSockets
  for (const m of r.body.matchAll(/["'`](wss?:\/\/[^"'`]{4,120})["'`]/g)) lonaWs.add(m[1]);
}
console.log(`\n  → Hosts uniques (${lonaHosts.size}):`);
[...lonaHosts].slice(0, 30).forEach((h) => console.log(`     - ${h}`));
console.log(`\n  → API paths (${lonaApiPaths.size}):`);
[...lonaApiPaths].slice(0, 25).forEach((p) => console.log(`     - ${p}`));
console.log(`\n  → WebSockets (${lonaWs.size}):`);
[...lonaWs].slice(0, 10).forEach((w) => console.log(`     - ${w}`));

// ═════ LNBPARI.COM — chercher betbook-transport avec hash ═════
console.log('\n\n══ LNBPARI.COM — Bundle transport (hashed path) ══\n');
const homeLnb = await req('https://lnbpari.com/');
const scriptsLnb = [...(homeLnb.body || '').matchAll(/["']([^"']*(?:transport|betbook|betslip|widget|main|framework|sport)[^"']*\.js)["']/g)]
  .map((m) => m[1])
  .map((u) => u.startsWith('http') ? u : (u.startsWith('//') ? 'https:' + u : (u.startsWith('/') ? 'https://lnbpari.com' + u : 'https://lnbpari.com/' + u)))
  .filter((u, i, a) => a.indexOf(u) === i);
console.log(`Bundles candidats (${scriptsLnb.length}):`);
scriptsLnb.slice(0, 20).forEach((u) => console.log(`  - ${u}`));

// Cherche AUSSI dans le shell bundle qu'on connait déjà, il pointe peut-être vers le transport
const scriptsFromCatalog = [
  'https://lnbpari.com/framework.5444ef5936ef393e6e79.js',
  'https://lnbpari.com/main.5fcd52623ca380d7a726.js',
  'https://lnbpari.com/shell.1785836544908.js',
  'https://lnbpari.com/bootstrap.f939f1595817f0496fde.bundle.js',
];
console.log('\nGrep transport-related dans bundles connus:');
const transportPaths = new Set();
const wsUrls = new Set();
const oddsPaths = new Set();
for (const bu of scriptsFromCatalog) {
  const r = await req(bu);
  if (r.status !== 200 || !r.body) continue;
  console.log(`  ✅ ${bu.slice(-40)} → ${r.body.length}B`);
  // Chemins vers transport bundle
  for (const m of r.body.matchAll(/["'`]([^"'`]*(?:betbook|transport|sport-book)[^"'`]*\.js)["'`]/g)) transportPaths.add(m[1]);
  // WS URLs
  for (const m of r.body.matchAll(/["'`](wss?:\/\/[^"'`]{4,120})["'`]/g)) wsUrls.add(m[1]);
  // Endpoints avec odds/prices/markets
  for (const m of r.body.matchAll(/["'`](\/[a-zA-Z0-9/_:.-]*(?:odds|prices|markets|selections|outcomes|prematch|live)[a-zA-Z0-9/_:.-]*)["'`]/g)) oddsPaths.add(m[1]);
}
console.log(`\n  → Transport bundle paths (${transportPaths.size}):`);
[...transportPaths].slice(0, 15).forEach((p) => console.log(`     - ${p}`));
console.log(`\n  → WebSocket URLs (${wsUrls.size}):`);
[...wsUrls].slice(0, 15).forEach((w) => console.log(`     - ${w}`));
console.log(`\n  → Paths odds/prices/markets (${oddsPaths.size}):`);
[...oddsPaths].slice(0, 30).forEach((p) => console.log(`     - ${p}`));

// Fetch le transport bundle s'il existe
for (const tp of transportPaths) {
  const url = tp.startsWith('http') ? tp : (tp.startsWith('/') ? 'https://lnbpari.com' + tp : 'https://lnbpari.com/' + tp);
  const r = await req(url);
  console.log(`\n  Transport fetch: ${url} → ${r.status} (${r.body?.length || 0}B)`);
  if (r.status === 200 && r.body?.length > 1000) {
    const ws = [...r.body.matchAll(/["'`](wss?:\/\/[^"'`]{4,120})["'`]/g)].map((m) => m[1]).filter((u, i, a) => a.indexOf(u) === i);
    const httpPaths = [...r.body.matchAll(/["'`](\/api\/v\d+\/[^"'`]{2,100})["'`]/g)].map((m) => m[1]).filter((u, i, a) => a.indexOf(u) === i);
    const templates = [...r.body.matchAll(/`(\/[a-zA-Z0-9/_:.-]*[a-z])`/g)].map((m) => m[1]).filter((u, i, a) => a.indexOf(u) === i).slice(0, 15);
    console.log(`     WS (${ws.length}): ${ws.slice(0, 5).join(' | ')}`);
    console.log(`     HTTP paths (${httpPaths.length}): ${httpPaths.slice(0, 10).join(' | ')}`);
    console.log(`     Templates: ${templates.slice(0, 10).join(' | ')}`);
  }
}

console.log('\n▶ Fin.');
process.exit(0);
