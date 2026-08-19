#!/usr/bin/env node
// Probe CF Worker Apollo : verifie que le worker deploye par l'user
// (https://appolo.alexverol02.workers.dev) forwarde correctement vers Apollo.
// Log status HTTP, headers de reponse, et body pour diagnostiquer.

const WORKER_URL = 'https://appolo.alexverol02.workers.dev';
const APOLLO_URL = 'https://sportapis-apollo.webapis.sk/SportsOfferApi/api/sport/offer/v3/sports';

console.log('═══ Test 1 : GET Worker root (sans param url) ═══');
try {
  const r = await fetch(`${WORKER_URL}/`, { signal: AbortSignal.timeout(15_000) });
  console.log(`  Status: ${r.status} ${r.statusText}`);
  console.log(`  Content-Type: ${r.headers.get('content-type')}`);
  const body = await r.text();
  console.log(`  Body (500 premiers chars):\n${body.slice(0, 500)}`);
} catch (e) {
  console.log(`  ❌ Erreur: ${e.message}`);
}

console.log('\n═══ Test 2 : GET Worker + url=sports Apollo ═══');
try {
  const proxied = `${WORKER_URL}/?url=${encodeURIComponent(APOLLO_URL)}`;
  console.log(`  URL: ${proxied}`);
  const r = await fetch(proxied, { signal: AbortSignal.timeout(15_000) });
  console.log(`  Status: ${r.status} ${r.statusText}`);
  console.log(`  Content-Type: ${r.headers.get('content-type')}`);
  const body = await r.text();
  console.log(`  Body length: ${body.length} chars`);
  console.log(`  Body (1000 premiers chars):\n${body.slice(0, 1000)}`);
} catch (e) {
  console.log(`  ❌ Erreur: ${e.message}`);
}

console.log('\n═══ Test 3 : GET direct Apollo (pour comparaison) ═══');
try {
  const r = await fetch(APOLLO_URL, {
    headers: {
      'Accept': 'application/json',
      'Origin': 'https://m.apollogames.cg',
      'Referer': 'https://m.apollogames.cg/',
    },
    signal: AbortSignal.timeout(15_000),
  });
  console.log(`  Status: ${r.status} ${r.statusText}`);
  console.log(`  Content-Type: ${r.headers.get('content-type')}`);
  const body = await r.text();
  console.log(`  Body length: ${body.length} chars`);
  console.log(`  Body (500 premiers chars):\n${body.slice(0, 500)}`);
} catch (e) {
  console.log(`  ❌ Erreur: ${e.message}`);
}

console.log('\nFin probe CF Worker.');
process.exit(0);
