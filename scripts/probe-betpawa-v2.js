#!/usr/bin/env node
// Probe BetPawa v2 : la homepage est un SPA (7282 bytes de shell HTML).
// L'API doit etre sur un autre domaine. On extrait le HTML complet pour
// trouver script src, api urls, config globals, subdomains references.

import { gotScraping } from 'got-scraping';

async function fetchText(url) {
  try {
    const r = await gotScraping({
      url,
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120 }],
        devices: ['desktop'],
        locales: ['fr-FR'],
        operatingSystems: ['linux'],
      },
      timeout: { request: 15_000 },
      retry: { limit: 0 },
      throwHttpErrors: false,
      responseType: 'text',
    });
    return { status: r.statusCode, body: r.body || '' };
  } catch (e) {
    return { status: 0, err: e.message };
  }
}

const home = await fetchText('https://www.betpawa.cg/');
console.log(`Homepage status=${home.status} size=${home.body.length}`);
console.log(`\n=== Full HTML ===`);
console.log(home.body);
console.log(`=== End HTML ===\n`);

// Extraire scripts et URLs
const scripts = [...home.body.matchAll(/<script[^>]*src=["']([^"']+)["']/g)].map((m) => m[1]);
const links = [...home.body.matchAll(/(?:href|src)=["'](https?:\/\/[^"']+)["']/g)].map((m) => m[1]);
const urls = [...home.body.matchAll(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}[^"' <>]*/gi)].map((m) => m[0]);

console.log(`\n=== SCRIPTS ===`);
for (const s of new Set(scripts)) console.log(`  ${s}`);
console.log(`\n=== LINKS/URLS ===`);
for (const l of [...new Set([...links, ...urls])].slice(0, 40)) console.log(`  ${l}`);

// Fetch le premier script JS bundle
const jsBundle = scripts.find((s) => /\.(js|mjs)$/i.test(s));
if (jsBundle) {
  const jsUrl = jsBundle.startsWith('http') ? jsBundle : `https://www.betpawa.cg${jsBundle}`;
  console.log(`\n=== FETCHING JS BUNDLE: ${jsUrl} ===`);
  const js = await fetchText(jsUrl);
  console.log(`  status=${js.status} size=${js.body.length}`);
  if (js.body) {
    // Chercher les patterns d'API dans le JS bundle
    const apiRefs = new Set();
    for (const re of [
      /["'](\/api\/[^"']+)["']/g,
      /["']https?:\/\/[a-z0-9.-]*api[a-z0-9.-]*\.[a-z]{2,}[^"']*["']/gi,
      /["']https?:\/\/[a-z0-9.-]*sports?book[^"']*["']/gi,
      /baseURL\s*:\s*["']([^"']+)["']/g,
      /apiUrl\s*:\s*["']([^"']+)["']/g,
    ]) {
      for (const m of js.body.matchAll(re)) apiRefs.add(m[1] || m[0]);
    }
    console.log(`  ${apiRefs.size} API references trouvees :`);
    for (const r of [...apiRefs].slice(0, 60)) console.log(`    ${r}`);
    // Chercher des marchés GraphQL / operations
    const graphql = [...js.body.matchAll(/(?:query|mutation)\s+(\w+)/g)].map((m) => m[1]);
    if (graphql.length) {
      console.log(`  GraphQL operations : ${[...new Set(graphql)].slice(0, 20).join(', ')}`);
    }
  }
}

process.exit(0);
