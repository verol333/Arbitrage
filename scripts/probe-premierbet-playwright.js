// Approche créative PremierBet : Playwright (vrai Chrome) résout le challenge
// Cloudflare, on extrait cookies + endpoints XHR/WS, on teste ensuite un
// fetch direct avec les cookies pour valider qu'on peut scraper.
// Si ça marche : on peut planifier un cron Playwright toutes les 30 min qui
// refresh les cookies, et le scanner régulier utilise le direct fetch.
import { chromium } from 'playwright';

const results = { xhr_fetch: [], websockets: [], errors: [], docs: [], test_direct_fetch: null };

async function probe() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-dev-shm-usage',
    ],
  });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'fr-FR',
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: { 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8' },
  });
  // Cache Chrome fingerprint stealth : plusieurs plugin.language, webdriver false
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    window.chrome = { runtime: {} };
  });
  const page = await ctx.newPage();

  page.on('request', (req) => {
    const u = req.url();
    if (/\.(png|jpg|jpeg|gif|svg|woff|woff2|ttf|otf|css|ico|webp|mp4|webm|map)/i.test(u)) return;
    if (/googletagmanager|google-analytics|doubleclick|facebook\.com|hotjar|sentry|datadog|newrelic|cloudflareinsights|beacon\.min\.js|cdn-cgi/i.test(u)) return;
    const type = req.resourceType();
    if (type === 'xhr' || type === 'fetch' || type === 'websocket' || type === 'document') {
      const entry = { method: req.method(), url: u.slice(0, 300), type };
      if (type === 'document') results.docs.push(entry);
      else results.xhr_fetch.push(entry);
    }
  });
  page.on('response', (res) => {
    // Capturer status code des XHR pour repérer les APIs qui répondent bien
    const u = res.url();
    if (/\.(png|jpg|jpeg|gif|svg|woff|css|ico|webp)/i.test(u)) return;
    if (/cdn-cgi/i.test(u)) return;
    const type = res.request().resourceType();
    if ((type === 'xhr' || type === 'fetch') && res.status() >= 200 && res.status() < 300) {
      const ct = res.headers()['content-type'] || '';
      if (ct.includes('json')) {
        if (!results.json_apis) results.json_apis = [];
        if (results.json_apis.length < 30) results.json_apis.push({ url: u.slice(0, 300), status: res.status() });
      }
    }
  });
  page.on('websocket', (ws) => {
    results.websockets.push({ url: ws.url() });
  });
  page.on('pageerror', (e) => results.errors.push(e.message.slice(0, 150)));

  try {
    // 1. Load home page — laisser CF challenge se résoudre
    console.log('[probe] Loading premierbetzone.com (waiting for CF challenge)...');
    await page.goto('https://premierbetzone.com/', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(8000); // extra time for CF cookies
    results.after_home_url = page.url();
    results.after_home_title = await page.title();

    // 2. Extract cookies (surtout cf_clearance et session)
    const cookies = await ctx.cookies('https://premierbetzone.com');
    results.cookies = cookies.map((c) => ({ name: c.name, value: c.value.slice(0, 20) + '...', domain: c.domain }));

    // 3. Navigate to sportsbook football live pour capturer plus d'endpoints
    const sportPaths = [
      '/en/sportsbook/live',
      '/en/sportsbook/prematch',
      '/en/sports/football',
      '/en/sportsbook/football',
      '/fr/sportsbook/live',
      '/fr/paris-sportifs/football',
    ];
    for (const p of sportPaths) {
      try {
        await page.goto('https://premierbetzone.com' + p, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(3500);
      } catch (e) { results.errors.push(`nav ${p}: ${e.message.slice(0, 80)}`); }
    }

    // 4. Compact endpoints
    const hosts = new Set(); const paths2 = new Set();
    for (const r of results.xhr_fetch) {
      try { const u = new URL(r.url); hosts.add(u.host); paths2.add(`${r.method} ${u.host}${u.pathname.replace(/\/\d{3,}/g, '/{id}')}`); } catch {}
    }
    results.unique_hosts = [...hosts];
    results.unique_paths = [...paths2].sort();
    results.xhr_fetch = results.xhr_fetch.slice(0, 40);
    results.docs = results.docs.slice(0, 10);

    // 5. TEST CRITIQUE : direct fetch avec les cookies extraits
    if (results.json_apis && results.json_apis.length) {
      const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      const testUrl = results.json_apis[0].url;
      try {
        const res = await fetch(testUrl, {
          method: 'GET',
          headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
            'referer': 'https://premierbetzone.com/',
            'origin': 'https://premierbetzone.com',
            'cookie': cookieStr,
          },
        });
        const body = await res.text();
        results.test_direct_fetch = {
          url: testUrl,
          status: res.status,
          body_len: body.length,
          body_start: body.slice(0, 300),
          is_json: (res.headers.get('content-type') || '').includes('json'),
        };
      } catch (e) { results.test_direct_fetch = { error: e.message }; }
    }
  } catch (e) {
    results.fatal = e.message;
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

await probe();
console.log('=== PREMIERBET PLAYWRIGHT START ===');
console.log(JSON.stringify(results, null, 2));
console.log('=== PREMIERBET PLAYWRIGHT END ===');
process.exit(0);
