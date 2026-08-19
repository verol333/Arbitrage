#!/usr/bin/env node
// Probe 10 proxies Webshare contre Apollo pour identifier ceux qui bypass le filtre.
import { ProxyAgent, fetch as undiciFetch } from 'undici';

const AUTH = 'tymphgod:gzrvplok7kr8'; // à régénérer sur Webshare après tests
const PROXIES = [
  'http://31.59.20.176:6754',
  'http://31.56.127.193:7684',
  'http://45.38.107.97:6014',
  'http://198.105.121.200:6462',
  'http://64.137.96.74:6641',
  'http://198.23.243.226:6361',
  'http://38.154.185.97:6370',
  'http://84.247.60.125:6095',
  'http://142.111.67.146:5611',
  'http://191.96.254.138:6185',
];

const APOLLO_URL = 'https://sportapis-apollo.webapis.sk/SportsOfferApi/api/sport/offer/v3/sports';
const HEADERS = {
  'Accept': 'application/json',
  'Origin': 'https://m.apollogames.cg',
  'Referer': 'https://m.apollogames.cg/',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
};

console.log('═══ Test proxies Webshare vs Apollo ═══\n');

const working = [];
for (const proxy of PROXIES) {
  const proxyUrl = proxy.replace('http://', `http://${AUTH}@`);
  const label = proxy.replace('http://', '');
  try {
    const dispatcher = new ProxyAgent(proxyUrl);
    const t0 = Date.now();
    const r = await undiciFetch(APOLLO_URL, {
      headers: HEADERS,
      dispatcher,
      signal: AbortSignal.timeout(12_000),
    });
    const body = await r.text();
    const dt = Date.now() - t0;
    const bodyPreview = body.length > 100 ? body.slice(0, 100) + '...' : body;
    const status = body === '[]' ? '❌ VIDE'
                 : body.length > 10 && body.startsWith('{') ? `✅ OK (${body.length} chars)`
                 : `⚠️ ${bodyPreview}`;
    console.log(`  [${label}]  ${r.status}  ${dt}ms  ${status}`);
    if (body.length > 10 && !body.startsWith('[]')) {
      working.push(proxy);
    }
  } catch (e) {
    console.log(`  [${label}]  ❌ ${e.message}`);
  }
}

console.log(`\n═══ RESULTATS ═══`);
console.log(`Proxies fonctionnels : ${working.length}/${PROXIES.length}`);
if (working.length) {
  console.log('URLs à utiliser :');
  for (const p of working) console.log(`  ${p}`);
}

process.exit(0);
