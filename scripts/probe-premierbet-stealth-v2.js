// PremierBet v2 : combos plus agressifs pour bypass CF Turnstile
// A: playwright-extra + stealth plugin (obscurcit ~80% des CF fingerprints)
// B: Firefox headless (moins ciblé que Chromium par CF)
// C: essai divers pays / paths / User-Agent mobiles réels
import { firefox } from 'playwright';

const results = { attempts: [] };

async function tryProfile(name, cfg) {
  const start = Date.now();
  const attempt = { name, elapsed_ms: 0 };
  let browser, ctx, page;
  try {
    browser = await cfg.launcher.launch({ headless: true, args: cfg.args || [] });
    ctx = await browser.newContext({
      userAgent: cfg.ua,
      viewport: cfg.viewport,
      locale: cfg.locale || 'fr-FR',
      extraHTTPHeaders: cfg.extraHeaders || {},
      deviceScaleFactor: cfg.deviceScaleFactor,
      isMobile: cfg.isMobile,
      hasTouch: cfg.hasTouch,
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
      // WebGL fingerprint spoofing
      const gp = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (p) {
        if (p === 37445) return 'Intel Inc.';
        if (p === 37446) return 'Intel Iris OpenGL Engine';
        return gp.call(this, p);
      };
    });
    page = await ctx.newPage();
    await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(15000); // laisser CF résoudre
    attempt.url = page.url();
    attempt.title = (await page.title()).slice(0, 100);
    const cookies = await ctx.cookies();
    attempt.cf_clearance = cookies.find((c) => c.name === 'cf_clearance') ? 'PRESENT' : 'ABSENT';
    attempt.cookie_count = cookies.length;
    // Sample body
    const body = await page.content();
    attempt.body_start = body.slice(0, 250).replace(/\s+/g, ' ');
    attempt.blocked = attempt.title.includes('Attention Required') || attempt.title.includes('Cloudflare') || attempt.title.includes('Just a moment');
  } catch (e) {
    attempt.error = e.message.slice(0, 150);
  } finally {
    attempt.elapsed_ms = Date.now() - start;
    if (ctx) await ctx.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
  results.attempts.push(attempt);
}

// A: Firefox (moins ciblé par CF Turnstile que Chromium)
await tryProfile('firefox-desktop', {
  launcher: firefox,
  ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  viewport: { width: 1920, height: 1080 },
  url: 'https://premierbetzone.com/',
});

// B: Firefox mobile
await tryProfile('firefox-mobile', {
  launcher: firefox,
  ua: 'Mozilla/5.0 (Android 13; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0',
  viewport: { width: 412, height: 869 },
  isMobile: false, // firefox mobile emulation buggy
  hasTouch: true,
  url: 'https://premierbetzone.com/',
});

// C: differents pays / paths
for (const path of ['/en/', '/ao/', '/mz/', '/cm/', '/', '/en/sportsbook/live']) {
  await tryProfile(`firefox-desktop-${path}`, {
    launcher: firefox,
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    viewport: { width: 1920, height: 1080 },
    url: 'https://premierbetzone.com' + path,
  });
}

console.log('=== PREMIERBET STEALTH V2 ===');
console.log(JSON.stringify(results, null, 2));
console.log('=== END ===');
process.exit(0);
