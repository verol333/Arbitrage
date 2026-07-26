// Découverte API betclic.ci — foot uniquement, max matches
// 1) direct fetch pour voir si CF est actif
// 2) explorer patterns URLs sportsbook typiques (sports/football, prematch, live, offer)
// 3) via Scrape.do en fallback si direct bloque
const TOKEN = process.env.SCRAPE_DO_KEY || '';

async function try1(url, opts = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        accept: 'application/json,text/html;q=0.9,*/*;q=0.1',
        'accept-language': 'fr-FR,fr;q=0.9',
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
        referer: 'https://www.betclic.ci/',
        origin: 'https://www.betclic.ci',
        ...opts.headers,
      },
    });
    const body = await res.text();
    return { url, elapsed: Date.now() - t0, status: res.status, len: body.length, start: body.slice(0, 250).replace(/\s+/g, ' ') };
  } catch (e) { return { url, elapsed: Date.now() - t0, error: e.message }; }
}

async function viaScrape(url) {
  if (!TOKEN) return { scrape: false };
  const t0 = Date.now();
  const qs = new URLSearchParams({ token: TOKEN, url }).toString();
  try {
    const res = await fetch(`https://api.scrape.do/?${qs}`, { signal: AbortSignal.timeout(25_000) });
    const body = await res.text();
    return { url, elapsed: Date.now() - t0, status: res.status, len: body.length, start: body.slice(0, 400).replace(/\s+/g, ' ') };
  } catch (e) { return { url, elapsed: Date.now() - t0, error: e.message }; }
}

// Patterns URL typiques betclic (spectacle-sports platform)
const urls = [
  'https://www.betclic.ci/',
  'https://www.betclic.ci/football',
  'https://www.betclic.ci/football-s1',
  'https://sports.betclic.ci/api/prematch/sports',
  'https://sports.betclic.ci/api/prematch/football',
  'https://api.betclic.ci/prematch/sports',
  'https://spectacle-api.betclic.ci/sports/football',
  'https://cli-web.betclic.ci/api/prematch/sports/1',
  'https://cli-api.betclic.ci/prematch/football',
  'https://cli-api.betclic.ci/api/pub/sports',
  // Pattern PMU/spectrum
  'https://www.betclic.ci/wapi/prematch/sports',
  'https://www.betclic.ci/webapi/sports',
  // Souvent JS SPA — try HTML page pour trouver bundle/api hint
];
console.log('=== DIRECT ===');
for (const u of urls) {
  const r = await try1(u);
  console.log(`  ${r.status ?? 'ERR'} ${r.elapsed}ms len=${r.len ?? '-'} ${u.slice(0, 90)}  ${r.error ? 'err='+r.error : (r.start || '').slice(0,120)}`);
}
console.log('\n=== VIA SCRAPE.DO (root + 1 API) ===');
for (const u of ['https://www.betclic.ci/', 'https://sports.betclic.ci/api/prematch/sports']) {
  const r = await viaScrape(u);
  console.log(`  ${r.status ?? 'ERR'} ${r.elapsed}ms len=${r.len ?? '-'} ${u}\n  start: ${(r.start || r.error || '').slice(0, 350)}\n`);
}
process.exit(0);
