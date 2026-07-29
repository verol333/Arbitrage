#!/usr/bin/env node
// Deep probe guineegames.com : trouver l'API BtoBet reelle et fetch 1 match foot

import { gotScraping } from 'got-scraping';

async function fetchText(url, headers = {}) {
  try {
    const r = await gotScraping({
      url,
      headers: {
        accept: 'text/html,application/json,*/*',
        'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
        referer: 'https://www.guineegames.com/',
        ...headers,
      },
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120 }],
        devices: ['desktop'], locales: ['fr-FR'], operatingSystems: ['linux'],
      },
      timeout: { request: 20_000 },
      retry: { limit: 0 },
      throwHttpErrors: false,
      responseType: 'text',
    });
    return { status: r.statusCode, body: r.body || '' };
  } catch (e) {
    return { status: 0, body: '', err: e.message };
  }
}

const BASE = 'https://www.guineegames.com';

// 1. Fetch homepage HTML
console.log('=== Homepage HTML ===');
const home = await fetchText(BASE + '/');
console.log(`status=${home.status} size=${home.body.length}`);
// Extract all scripts + all URLs + subdomains
const scripts = new Set();
const urls = new Set();
const subdomains = new Set();
for (const m of home.body.matchAll(/<script[^>]*src=["']([^"']+)["']/g)) scripts.add(m[1]);
for (const m of home.body.matchAll(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}[a-z0-9/._-]*/gi)) {
  urls.add(m[0]);
  const dom = m[0].match(/https?:\/\/([^/]+)/)?.[1];
  if (dom) subdomains.add(dom);
}
console.log('\nSCRIPTS:');
for (const s of scripts) console.log(`  ${s}`);
console.log('\nURLS (uniques):');
for (const u of [...urls].slice(0, 30)) console.log(`  ${u}`);
console.log('\nSUBDOMAINS:');
for (const d of subdomains) console.log(`  ${d}`);

// Show first 3000 chars of HTML to spot inline configs, links, etc.
console.log('\n=== HTML FIRST 3000 chars ===');
console.log(home.body.slice(0, 3000));

// 2. Fetch each script found and extract API references
console.log('\n\n=== SCRIPT ANALYSIS ===');
const apiRefs = new Set();
const jsUrls = new Set();
for (const src of scripts) {
  const url = src.startsWith('http') ? src : (src.startsWith('//') ? 'https:' + src : BASE + src);
  const r = await fetchText(url);
  console.log(`\n${url}`);
  console.log(`  status=${r.status} size=${r.body.length}`);
  if (!r.body) continue;
  // Extract API-looking references
  for (const re of [
    /["'](\/api\/[^"']+)["']/g,
    /["'](\/dataservices\/[^"']+)["']/g,
    /["'](\/betradar[^"']+)["']/g,
    /["']https?:\/\/[a-z0-9.-]*(api|sports|book|feed)[a-z0-9.-]*\.[a-z]{2,}[^"']*["']/gi,
    /baseURL[^"']{0,20}["']([^"']+)["']/g,
    /apiUrl[^"']{0,20}["']([^"']+)["']/g,
    /"host"\s*:\s*"([^"]+)"/g,
    /"endpoint"\s*:\s*"([^"]+)"/g,
    /"apiHost"\s*:\s*"([^"]+)"/g,
  ]) {
    for (const m of r.body.matchAll(re)) apiRefs.add(m[1] || m[0]);
  }
  // Extract subdomains
  for (const m of r.body.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    if (!/googletagmanager|analytics|hotjar|sentry|facebook|linkedin|youtube|twitter|w3\.org|schema\.org/i.test(m[1])) {
      jsUrls.add(m[1]);
    }
  }
}

console.log(`\n=== TOTAL API refs (${apiRefs.size}) ===`);
for (const r of apiRefs) console.log(`  ${r}`);
console.log(`\n=== TOTAL subdomains extraits des scripts (${jsUrls.size}) ===`);
for (const d of jsUrls) console.log(`  ${d}`);
