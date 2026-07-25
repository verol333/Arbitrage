// Probe PremierBet : tester une batterie de sous-domaines et endpoints
// que l'app mobile pourrait utiliser (souvent hors Cloudflare).
import { gotScraping } from 'got-scraping';

const CHROME = { browsers: [{ name: 'chrome' }], devices: ['mobile'], locales: ['fr-FR'], operatingSystems: ['android'] };

async function probe(url, opts = {}) {
  try {
    const res = await gotScraping({
      url,
      headers: opts.headers || {},
      headerGeneratorOptions: CHROME,
      timeout: { request: 10000 },
      retry: { limit: 0 },
      throwHttpErrors: false,
    });
    const ct = res.headers['content-type'] || '';
    const body = res.body || '';
    return { status: res.statusCode, ctype: ct, size: body.length, sample: body.slice(0, 200), is_json: ct.includes('json') };
  } catch (e) { return { error: e.message }; }
}

// Bases à tester : plusieurs domaines PremierBet (opérateur multi-pays)
const bases = [
  'https://premierbetzone.com',
  'https://www.premierbetzone.com',
  'https://api.premierbetzone.com',
  'https://mobile.premierbetzone.com',
  'https://m.premierbetzone.com',
  'https://services.premierbetzone.com',
  'https://webservice.premierbetzone.com',
  'https://ws.premierbetzone.com',
  'https://backend.premierbetzone.com',
  'https://feed.premierbetzone.com',
  'https://sportsbook.premierbetzone.com',
  'https://cdn.premierbetzone.com',
  'https://static.premierbetzone.com',
  // Variantes multi-pays Editec
  'https://api.premierbet.co.cm',
  'https://api.premierbet.co.tz',
  'https://api.premierbet.co.zm',
  'https://api.premierbet.co.mz',
  // Domaines Editec / Goat Interactive candidats
  'https://api.editec.com',
  'https://api.goat-interactive.com',
];

// Chemins courants d'un backend sportsbook
const paths = [
  '/', '/api', '/api/v1', '/api/v2', '/api/sports',
  '/api/events', '/rest', '/rest/market', '/rest/market/events',
  '/rest/market/events/bestsellers', '/service', '/webservice',
  '/sportsbook/api/sports', '/sportsbook/api/events',
  '/mobile/api/events', '/m/api/events',
];

const results = [];
for (const base of bases) {
  const rootR = await probe(base);
  results.push({ url: base, ...rootR });
  if (rootR.status && rootR.status < 400) {
    // essayer quelques paths
    for (const p of paths.slice(0, 6)) {
      const r = await probe(base + p, { headers: { accept: 'application/json' } });
      results.push({ url: base + p, ...r });
    }
  }
}

console.log('=== PREMIERBET PROBE START ===');
console.log(JSON.stringify(results.filter((r) => !r.error || !r.error.includes('ENOTFOUND')), null, 2));
console.log('=== PREMIERBET PROBE END ===');
process.exit(0);
