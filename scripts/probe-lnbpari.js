#!/usr/bin/env node
// Probe LNBpari (nouveau bookmaker, plateforme APG/Betster).
// Endpoint capture par le user : /apg/v0/navigation/sport/widgets/sport-events
// Nécessite x-api-key + x-application-id + x-clientid (semble statique).
// Test direct + CF worker + Webshare pour verifier accessibilite.
import { ProxyAgent, fetch as undiciFetch } from 'undici';

const now = new Date();
const to = new Date(now.getTime() + 24 * 3600 * 1000);
const URL_EVENTS = `https://lnbpari.com/apg/v0/navigation/sport/widgets/sport-events?context=sport&entityId=F&model=trend&fromStartDate=${now.toISOString()}&toStartDate=${to.toISOString()}&includeAnalyticsData=true&tournamentLimit=50&addPinned=true`;

const HEADERS = {
  accept: '*/*',
  'accept-language': 'fr-FR,fr;q=0.8',
  'content-type': 'application/json',
  referer: 'https://lnbpari.com/fr/sports/football',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36',
  'x-api-key': '9ba6608f-c15b-4d37-83e8-bb89aa22d2e7',
  'x-application-id': '0e4a4d8d-46a5-483e-ba1c-893d909244ee',
  'x-betster-team-consumer': 'Sport Widgets Tech',
  'x-betsterversion': '2.4.0',
  'x-channel': 'MOBILE_WEB',
  'x-clientid': '7b8772908edc160e61be7abef05317ac',
  'x-extensionname': 'sportsApi',
  'x-extensionversion': '1.42.0',
  'x-language': 'fr',
  'x-place': 'sport-events-feed-widget',
  'x-platform': 'web-mobile',
  'x-teamname': 'Sport Widgets Tech',
};

function countMatches(j) {
  let n = 0;
  const payload = j?.payload || [];
  for (const t of payload) {
    for (const e of t.events || []) n++;
  }
  return n;
}
function interpret(status, body) {
  if (!body) return '⚠️ empty';
  if (body.length > 100 && body.startsWith('{')) {
    try {
      const j = JSON.parse(body);
      if (j.payload) return `🟢 ${countMatches(j)} matchs (${(j.payload||[]).length} tournois)`;
    } catch {}
    return `🟡 JSON mais pas payload attendu`;
  }
  if (status === 403 || body.toLowerCase().includes('cloudflare')) return '🔴 CF BLOCK';
  return `⚠️ ${status}`;
}

console.log(`URL testee : ${URL_EVENTS.slice(0, 120)}...\n`);

console.log('═══ Test 1 : GET direct GitHub Actions ═══');
try {
  const t0 = Date.now();
  const r = await fetch(URL_EVENTS, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  const body = await r.text();
  console.log(`  Status: ${r.status} (${Date.now()-t0}ms, ${body.length}b) ${interpret(r.status, body)}`);
  if (body.length < 500) console.log(`  Preview: ${body.slice(0, 400)}`);
} catch (e) {
  console.log(`  ❌ ${e.message}`);
}

console.log('\n═══ Test 2 : GET via CF Worker ═══');
try {
  const proxied = `https://appolo.alexverol02.workers.dev/?url=${encodeURIComponent(URL_EVENTS)}`;
  const t0 = Date.now();
  const r = await fetch(proxied, { signal: AbortSignal.timeout(15_000) });
  const body = await r.text();
  console.log(`  Status: ${r.status} (${Date.now()-t0}ms, ${body.length}b) ${interpret(r.status, body)}`);
  if (body.length < 500) console.log(`  Preview: ${body.slice(0, 400)}`);
} catch (e) {
  console.log(`  ❌ ${e.message}`);
}

console.log('\n═══ Test 3 : GET via Webshare US ═══');
try {
  const dispatcher = new ProxyAgent('http://tymphgod:gzrvplok7kr8@31.56.127.193:7684');
  const t0 = Date.now();
  const r = await undiciFetch(URL_EVENTS, { headers: HEADERS, dispatcher, signal: AbortSignal.timeout(12_000) });
  const body = await r.text();
  console.log(`  Status: ${r.status} (${Date.now()-t0}ms, ${body.length}b) ${interpret(r.status, body)}`);
} catch (e) {
  console.log(`  ❌ ${e.message}`);
}

console.log('\nFin probe LNBpari.');
process.exit(0);
