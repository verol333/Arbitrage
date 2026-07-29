#!/usr/bin/env node
// Probe BetPawa v5 : lecture COMPLETE de env.js + [[...page]] chunk + tous les
// gros chunks, extraire subdomains, URLs, et TOUS les paths /api/*

import { gotScraping } from 'got-scraping';

async function fetchText(url, headers = {}) {
  try {
    const r = await gotScraping({
      url,
      headers: { accept: '*/*', 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8', referer: 'https://www.betpawa.cg/', ...headers },
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120 }],
        devices: ['desktop'], locales: ['fr-FR'], operatingSystems: ['linux'],
      },
      timeout: { request: 25_000 },
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

// 1. env.js COMPLET (contient la config API)
console.log('=== env.js COMPLET ===');
const env = await fetchText(`${BASE}/env.js?v=2.236.103`);
console.log(`status=${env.status} size=${env.body.length}`);
console.log(env.body);

// 2. [[...page]] chunk (catch-all router — contient les pages/data fetching)
console.log('\n=== [[...page]] chunk ===');
const pageChunk = await fetchText(`${BASE}/_next/static/chunks/pages/%5B%5B...page%5D%5D-5ca187021eb1ea15.js`);
console.log(`status=${pageChunk.status} size=${pageChunk.body.length}`);
if (pageChunk.body) {
  // Extract TOUS les paths /api/*, urls et hostnames
  const apiPaths = new Set();
  const urls = new Set();
  for (const m of pageChunk.body.matchAll(/["'](\/api\/[a-z0-9/_-]+)["']/gi)) apiPaths.add(m[1]);
  for (const m of pageChunk.body.matchAll(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}[a-z0-9/._-]*/gi)) urls.add(m[0]);
  console.log(`  /api/* paths (${apiPaths.size}):`);
  for (const p of [...apiPaths].slice(0, 50)) console.log(`    ${p}`);
  console.log(`  URLs (${urls.size}, sample):`);
  const uniqueDomains = new Set();
  for (const u of urls) {
    const dom = u.match(/https?:\/\/([^/]+)/)?.[1];
    if (dom) uniqueDomains.add(dom);
  }
  for (const d of [...uniqueDomains].slice(0, 40)) console.log(`    ${d}`);
}

// 3. Tous les autres chunks nommés dans la homepage HTML
const otherChunks = [
  '62033-312a3cdfab38c19a',
  '51666-7a86a3d51cfd86bd',
  '9519-947c599fb64e5f2c',
  '98148-0225b3c802978383',
  '4060-b6020e3ea6cbbb8c',
  'proto-json-converter-4ba0aec22250826e',
  'zod-b9d658137d322042',
  'redux-0dbe7600fc5407d2',
  'calculator-bundle-c4ce2805aadba300',
  'webpack-3e88249d52705f80',
  'build-version-6d8f7a427f35c351',
];
console.log('\n=== SCAN de tous les chunks pour URLs API ===');
const allApiRefs = new Set();
const allSubdomains = new Set();
for (const chunk of otherChunks) {
  const c = await fetchText(`${BASE}/_next/static/chunks/${chunk}.js`);
  if (!c.body) continue;
  for (const m of c.body.matchAll(/["'](\/api\/[a-z0-9/_-]+)["']/gi)) allApiRefs.add(m[1]);
  for (const m of c.body.matchAll(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi)) {
    const dom = m[0].match(/https?:\/\/([^/]+)/)?.[1];
    if (dom && !/googletagmanager|google-analytics|hotjar|sentry|facebook|linkedin|youtube|twitter/i.test(dom)) {
      allSubdomains.add(dom);
    }
  }
  console.log(`  chunk ${chunk} size=${c.body.length} apiRefs=${allApiRefs.size} doms=${allSubdomains.size}`);
}
console.log(`\n  TOTAL /api/* refs collectes (${allApiRefs.size}) :`);
for (const p of [...allApiRefs]) console.log(`    ${p}`);
console.log(`\n  TOTAL Subdomains uniques (${allSubdomains.size}) :`);
for (const d of [...allSubdomains]) console.log(`    ${d}`);

process.exit(0);
