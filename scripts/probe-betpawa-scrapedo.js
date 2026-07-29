#!/usr/bin/env node
// Probe BetPawa via Scrape.do. Version 2 : Scrape.do refuse .cg comme
// hostname invalide. On teste plusieurs TLD (BetPawa opere dans 10+ pays).

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
    snippet: body.slice(0, 250).replace(/\s+/g, ' '),
    body,
  };
}

// BetPawa opere : .cg .cm .ke .ug .rw .zm .gh .tz .mw .ng
const TLDS = ['ke', 'ug', 'rw', 'zm', 'gh', 'tz', 'ng', 'cm', 'cg'];
const RESULTS = {};

console.log('=== Phase 1 : verifier accessibilite www.betpawa.<TLD> (HTML basic, 1 credit) ===');
for (const tld of TLDS) {
  const url = `https://www.betpawa.${tld}/`;
  try {
    const r = await scrapedoGet(url);
    RESULTS[tld] = r;
    console.log(`  .${tld}: status=${r.status} len=${r.len} isCf=${r.isCf} snippet=${r.snippet.slice(0, 90)}`);
  } catch (e) {
    console.log(`  .${tld}: ERR ${e.message}`);
  }
}

console.log('\n=== Phase 2 : identifier TLDs accessibles (200 non-CF) ===');
const accessible = Object.entries(RESULTS).filter(([_, r]) => r.status === 200 && !r.isCf);
console.log(`  ${accessible.length} TLDs OK : ${accessible.map(([t]) => t).join(', ') || 'aucun'}`);

if (accessible.length === 0) {
  console.log('\n✗ Aucun TLD accessible en basic. Test render=true sur .ke (marche principal) ...');
  const r = await scrapedoGet('https://www.betpawa.ke/', { render: 'true' });
  console.log(`  render .ke: status=${r.status} len=${r.len} isCf=${r.isCf} credits=${r.credits} remaining=${r.remaining}`);
  console.log(`  snippet=${r.snippet}`);
}

console.log('\n=== Phase 3 : pour chaque TLD accessible, tester sports-api ===');
for (const [tld, htmlR] of accessible.slice(0, 3)) {
  console.log(`\n--- .${tld} ---`);
  const apiUrl = `https://sports-api.betpawa.${tld}/v1/sports/events-count?eventState=PRE_MATCH`;
  const r = await scrapedoGet(apiUrl);
  console.log(`  api basic: status=${r.status} len=${r.len} isJson=${r.isJson} isCf=${r.isCf} credits=${r.credits} remaining=${r.remaining}`);
  console.log(`  snippet: ${r.snippet}`);

  if (r.status !== 200 || !r.isJson) {
    const r2 = await scrapedoGet(apiUrl, { render: 'true' });
    console.log(`  api render: status=${r2.status} len=${r2.len} isJson=${r2.isJson} isCf=${r2.isCf} credits=${r2.credits} remaining=${r2.remaining}`);
    console.log(`  snippet: ${r2.snippet}`);
  }
}

console.log('\n=== FIN ===');
