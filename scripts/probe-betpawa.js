#!/usr/bin/env node
// Probe BetPawa : decouvrir la structure API pour recuperer les matchs football
// et les cotes. Teste plusieurs endpoints connus des sites BetConstruct/similaires.

import { stealthGetJson } from '../src/net/stealth.js';
import { gotScraping } from 'got-scraping';

const DOMAINS = [
  'https://www.betpawa.cg',   // Congo
  'https://www.betpawa.co.ke', // Kenya
  'https://www.betpawa.ug',   // Uganda
  'https://www.betpawa.co.tz', // Tanzania
  'https://www.betpawa.ng',   // Nigeria
];

const PATHS = [
  '/api/sports',
  '/api/v1/sports',
  '/api/v2/sports',
  '/api/events',
  '/api/events/upcoming',
  '/api/events/by-sport/football',
  '/api/sports/football/upcoming',
  '/api/sports/football/highlights',
  '/api/prematch/events',
  '/api/live/events',
  '/api/categories',
  '/services/sports',
  '/services/evapi/event/GetEvents',
  '/sportsbook/events',
  '/sportsbook/api/events',
  '/graphql',
  '/api/graphql',
];

async function tryFetch(url) {
  try {
    const r = await gotScraping({
      url,
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120 }],
        devices: ['desktop'],
        locales: ['fr-FR'],
        operatingSystems: ['linux'],
      },
      timeout: { request: 10_000 },
      retry: { limit: 0 },
      throwHttpErrors: false,
      responseType: 'text',
    });
    const body = r.body || '';
    const isJson = /^[\[\{]/.test(body.trim());
    const isHtml = /<html|<!doctype/i.test(body.slice(0, 200));
    const isCf = /cloudflare|just a moment|attention required/i.test(body.slice(0, 500));
    return {
      status: r.statusCode,
      size: body.length,
      isJson,
      isHtml,
      isCf,
      snippet: body.slice(0, 250).replace(/\s+/g, ' '),
    };
  } catch (e) {
    return { status: 0, err: e.message };
  }
}

for (const domain of DOMAINS) {
  console.log(`\n═══ ${domain} ═══`);
  // Fetch homepage pour voir si le domaine repond
  const home = await tryFetch(domain + '/');
  console.log(`  / → ${home.status} ${home.isCf ? 'CF-BLOCK' : ''} ${home.isJson ? 'JSON' : home.isHtml ? 'HTML' : '?'} size=${home.size}`);
  if (home.isCf || home.status === 403) {
    console.log(`  ↳ ${home.snippet}`);
    continue;
  }
  // Test endpoints
  for (const path of PATHS) {
    const r = await tryFetch(domain + path);
    const flags = [
      r.isJson ? '✓JSON' : '',
      r.isCf ? 'CF' : '',
      r.status === 200 ? 'OK' : '',
    ].filter(Boolean).join(' ');
    if (r.status !== 404 && r.status !== 0) {
      console.log(`  ${path} → ${r.status} ${flags} size=${r.size}`);
      if (r.isJson && r.size > 100) {
        console.log(`    ↳ ${r.snippet}`);
      }
    }
  }
}

process.exit(0);
