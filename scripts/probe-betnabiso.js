#!/usr/bin/env node
// Probe betnabiso.cg pour identifier :
//  - Si le site rend en HTML (SSR) ou est une SPA (JS client)
//  - S'il expose une API JSON accessible
//  - Si CF Worker / proxies Webshare passent le blocage geo eventuel
import { ProxyAgent, fetch as undiciFetch } from 'undici';

const TARGET = 'https://betnabiso.cg/sports/match/football';
const CF_WORKER = 'https://appolo.alexverol02.workers.dev';

const HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1',
  'Referer': 'https://betnabiso.cg/',
};

function preview(body) {
  if (!body) return '(vide)';
  const first500 = body.slice(0, 500);
  return first500.replace(/\n/g, ' ').slice(0, 300) + (body.length > 300 ? '...' : '');
}

console.log('═══ Test 1 : GET direct betnabiso.cg ═══');
try {
  const t0 = Date.now();
  const r = await fetch(TARGET, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  const body = await r.text();
  console.log(`  Status: ${r.status} ${r.statusText}  (${Date.now()-t0}ms, ${body.length} bytes)`);
  console.log(`  Content-Type: ${r.headers.get('content-type')}`);
  console.log(`  Preview: ${preview(body)}`);
} catch (e) {
  console.log(`  ❌ ${e.message}`);
}

console.log('\n═══ Test 2 : GET via CF Worker ═══');
try {
  const proxied = `${CF_WORKER}/?url=${encodeURIComponent(TARGET)}`;
  const t0 = Date.now();
  const r = await fetch(proxied, { signal: AbortSignal.timeout(15_000) });
  const body = await r.text();
  console.log(`  Status: ${r.status} ${r.statusText}  (${Date.now()-t0}ms, ${body.length} bytes)`);
  console.log(`  Content-Type: ${r.headers.get('content-type')}`);
  console.log(`  Preview: ${preview(body)}`);
} catch (e) {
  console.log(`  ❌ ${e.message}`);
}

const AUTH = 'tymphgod:gzrvplok7kr8';
const PROXIES = [
  'http://31.59.20.176:6754',
  'http://198.23.243.226:6361',
  'http://84.247.60.125:6095',
];

console.log('\n═══ Test 3 : GET via 3 proxies Webshare (echantillon) ═══');
for (const p of PROXIES) {
  const proxyUrl = p.replace('http://', `http://${AUTH}@`);
  try {
    const dispatcher = new ProxyAgent(proxyUrl);
    const t0 = Date.now();
    const r = await undiciFetch(TARGET, { headers: HEADERS, dispatcher, signal: AbortSignal.timeout(12_000) });
    const body = await r.text();
    console.log(`  [${p.replace('http://', '')}]  ${r.status}  ${Date.now()-t0}ms  ${body.length} bytes`);
    console.log(`    Preview: ${preview(body)}`);
  } catch (e) {
    console.log(`  [${p.replace('http://', '')}]  ❌ ${e.message}`);
  }
}

console.log('\n═══ Test 4 : Cherche un endpoint JSON API ═══');
// Beaucoup de sites africains utilisent Angular/React → API sous /api/
// On tente quelques paths courants pour voir si l on a un endpoint JSON.
const API_PATHS = [
  'https://betnabiso.cg/api/sports',
  'https://betnabiso.cg/api/matches',
  'https://betnabiso.cg/api/football',
  'https://betnabiso.cg/api/events',
  'https://api.betnabiso.cg/sports',
  'https://betnabiso.cg/api/v1/sports',
];
for (const url of API_PATHS) {
  try {
    const t0 = Date.now();
    const r = await fetch(url, { headers: { ...HEADERS, Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) });
    const body = await r.text();
    console.log(`  [${url}]  ${r.status}  ${Date.now()-t0}ms  ${body.length} bytes  CT=${r.headers.get('content-type')}`);
    if (r.status === 200 && body.length > 50) {
      console.log(`    Preview: ${preview(body)}`);
    }
  } catch (e) {
    console.log(`  [${url}]  ❌ ${e.message}`);
  }
}

console.log('\nFin probe betnabiso.');
process.exit(0);
