// Test API via reverse-proxy www.betclic.ci/kong/* + /sports-offer/*
// (le SPA appelle en relatif, betclic proxy vers begmedia interne)
const TOKEN = process.env.SCRAPE_DO_KEY;

async function viaScrape(url, timeoutMs = 45_000) {
  const t0 = Date.now();
  const qs = new URLSearchParams({ token: TOKEN, url, geoCode: 'ci', super: 'true' }).toString();
  try {
    const res = await fetch(`https://api.scrape.do/?${qs}`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.text();
    return { url, elapsed: Date.now() - t0, status: res.status, len: body.length, body };
  } catch (e) { return { url, elapsed: Date.now() - t0, error: e.message }; }
}

const BASE = 'https://www.betclic.ci';
const combos = [
  { application: 48, countrycode: 'ci', sitecode: 'cifr' },
  { application: 48, countrycode: 'ci', sitecode: 'ci' },
  { application: 1, countrycode: 'ci', sitecode: 'cifr' },
];
// Différents chemins de reverse-proxy possibles
const bases = [
  '/sports-offer/pub/v4',
  '/kong/pub/v4',
  '/api/pub/v4',
  '/offer/pub/v4',
  '/sports-offer/api/pub/v4',
  '/kong/api/pub/v4',
];

console.log('=== Test reverse-proxy paths via www.betclic.ci ===\n');
for (const b of bases) {
  for (const c of combos) {
    const qs = new URLSearchParams({ ...c, language: 'fr' }).toString();
    for (const endpoint of ['sports', 'events']) {
      const url = `${BASE}${b}/${endpoint}?${qs}`;
      const r = await viaScrape(url);
      const body = r.body || '';
      const isJson = body.trim().startsWith('{') || body.trim().startsWith('[');
      const ok = r.status === 200 && isJson;
      const mark = ok ? '✅' : (r.status === 200 ? '🔸' : '  ');
      console.log(`${mark} ${r.status ?? 'ERR'} len=${r.len ?? '-'} ${b}/${endpoint} app=${c.application} cc=${c.countrycode} sc=${c.sitecode}`);
      if (ok) console.log(`   ${body.slice(0, 400).replace(/\s+/g, ' ')}`);
      else if (r.status === 200) console.log(`   [200 non-JSON] ${body.slice(0, 200).replace(/\s+/g, ' ')}`);
    }
  }
}
process.exit(0);
