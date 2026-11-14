// BETKING (Nigeria) — collecte exécutée ici, sur GitHub, comme les autres books.
//
// Le site est derrière Cloudflare : toute requête serveur (nos IP, relais
// Cloudflare, proxys publics) reçoit « Just a moment… ». Mesuré le 14/11/2026 :
// un vrai Chromium lancé sur un runner GitHub franchit ce défi sans aucune
// intervention, puis les flux se lisent en MÊME ORIGINE depuis l'hôte des
// cotes (un appel croisé est refusé : cookies tiers).
//
// Aucun compte, aucune authentification : on ne lit que des cotes publiques.
// Import DIFFERE volontaire : la sonde de couverture et les tests de mapping
// chargent le registre des books sans navigateur installe. Un import statique
// faisait planter tout script qui ne connait pas BetKing.
let chromiumMod = null;
async function loadChromium() {
  if (!chromiumMod) chromiumMod = (await import('playwright')).chromium;
  return chromiumMod;
}

export const BETKING_CDN = 'https://sportsapicdn-desktop.betking.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

let session = null;

async function openSession() {
  const chromium = await loadChromium();
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({ userAgent: UA, locale: 'en-US', viewport: { width: 1366, height: 900 } });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  const page = await ctx.newPage();
  // Ouvre l'hôte des cotes : c'est cette visite qui franchit le défi.
  await page
    .goto(`${BETKING_CDN}/api/settings/globalvariables`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    .catch(() => {});
  return { browser, page };
}

async function getPage() {
  if (!session) session = openSession();
  const s = await session;
  return s.page;
}

// Lecture d'un flux, en même origine, avec ré-essais le temps que Cloudflare
// valide le navigateur (2 à 6 s en général).
export async function jget(path, { tries = 6 } = {}) {
  const page = await getPage();
  for (let i = 0; i < tries; i++) {
    const out = await page
      .evaluate(async (p) => {
        try {
          const r = await fetch(p, { headers: { accept: 'application/json, text/plain, */*' } });
          return { status: r.status, text: await r.text() };
        } catch (e) {
          return { status: 0, text: String(e?.message || e) };
        }
      }, path)
      .catch(() => ({ status: 0, text: '' }));
    if (out.status === 200) {
      try { return JSON.parse(out.text); } catch { return null; }
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return null;
}

export async function closeBetking() {
  if (!session) return;
  const s = await session.catch(() => null);
  session = null;
  await s?.browser?.close().catch(() => {});
}
