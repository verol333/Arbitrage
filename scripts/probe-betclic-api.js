// Betclic CDN api = offer.cdn.begmedia.com/api (partagé du groupe Betclic)
// Tester endpoints publics + params application/countrycode/sitecode pour .ci
async function tryDirect(url, extra = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: {
        accept: 'application/json',
        'accept-language': 'fr-CI,fr;q=0.9',
        origin: 'https://www.betclic.ci',
        referer: 'https://www.betclic.ci/',
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
        ...extra,
      },
    });
    const body = await res.text();
    return { url, elapsed: Date.now() - t0, status: res.status, len: body.length, start: body.slice(0, 500).replace(/\s+/g, ' ') };
  } catch (e) { return { url, elapsed: Date.now() - t0, error: e.message }; }
}

const BASE = 'https://offer.cdn.begmedia.com/api';
// Tester différentes combinaisons application ID + sitecode
const combos = [
  { application: 48, countrycode: 'ci', sitecode: 'cifr' },
  { application: 48, countrycode: 'ci', sitecode: 'ci' },
  { application: 48, countrycode: 'CI', sitecode: 'CIFR' },
  { application: 2, countrycode: 'ci', sitecode: 'cifr' },
  { application: 1, countrycode: 'ci', sitecode: 'cifr' },
];
const paths = [
  'pub/v4/sports',
  'pub/v4/events',
  'pub/v4/live/events',
  'pub/v4/sports/1/events',
];

console.log('=== TEST endpoints Betclic offer.cdn.begmedia.com ===\n');
for (const p of paths) {
  for (const c of combos) {
    const qs = new URLSearchParams({ ...c, language: 'fr' }).toString();
    const url = `${BASE}/${p}?${qs}`;
    const r = await tryDirect(url);
    const isJson = r.start && r.start.trim().startsWith('{') || r.start.trim().startsWith('[');
    const ok = r.status === 200 && isJson;
    console.log(`  ${ok ? '✅' : '  '} ${r.status ?? 'ERR'} ${r.elapsed}ms len=${r.len ?? '-'} app=${c.application} cc=${c.countrycode} sc=${c.sitecode} path=${p}`);
    if (ok) console.log(`     ${r.start.slice(0, 250)}`);
  }
}
process.exit(0);
