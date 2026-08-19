#!/usr/bin/env node
// Probe Casongo pour tester si le CF Worker / proxies Webshare peuvent
// remplacer Scrape.do (payant $).
// Note : sans CASONGO_TOKEN valide, on aura 401 côté Velisports — mais on
// s'attend à voir 401 (auth) et non 403 (Cloudflare block) : si on passe CF,
// on peut remplacer Scrape.do avec un simple proxy résidentiel.
import { ProxyAgent, fetch as undiciFetch } from 'undici';

const TARGET_PATH = '/websitewebapi/Sports/GetPrematchTree';
const TARGET_QS = 'CurrencyId=XAF&LanguageId=fr&PartnerId=2&PartnerName=casongo&TimeZone=1';
const TARGET = `https://prod-api.velisports.com${TARGET_PATH}?${TARGET_QS}`;
const CF_WORKER = 'https://appolo.alexverol02.workers.dev';

const TOKEN = process.env.CASONGO_TOKEN || 'FAKE_TOKEN_FOR_PROBE';
const HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'fr-FR,fr;q=0.8',
  authorization: `Bearer ${TOKEN}`,
  'content-type': 'application/json',
  origin: 'https://launcher.velisports.com',
  referer: 'https://launcher.velisports.com/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36',
};

function preview(body) {
  if (!body) return '(vide)';
  const s = body.replace(/\n/g, ' ').replace(/\s+/g, ' ').slice(0, 250);
  return s + (body.length > 250 ? '...' : '');
}

function interpret(status, body) {
  if (status === 403 || (body || '').toLowerCase().includes('cloudflare')) return '🔴 CF BLOCK';
  if (status === 401) return '🟡 401 = CF passe, token invalide (attendu sans vrai TOKEN)';
  if (status === 200) return '🟢 OK';
  return `⚠️ ${status}`;
}

console.log(`Token utilise : ${TOKEN === 'FAKE_TOKEN_FOR_PROBE' ? 'FAKE (attendu 401)' : 'REAL'}\n`);

console.log('═══ Test 1 : GET direct prod-api.velisports.com ═══');
try {
  const t0 = Date.now();
  const r = await fetch(TARGET, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  const body = await r.text();
  console.log(`  Status: ${r.status}  (${Date.now()-t0}ms, ${body.length} bytes)  ${interpret(r.status, body)}`);
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
  console.log(`  Status: ${r.status}  (${Date.now()-t0}ms, ${body.length} bytes)  ${interpret(r.status, body)}`);
  console.log(`  Preview: ${preview(body)}`);
} catch (e) {
  console.log(`  ❌ ${e.message}`);
}

const AUTH = 'tymphgod:gzrvplok7kr8';
const PROXIES = [
  'http://31.59.20.176:6754',
  'http://198.23.243.226:6361',
  'http://84.247.60.125:6095',
  'http://64.137.96.74:6641',
  'http://191.96.254.138:6185',
];

console.log('\n═══ Test 3 : GET via 5 proxies Webshare ═══');
for (const p of PROXIES) {
  const proxyUrl = p.replace('http://', `http://${AUTH}@`);
  try {
    const dispatcher = new ProxyAgent(proxyUrl);
    const t0 = Date.now();
    const r = await undiciFetch(TARGET, { headers: HEADERS, dispatcher, signal: AbortSignal.timeout(12_000) });
    const body = await r.text();
    console.log(`  [${p.replace('http://','')}]  ${r.status}  ${Date.now()-t0}ms  ${body.length}b  ${interpret(r.status, body)}`);
  } catch (e) {
    console.log(`  [${p.replace('http://','')}]  ❌ ${e.message}`);
  }
}

console.log('\nFin probe casongo.');
process.exit(0);
