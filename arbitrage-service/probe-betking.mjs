// Diagnostic BetKing depuis un runner GitHub : un vrai Chromium peut-il
// franchir le défi Cloudflare « Just a moment… » qui bloque toute IP serveur ?
// Si oui, BetKing se collecte ici comme les autres books. Sinon, on saura
// définitivement que la passerelle navigateur est indispensable.
import { chromium } from 'playwright';

const CDN = 'https://sportsapicdn-desktop.betking.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({ userAgent: UA, locale: 'en-US', viewport: { width: 1366, height: 900 } });
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
});
const page = await ctx.newPage();
const log = (...a) => console.log(...a);

await page.goto(`${CDN}/api/settings/globalvariables`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => log('GOTO_ERR', e.message));
await page.waitForTimeout(9000);

const title = await page.title().catch(() => '');
log('TITRE', JSON.stringify(title));
log('URL', page.url());

const res = await page.evaluate(async (base) => {
  const get = async (p) => {
    const r = await fetch(p, { headers: { accept: 'application/json, text/plain, */*' } });
    const t = await r.text();
    return { status: r.status, len: t.length, head: t.slice(0, 160) };
  };
  return { globals: await get('/api/settings/globalvariables'), menu: await get('/api/feeds/prematch/matches/custommenu/en/4') };
}, CDN).catch((e) => ({ error: e.message }));
log('RESULTAT', JSON.stringify(res));

await browser.close();
