// Relevé du vocabulaire réel des marchés BetKing (noms + identifiants +
// sélections) pour écrire un mapping exact, marché par marché.
import { chromium } from 'playwright';

const CDN = 'https://sportsapicdn-desktop.betking.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ userAgent: UA, locale: 'en-US', viewport: { width: 1366, height: 900 } });
await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
const page = await ctx.newPage();
await page.goto(`${CDN}/api/settings/globalvariables`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
await page.waitForTimeout(9000);

const data = await page.evaluate(async () => {
  const jget = async (p) => { const r = await fetch(p, { headers: { accept: 'application/json' } }); const t = await r.text(); try { return JSON.parse(t); } catch { return null; } };
  const menu = await jget('/api/feeds/prematch/matches/custommenu/en/4');
  const foot = (menu?.Sports || []).find((s) => s.SportID === 1);
  const tours = [];
  for (const c of foot?.Category || []) for (const t of c.Tournaments || []) if ((t.ItemEventCount || 0) > 3) tours.push({ id: t.ItemID, n: t.ItemEventCount });
  tours.sort((a, b) => b.n - a.n);
  let best = null;
  for (const t of tours.slice(0, 3)) {
    const feed = await jget(`/api/feeds/prematch/en/1/${t.id}/0/0`);
    for (const area of feed?.AreaMatches || []) for (const it of area.Items || []) {
      const n = (it.OddsCollection || []).length;
      if (!best || n > best.n) best = { n, item: it };
    }
  }
  if (!best) return { error: 'aucun match' };
  const it = best.item;
  const types = [];
  for (const c of it.OddsCollection || []) {
    types.push({
      id: Number(c.OddsType?.OddsTypeID) || 0,
      name: String(c.OddsType?.OddsTypeName || ''),
      param: Number(c.SpecialBetValue) || 0,
      sels: (c.MatchOdds || []).map((m) => String(m.OddAttribute?.OddName || '') + ':' + Number(m.Outcome?.OddOutcome)),
    });
  }
  return { match: it.ItemName, date: it.ItemDate, nbMarkets: types.length, types };
});
console.log('VOCAB', JSON.stringify(data).slice(0, 12000));
await browser.close();
