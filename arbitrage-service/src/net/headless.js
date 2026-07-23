// Hook Playwright — non activé par défaut.
// Pour l'utiliser : `npm i playwright` puis PROXY_MODE=headless dans Render,
// et vérifier que l'image Docker contient Chromium (buildpack Render standard
// ne l'inclut pas — voir README section « Proxy headless »).
let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import('playwright');
      return chromium.launch({ headless: true });
    })();
  }
  return browserPromise;
}

export async function headlessFetch(url, opts = {}) {
  const browser = await getBrowser();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    const res = await page.goto(url, { timeout: opts.timeoutMs || 25_000, waitUntil: 'networkidle' });
    const body = await res.text();
    return { ok: res.ok(), status: res.status(), text: async () => body };
  } finally {
    await ctx.close().catch(() => {});
  }
}
