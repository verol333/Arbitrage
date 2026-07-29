#!/usr/bin/env node
// Probe BetPawa via Scrape.do (1000 credits/mois gratuit).
// Objectif : identifier l'API sports-api.betpawa.XX et voir si render mode
// bypass Cloudflare+Turnstile.

const TOKEN = process.env.SCRAPE_DO_KEY;
if (!TOKEN) { console.log('SCRAPE_DO_KEY missing'); process.exit(1); }

async function scrapedoGet(targetUrl, params = {}) {
  const qs = new URLSearchParams({ token: TOKEN, url: targetUrl, ...params }).toString();
  const start = Date.now();
  const res = await fetch(`https://api.scrape.do/?${qs}`, {
    method: 'GET',
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  return {
    ms: Date.now() - start,
    status: res.status,
    len: body.length,
    isJson: body.trim().startsWith('{') || body.trim().startsWith('['),
    isCf: /cloudflare|just a moment|attention required|access restricted/i.test(body.slice(0, 500)),
    credits: res.headers.get('scrape-do-credit-used') || res.headers.get('sd-credit-used') || '?',
    remaining: res.headers.get('scrape-do-remaining-credit') || res.headers.get('sd-remaining-credit') || '?',
    snippet: body.slice(0, 300).replace(/\s+/g, ' '),
    body,
  };
}

console.log('=== Test 1 : basic (1 credit) sur sports-api.betpawa.cg/v1/sports/events-count ===');
const url1 = 'https://sports-api.betpawa.cg/v1/sports/events-count?eventState=PRE_MATCH';
const r1 = await scrapedoGet(url1);
console.log(`  status=${r1.status} credits=${r1.credits} remaining=${r1.remaining} len=${r1.len} isJson=${r1.isJson} isCf=${r1.isCf} ms=${r1.ms}`);
console.log(`  snippet: ${r1.snippet}`);

console.log('\n=== Test 2 : render=true (5 credits) ===');
const r2 = await scrapedoGet(url1, { render: 'true' });
console.log(`  status=${r2.status} credits=${r2.credits} remaining=${r2.remaining} len=${r2.len} isJson=${r2.isJson} isCf=${r2.isCf} ms=${r2.ms}`);
console.log(`  snippet: ${r2.snippet}`);

// Si render=true a marché → tester d'autres endpoints
if (r2.status === 200 && r2.isJson) {
  console.log('\n✓ render mode fonctionne ! Test endpoints supplementaires :');

  const today = new Date().toISOString().slice(0, 10);
  const tests = [
    `https://sports-api.betpawa.cg/v1/events/upcoming?sportId=1&date=${today}&timeOffset=0&limit=20`,
    `https://sports-api.betpawa.cg/v1/events/highlights?sportId=1&timeOffset=0`,
    // Sample event
  ];
  for (const u of tests) {
    console.log(`\n${u.replace(/^https?:\/\//, '')}`);
    const r = await scrapedoGet(u, { render: 'true' });
    console.log(`  status=${r.status} credits=${r.credits} remaining=${r.remaining} len=${r.len} isJson=${r.isJson}`);
    if (r.isJson && r.len > 500) {
      // Extract events count
      try {
        const j = JSON.parse(r.body);
        const evs = j?.data?.categories || (Array.isArray(j?.data) ? j.data : []);
        console.log(`  ↳ preview: ${JSON.stringify(j).slice(0, 400)}`);
      } catch {}
    }
  }
}

console.log('\n=== Test 3 : super=true (10 credits) — IP residentielle ===');
const r3 = await scrapedoGet(url1, { super: 'true' });
console.log(`  status=${r3.status} credits=${r3.credits} remaining=${r3.remaining} len=${r3.len} isJson=${r3.isJson} isCf=${r3.isCf}`);
console.log(`  snippet: ${r3.snippet}`);

console.log('\n=== Résumé ===');
console.log(`  basic: ${r1.status} ${r1.isJson ? '✓JSON' : ''} ${r1.isCf ? '✗CF-BLOCK' : ''}`);
console.log(`  render: ${r2.status} ${r2.isJson ? '✓JSON' : ''} ${r2.isCf ? '✗CF-BLOCK' : ''}`);
console.log(`  super: ${r3.status} ${r3.isJson ? '✓JSON' : ''} ${r3.isCf ? '✗CF-BLOCK' : ''}`);
