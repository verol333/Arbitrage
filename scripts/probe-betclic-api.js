// Betclic CDN api = offer.cdn.begmedia.com/api
// Direct depuis GH probable KO (geo-lock) → via Scrape.do geoCode=ci
const TOKEN = process.env.SCRAPE_DO_KEY || '';

async function viaScrape(url, geo = 'ci', timeoutMs = 45_000) {
  const t0 = Date.now();
  const qs = new URLSearchParams({ token: TOKEN, url, geoCode: geo, super: 'true' }).toString();
  try {
    const res = await fetch(`https://api.scrape.do/?${qs}`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.text();
    return { url, elapsed: Date.now() - t0, status: res.status, len: body.length, body };
  } catch (e) { return { url, elapsed: Date.now() - t0, error: e.message }; }
}

const BASE = 'https://offer.cdn.begmedia.com/api';
const combos = [
  { application: 48, countrycode: 'ci', sitecode: 'cifr' },
  { application: 48, countrycode: 'ci', sitecode: 'ci' },
  { application: 2, countrycode: 'ci', sitecode: 'cifr' },
  { application: 1, countrycode: 'ci', sitecode: 'cifr' },
];
const paths = ['pub/v4/sports', 'pub/v4/events'];

console.log('=== Betclic API via Scrape.do geoCode=ci super ===\n');
for (const p of paths) {
  for (const c of combos) {
    const qs = new URLSearchParams({ ...c, language: 'fr' }).toString();
    const url = `${BASE}/${p}?${qs}`;
    const r = await viaScrape(url);
    const body = r.body || '';
    const isJson = body.trim().startsWith('{') || body.trim().startsWith('[');
    const ok = r.status === 200 && isJson;
    console.log(`${ok ? '✅' : '  '} ${r.status ?? 'ERR'} ${r.elapsed}ms len=${r.len ?? '-'} app=${c.application} cc=${c.countrycode} sc=${c.sitecode} ${p}`);
    if (ok) {
      console.log(`   ${body.slice(0, 400).replace(/\s+/g, ' ')}`);
      // Try to parse and count items
      try { const j = JSON.parse(body); if (Array.isArray(j)) console.log(`   → array of ${j.length} items`); else if (j && typeof j === 'object') console.log(`   → keys: ${Object.keys(j).slice(0, 8).join(',')}`); } catch {}
    } else if (r.error) console.log(`   err=${r.error}`);
    else if (body) console.log(`   ${body.slice(0, 200).replace(/\s+/g, ' ')}`);
  }
}
process.exit(0);
