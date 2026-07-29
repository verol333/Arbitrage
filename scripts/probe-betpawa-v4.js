#!/usr/bin/env node
// Probe BetPawa v4 : cibler /api/sportsbook/v1/* (prefix decouvert)
// + fetch main bundle + _app chunk avec extraction ciblee

import { gotScraping } from 'got-scraping';

async function fetchText(url, headers = {}) {
  try {
    const r = await gotScraping({
      url,
      headers: {
        accept: 'application/json, text/plain, */*',
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
    return { status: r.statusCode, body: r.body || '' };
  } catch (e) {
    return { status: 0, body: '', err: e.message };
  }
}

const BASE = 'https://www.betpawa.cg';

// 1. Fetch main bundle et extraire TOUTES les references /api/sportsbook/v1/*
console.log('=== Extract from main bundle ===');
const main = await fetchText(`${BASE}/_next/static/chunks/main-c36231d4f7515711.js`);
console.log(`main.js status=${main.status} size=${main.body.length}`);
if (main.body) {
  const sportPaths = new Set();
  for (const m of main.body.matchAll(/["'](\/api\/sportsbook\/v1\/[^"']*)["']/g)) {
    sportPaths.add(m[1]);
  }
  console.log(`  ${sportPaths.size} paths /api/sportsbook/v1/* :`);
  for (const p of sportPaths) console.log(`    ${p}`);
}

// 2. Fetch _app chunk
console.log('\n=== Extract from _app chunk ===');
const appJs = await fetchText(`${BASE}/_next/static/chunks/pages/_app-9fc65478a0b0092f.js`);
console.log(`_app.js status=${appJs.status} size=${appJs.body.length}`);
if (appJs.body) {
  const sportPaths = new Set();
  for (const m of appJs.body.matchAll(/["'](\/api\/sportsbook\/v1\/[^"']*)["']/g)) {
    sportPaths.add(m[1]);
  }
  console.log(`  ${sportPaths.size} paths /api/sportsbook/v1/* :`);
  for (const p of sportPaths) console.log(`    ${p}`);
}

// 3. Fetch les 4 gros chunks
for (const chunk of ['62033-312a3cdfab38c19a', '51666-7a86a3d51cfd86bd', '9519-947c599fb64e5f2c', '98148-0225b3c802978383', '4060-b6020e3ea6cbbb8c']) {
  console.log(`\n=== Chunk ${chunk} ===`);
  const c = await fetchText(`${BASE}/_next/static/chunks/${chunk}.js`);
  console.log(`  status=${c.status} size=${c.body.length}`);
  if (c.body) {
    const paths = new Set();
    for (const m of c.body.matchAll(/["'](\/api\/sportsbook\/v1\/[^"']*)["']/g)) paths.add(m[1]);
    for (const m of c.body.matchAll(/["'](\/api\/(events|markets|categories|matches|prematch)[^"']*)["']/g)) paths.add(m[1]);
    if (paths.size) {
      console.log(`  ${paths.size} API paths :`);
      for (const p of paths) console.log(`    ${p}`);
    }
    // Chercher aussi patterns GraphQL, event fetching
    const gql = [...c.body.matchAll(/(query|mutation)\s+(\w+)/g)].map((m) => m[2]);
    if (gql.length) console.log(`  GraphQL ops : ${[...new Set(gql)].slice(0, 15).join(', ')}`);
    // Chercher patterns endpoint
    const endpoints = [...c.body.matchAll(/["'](\/[a-z0-9_-]+\/[a-z0-9_/-]+)["']/g)]
      .map((m) => m[1])
      .filter((p) => /events|markets|categories|sports|prematch|upcoming|live/.test(p) && !p.startsWith('/_next'))
      .slice(0, 20);
    if (endpoints.length) {
      console.log(`  Autres endpoints candidats :`);
      for (const p of new Set(endpoints)) console.log(`    ${p}`);
    }
  }
}

// 4. Test endpoints candidats
console.log('\n=== Test /api/sportsbook/v1/* endpoints ===');
const paths = [
  '/api/sportsbook/v1/events',
  '/api/sportsbook/v1/events/upcoming',
  '/api/sportsbook/v1/events/list',
  '/api/sportsbook/v1/events/prematch',
  '/api/sportsbook/v1/prematch/events',
  '/api/sportsbook/v1/sports',
  '/api/sportsbook/v1/sports/football',
  '/api/sportsbook/v1/sports/football/events',
  '/api/sportsbook/v1/categories',
  '/api/sportsbook/v1/markets',
  '/api/sportsbook/v1/brand',
  '/api/sportsbook/v1/upcoming',
  '/api/sportsbook/v1/highlights',
  '/api/sportsbook/v1/all-events',
  '/api/sportsbook/v1/menu',
  '/api/sportsbook/v1/live',
];
for (const p of paths) {
  const r = await fetchText(`${BASE}${p}`, { accept: 'application/json' });
  const flag = r.status === 200 ? '✓ 200 OK' : `${r.status}`;
  const isJson = r.body && (r.body.startsWith('{') || r.body.startsWith('['));
  console.log(`  ${p} → ${flag} size=${r.body.length}${isJson ? ' JSON' : ''}`);
  if (r.status === 200 && isJson && r.body.length > 100) {
    console.log(`    snippet: ${r.body.slice(0, 400).replace(/\s+/g, ' ')}`);
  } else if (r.body && r.body.length > 200 && r.body.length < 500) {
    console.log(`    body: ${r.body.slice(0, 200).replace(/\s+/g, ' ')}`);
  }
}

process.exit(0);
