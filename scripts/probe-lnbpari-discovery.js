#!/usr/bin/env node
// PROBE LNBPARI DISCOVERY — reconnaissance rapide
//   1. Home page direct + stealth : protection ?
//   2. Cherche API endpoints dans HTML
//   3. Test endpoints candidats (SportRadar/BetConstruct/Digitain patterns)

import { gotScraping } from 'got-scraping';

async function stealth(url, timeoutMs = 20_000) {
  try {
    const res = await gotScraping({
      url, timeout: { request: timeoutMs }, retry: { limit: 0 }, throwHttpErrors: false,
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 126 }],
        devices: ['desktop'], locales: ['fr-FR'], operatingSystems: ['linux'],
      },
    });
    return { status: res.statusCode, body: res.body, headers: res.headers };
  } catch (e) { return { status: 0, body: null, err: e.message }; }
}

async function direct(url, timeoutMs = 15_000, headers = {}) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120',
        Accept: 'application/json, text/html, */*',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        ...headers,
      },
    });
    return { status: res.status, body: await res.text(), headers: Object.fromEntries(res.headers) };
  } catch (e) { return { status: 0, body: null, err: e.message }; }
}

async function jina(url, timeoutMs = 30_000) {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: '*/*', 'X-Return-Format': 'markdown' },
    });
    return { status: res.status, body: await res.text() };
  } catch (e) { return { status: 0, body: null, err: e.message }; }
}

console.log('▶ LNBPARI DISCOVERY\n');

// ═══ 1. Home page — protection ═══
console.log('══ 1. HOME PAGE ══');
const homeStealth = await stealth('https://lnbpari.com/');
console.log(`  stealth : status=${homeStealth.status} len=${homeStealth.body?.length || 0} server=${homeStealth.headers?.server || '?'}`);
const homeDirect = await direct('https://lnbpari.com/');
console.log(`  direct  : status=${homeDirect.status} len=${homeDirect.body?.length || 0} server=${homeDirect.headers?.server || '?'}`);

const sample = homeStealth.body || homeDirect.body;
if (sample) {
  const cf = /cloudflare|cf-ray|__cf_/i.test(sample);
  const cfChal = /cf-challenge|cf_chl|challenge-platform/i.test(sample);
  const aka = /akamai/i.test(sample);
  const dd = /datadome/i.test(sample);
  console.log(`  Protection : CF=${cf} CF-challenge=${cfChal} Akamai=${aka} DataDome=${dd}`);
  console.log(`  Sample first 500: ${sample.slice(0, 500).replace(/\s+/g, ' ')}`);

  // Cherche URLs API
  const apiUrls = new Set();
  for (const m of sample.matchAll(/https?:\/\/[^"'\s<>]*(?:api|sport|feed|odds|event|betting|graph)[^"'\s<>]*/gi)) apiUrls.add(m[0].slice(0, 200));
  for (const m of sample.matchAll(/["'](\/api\/[^"'\s]+)["']/g)) apiUrls.add(m[1]);
  for (const m of sample.matchAll(/["'](\/services\/[^"'\s]+)["']/g)) apiUrls.add(m[1]);
  console.log(`  URLs API-like : ${apiUrls.size}`);
  [...apiUrls].slice(0, 20).forEach((u) => console.log(`    - ${u}`));

  // Meta tags + tech detection
  const generator = sample.match(/<meta\s+name=["']generator["']\s+content=["']([^"']+)["']/i);
  if (generator) console.log(`  Generator: ${generator[1]}`);
  const nextData = sample.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]{0,3000})/);
  if (nextData) console.log(`  __NEXT_DATA__ found, first 800: ${nextData[1].slice(0, 800)}`);
}

// ═══ 2. Jina fallback ═══
console.log('\n══ 2. JINA READER ══');
const jinaR = await jina('https://lnbpari.com/');
console.log(`  status=${jinaR.status} len=${jinaR.body?.length || 0}`);
if (jinaR.body) console.log(`  First 2000:\n${jinaR.body.slice(0, 2000)}`);

// ═══ 3. Endpoints candidats ═══
console.log('\n══ 3. ENDPOINTS CANDIDATS ══');
const candidates = [
  // SportRadar/PremierBet style
  'https://lnbpari.com/api/v3/events/highlights?sportId=1',
  'https://sports-api.lnbpari.com/api/v3/events/highlights?sportId=1',
  'https://api.lnbpari.com/api/v3/events/highlights?sportId=1',
  // Digitain / classical bookmaker
  'https://lnbpari.com/api/sports',
  'https://lnbpari.com/api/config',
  'https://lnbpari.com/services/Get',
  // BetConstruct
  'https://lnbpari.com/services/getEvents',
  // sportybet style
  'https://lnbpari.com/api/sport/getTournamentsByCategory',
  // graphql
  'https://lnbpari.com/graphql',
  // custom guess soccer
  'https://lnbpari.com/api/prematch/soccer',
  'https://lnbpari.com/api/events?sport=soccer',
];
for (const u of candidates) {
  const r = await direct(u, 10_000);
  const preview = r.body ? r.body.slice(0, 120).replace(/\s+/g, ' ') : '';
  console.log(`  status=${r.status} len=${r.body?.length || 0} ${u.slice(-70)}${preview ? ' | ' + preview : ''}`);
}

console.log('\n▶ Fin.');
process.exit(0);
