// Probe v3 winner.bet : navigate via Playwright headless (Chromium) et intercepte
// TOUTES les requêtes réseau — la vraie API sera visible dans le trafic.
import { chromium } from 'playwright';

const results = { requests: [], websockets: [], errors: [] };

async function probe(url) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'fr-FR',
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();

  page.on('request', (req) => {
    const u = req.url();
    if (/beacon|analytics|google|facebook|tracker|hotjar|sentry|datadog|newrelic|\.png|\.jpg|\.svg|\.woff|\.css|\.ico|\.webp/i.test(u)) return;
    if (/\/api\/|\/rest\/|\/graphql|\/betting|\/sport|\/event|\/prematch|\/live|\/odds|\/market/i.test(u)) {
      results.requests.push({ method: req.method(), url: u.slice(0, 300), type: req.resourceType() });
    }
  });
  page.on('websocket', (ws) => {
    results.websockets.push({ url: ws.url() });
  });
  page.on('pageerror', (e) => results.errors.push(e.message.slice(0, 150)));

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // Laisser le challenge CF passer et le sportsbook charger
    await page.waitForTimeout(8000);
    // Naviguer vers foot
    try {
      await page.goto('https://winner.bet/fr/paris-sportifs/football', { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(4000);
    } catch { /* ignore */ }
    // Puis tennis
    try {
      await page.goto('https://winner.bet/fr/paris-sportifs/tennis', { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(4000);
    } catch { /* ignore */ }
    // Live
    try {
      await page.goto('https://winner.bet/fr/paris-sportifs/direct', { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(4000);
    } catch { /* ignore */ }
    results.final_url = page.url();
    results.title = await page.title();
    // Extraire les patterns d'URL uniques
    const uniqueHosts = new Set();
    const uniquePaths = new Set();
    for (const r of results.requests) {
      try {
        const u = new URL(r.url);
        uniqueHosts.add(u.host);
        // Path pattern (remplacer IDs numériques)
        uniquePaths.add(`${r.method} ${u.host}${u.pathname.replace(/\/\d+/g, '/{id}')}`);
      } catch { /* skip */ }
    }
    results.unique_hosts = [...uniqueHosts];
    results.unique_paths = [...uniquePaths].sort();
    // Compact requests
    results.requests = results.requests.slice(0, 40);
  } catch (e) {
    results.fatal = e.message;
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

await probe('https://winner.bet/fr/');
console.log('=== WINNER PLAYWRIGHT START ===');
console.log(JSON.stringify(results, null, 2));
console.log('=== WINNER PLAYWRIGHT END ===');
process.exit(0);
