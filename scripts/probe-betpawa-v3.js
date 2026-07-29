#!/usr/bin/env node
// Probe BetPawa v3 : fetch env.js (config API) + main bundle + tenter endpoints /api/*

import { gotScraping } from 'got-scraping';

async function fetchText(url, headers = {}) {
  try {
    const r = await gotScraping({
      url,
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
        referer: 'https://www.betpawa.cg/',
        ...headers,
      },
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120 }],
        devices: ['desktop'],
        locales: ['fr-FR'],
        operatingSystems: ['linux'],
      },
      timeout: { request: 20_000 },
      retry: { limit: 0 },
      throwHttpErrors: false,
      responseType: 'text',
    });
    return { status: r.statusCode, body: r.body || '', headers: r.headers };
  } catch (e) {
    return { status: 0, err: e.message };
  }
}

const BASE = 'https://www.betpawa.cg';

// 1. Fetch env.js
console.log('=== env.js ===');
const env = await fetchText(`${BASE}/env.js?v=2.236.103`);
console.log(`status=${env.status} size=${env.body.length}`);
if (env.body) console.log(env.body.slice(0, 2000));

// 2. Fetch main chunk
console.log('\n=== main-c36231d4f7515711.js (extract API patterns) ===');
const main = await fetchText(`${BASE}/_next/static/chunks/main-c36231d4f7515711.js`);
console.log(`status=${main.status} size=${main.body.length}`);
if (main.body) {
  const apiRefs = new Set();
  for (const re of [
    /["'](\/api\/[^"']+)["']/g,
    /["']https?:\/\/[a-z0-9.-]*api[a-z0-9.-]*\.[a-z]{2,}[^"']*["']/gi,
    /["']https?:\/\/[a-z0-9.-]+sportsbook[a-z0-9.-]*\.[a-z]{2,}[^"']*["']/gi,
    /baseURL\s*[:=]\s*["']([^"']+)["']/g,
    /apiUrl\s*[:=]\s*["']([^"']+)["']/g,
    /API_BASE\s*[:=]\s*["']([^"']+)["']/g,
  ]) {
    for (const m of main.body.matchAll(re)) apiRefs.add(m[1] || m[0]);
  }
  console.log(`${apiRefs.size} API refs :`);
  for (const r of [...apiRefs].slice(0, 40)) console.log(`  ${r}`);
}

// 3. Fetch _app chunk (routing/pages logic)
console.log('\n=== _app-9fc65478a0b0092f.js ===');
const appJs = await fetchText(`${BASE}/_next/static/chunks/pages/_app-9fc65478a0b0092f.js`);
console.log(`status=${appJs.status} size=${appJs.body.length}`);
if (appJs.body) {
  const apiRefs = new Set();
  for (const re of [
    /["'](\/api\/[^"']+)["']/g,
    /["']https?:\/\/[a-z0-9.-]*api[a-z0-9.-]*\.[a-z]{2,}[^"']*["']/gi,
    /["']https?:\/\/[a-z0-9.-]+sportsbook[a-z0-9.-]*\.[a-z]{2,}[^"']*["']/gi,
  ]) {
    for (const m of appJs.body.matchAll(re)) apiRefs.add(m[1] || m[0]);
  }
  console.log(`${apiRefs.size} API refs :`);
  for (const r of [...apiRefs].slice(0, 60)) console.log(`  ${r}`);
}

// 4. Try Next.js SSG data endpoint
console.log('\n=== Next.js SSG data endpoint tests ===');
const BUILD_ID = 'K-QaKK3K5hAUUXamhTsb1';
const dataPaths = [
  `/_next/data/${BUILD_ID}/index.json`,
  `/_next/data/${BUILD_ID}/events.json`,
  `/_next/data/${BUILD_ID}/football.json`,
  `/_next/data/${BUILD_ID}/sports/football.json`,
  `/_next/data/${BUILD_ID}/upcoming.json`,
  `/_next/data/${BUILD_ID}/live.json`,
];
for (const p of dataPaths) {
  const r = await fetchText(`${BASE}${p}`);
  console.log(`${p} → ${r.status} size=${r.body.length}`);
  if (r.status === 200 && r.body.length > 500) {
    console.log(`  snippet: ${r.body.slice(0, 300).replace(/\s+/g, ' ')}`);
  }
}

// 5. Test API subdomains
console.log('\n=== Subdomain API guess ===');
const subdomainTests = [
  'https://api.betpawa.cg/api/sportsbook/events',
  'https://api.betpawa.cg/events',
  'https://sportsbook.betpawa.cg/api/events',
  'https://api-sports.betpawa.cg/events',
  'https://www.betpawa.cg/api/sportsbook/events/upcoming',
  'https://www.betpawa.cg/api/sportsbook/events/list',
  'https://www.betpawa.cg/api/sportsbook/categories',
  'https://www.betpawa.cg/api/sportsbook/v1/events',
  'https://www.betpawa.cg/api/v2/events',
];
for (const u of subdomainTests) {
  const r = await fetchText(u, { accept: 'application/json' });
  console.log(`${u.replace('https://', '')} → ${r.status} size=${r.body.length}`);
  if (r.status !== 404 && r.status !== 0 && r.body) {
    console.log(`  snippet: ${r.body.slice(0, 200).replace(/\s+/g, ' ')}`);
  }
}

process.exit(0);
