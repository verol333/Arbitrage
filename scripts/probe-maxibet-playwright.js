#!/usr/bin/env node
// PROBE MAXIBET PLAYWRIGHT — vraie browser pour bypasser CF + intercepter API
//
// Objectifs :
//   1. Charger la vraie page prematch Soccer
//   2. Attendre le lazy-load des marches (10s wait)
//   3. Intercepter TOUS les XHR/fetch → trouver API interne
//   4. Dump le DOM rendu pour voir les marches complets
//   5. Tenter la page detail d'un match reel

import { chromium } from 'playwright';

console.log('▶ MAXIBET PLAYWRIGHT PROBE\n');

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'fr-FR',
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();

// Intercepte toutes les requetes reseau
const apiCalls = [];
page.on('request', (req) => {
  const url = req.url();
  const method = req.method();
  if (/\.(png|jpg|jpeg|gif|svg|woff2?|ttf|css)(\?|$)/i.test(url)) return;
  if (/googletagmanager|google-analytics|hoory|hotjar|snowplow/i.test(url)) return;
  apiCalls.push({ method, url: url.slice(0, 250) });
});
page.on('response', async (res) => {
  const url = res.url();
  if (/api|graphql|event|odds|market/i.test(url) && !/casino|game-view/i.test(url)) {
    try {
      const ct = res.headers()['content-type'] || '';
      if (ct.includes('json')) {
        const body = await res.text().catch(() => '');
        console.log(`  [XHR ${res.status()}] ${url.slice(0, 150)} → ${body.length}B ${body.slice(0, 200)}`);
      }
    } catch {}
  }
});

console.log('══ 1. NAVIGATE prematch/Soccer ══');
await page.goto('https://m.maxibet.bet/fr/sports/prematch/Soccer', { waitUntil: 'networkidle', timeout: 60_000 }).catch((e) => console.log(`  goto err: ${e.message}`));
console.log(`  title: ${await page.title().catch(() => '?')}`);
console.log(`  url apres redirect: ${page.url()}`);

// Attendre lazy-load
await page.waitForTimeout(8_000);

// Screenshot pour visuel
await page.screenshot({ path: '/tmp/maxibet.png' }).catch(() => {});

// Cherche eventIds dans le DOM rendu
console.log('\n══ 2. DOM RENDU (extract eventIds + markets) ══');
const domData = await page.evaluate(() => {
  const evIds = new Set();
  const markets = new Set();
  // data-*
  for (const el of document.querySelectorAll('[data-event-id], [data-eventid], [data-game-id], [data-match-id]')) {
    const id = el.getAttribute('data-event-id') || el.getAttribute('data-eventid') || el.getAttribute('data-game-id') || el.getAttribute('data-match-id');
    if (id) evIds.add(id);
  }
  // hrefs
  for (const a of document.querySelectorAll('a[href*="event"], a[href*="match"]')) {
    const m = a.href.match(/\/(\d{6,15})(?:[/?#]|$)/);
    if (m) evIds.add(m[1]);
  }
  // Cherche noms marches dans le DOM
  const textContent = document.body?.textContent || '';
  const marketNames = ['Résultat du match', 'Double Chance', 'Handicap', 'Total de buts', 'Les 2 équipes marquent', '1re mi-temps'];
  for (const n of marketNames) if (textContent.includes(n)) markets.add(n);
  // Count "V1" cotes visibles
  const oddSpans = document.querySelectorAll('[class*="odd"], [class*="Odd"], [class*="price"], [class*="Price"], [class*="coefficient"], [class*="Coefficient"]');
  return {
    eventIds: [...evIds],
    markets: [...markets],
    oddSpanCount: oddSpans.length,
    bodyTextLen: textContent.length,
  };
});
console.log(`  eventIds trouves: ${domData.eventIds.length} → ${domData.eventIds.slice(0, 8).join(', ')}`);
console.log(`  marches dans texte: ${domData.markets.join(' | ')}`);
console.log(`  odd spans DOM: ${domData.oddSpanCount}, body text: ${domData.bodyTextLen}B`);

// ═══ 3. Si on a des IDs, aller sur page detail ═══
if (domData.eventIds.length > 0) {
  const eid = domData.eventIds[0];
  console.log(`\n══ 3. NAVIGATE detail page eventId=${eid} ══`);
  await page.goto(`https://m.maxibet.bet/fr/sports/pre-match/event-view/${eid}`, { waitUntil: 'networkidle', timeout: 60_000 }).catch((e) => console.log(`  goto err: ${e.message}`));
  await page.waitForTimeout(5_000);
  console.log(`  url: ${page.url()}`);
  // Dump marches page detail
  const detail = await page.evaluate(() => {
    const rows = [];
    // Cherche toute la structure "market-name → odds"
    const marketBlocks = document.querySelectorAll('[class*="Market"], [class*="market"]');
    for (const b of Array.from(marketBlocks).slice(0, 30)) {
      const text = b.textContent?.trim().slice(0, 300) || '';
      if (text) rows.push(text);
    }
    return { blockCount: marketBlocks.length, samples: rows.slice(0, 15) };
  });
  console.log(`  market blocks: ${detail.blockCount}`);
  detail.samples.forEach((s, i) => console.log(`    [${i}] ${s}`));
}

// ═══ 4. Recap API calls interceptes ═══
console.log('\n══ 4. API CALLS INTERCEPTES ══');
const uniqueUrls = [...new Set(apiCalls.map((c) => c.url))];
console.log(`  Total : ${apiCalls.length} calls, ${uniqueUrls.length} URLs uniques`);
// Filter interessantes
const apiUrls = uniqueUrls.filter((u) => /api|graphql|event|odds|market|sport/i.test(u) && !/hoory|casino|game-view|virtual/i.test(u));
console.log(`  URLs API-like (${apiUrls.length}) :`);
apiUrls.slice(0, 30).forEach((u) => console.log(`    - ${u}`));

await browser.close();
console.log('\n▶ Fin.');
process.exit(0);
