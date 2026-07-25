// Probe v4 winner.bet : Playwright + capture TOUT le trafic non-asset.
import { chromium } from 'playwright';

const results = { xhr_fetch: [], websockets: [], errors: [], docs: [] };

async function probe() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'fr-FR',
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: { 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8' },
  });
  const page = await ctx.newPage();

  page.on('request', (req) => {
    const u = req.url();
    // Skip assets, analytics, CDN images
    if (/\.(png|jpg|jpeg|gif|svg|woff|woff2|ttf|otf|css|ico|webp|mp4|webm|map|js\?|js$)/i.test(u)) return;
    if (/googletagmanager|google-analytics|doubleclick|facebook\.com|hotjar|sentry|datadog|newrelic|cloudflareinsights|beacon\.min\.js/i.test(u)) return;
    const type = req.resourceType();
    if (type === 'xhr' || type === 'fetch' || type === 'websocket' || type === 'document') {
      const entry = { method: req.method(), url: u.slice(0, 300), type };
      if (type === 'document') results.docs.push(entry);
      else results.xhr_fetch.push(entry);
    }
  });
  page.on('websocket', (ws) => {
    results.websockets.push({ url: ws.url() });
    ws.on('framereceived', (f) => {
      if (results.ws_frames === undefined) results.ws_frames = [];
      if (results.ws_frames.length < 3 && f.payload) results.ws_frames.push(String(f.payload).slice(0, 200));
    });
  });
  page.on('pageerror', (e) => results.errors.push(e.message.slice(0, 150)));
  page.on('console', (m) => { if (m.type() === 'error') results.errors.push('console: ' + m.text().slice(0, 100)); });

  try {
    await page.goto('https://winner.bet/fr/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(10000);
    // Try several plausible French sportsbook URLs
    const paths = [
      '/fr/paris-sportifs',
      '/fr/paris-sportifs/football',
      '/fr/sport/football',
      '/fr/sports/football',
      '/fr/paris-sportifs/en-direct',
      '/fr/paris-sportifs/live',
      '/fr/live',
    ];
    for (const p of paths) {
      try {
        await page.goto('https://winner.bet' + p, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(3500);
      } catch (e) { results.errors.push(`nav ${p}: ${e.message.slice(0, 80)}`); }
    }
    results.final_url = page.url();
    results.title = await page.title();
    // Aggregate unique hosts + path patterns
    const hosts = new Set(); const paths2 = new Set();
    for (const r of results.xhr_fetch) {
      try { const u = new URL(r.url); hosts.add(u.host); paths2.add(`${r.method} ${u.host}${u.pathname.replace(/\/\d{3,}/g, '/{id}')}`); } catch {}
    }
    for (const r of results.docs) {
      try { const u = new URL(r.url); hosts.add(u.host); } catch {}
    }
    results.unique_hosts = [...hosts];
    results.unique_paths = [...paths2].sort();
    // Compact
    results.xhr_fetch = results.xhr_fetch.slice(0, 60);
    results.docs = results.docs.slice(0, 15);
  } catch (e) {
    results.fatal = e.message;
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

await probe();
console.log('=== WINNER PLAYWRIGHT V4 START ===');
console.log(JSON.stringify(results, null, 2));
console.log('=== WINNER PLAYWRIGHT V4 END ===');
process.exit(0);
