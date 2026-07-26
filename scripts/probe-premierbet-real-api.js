// Tester la VRAIE API PremierBet trouvee par user :
// https://sports-api.premierbet.com/cg/v1/events/... (backend Editec direct)
// Si ce host repond sans CF -> integration sans Scrape.do (economie enorme).
import { fetchJson } from '../src/net/fetcher.js';
import { stealthGetJson } from '../src/net/stealth.js';

const TOKEN = process.env.SCRAPE_DO_KEY || '';

async function tryFetch(name, url, opts = {}) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        accept: 'application/json',
        'accept-language': 'fr-FR,fr;q=0.9',
        origin: 'https://www.premierbet.com',
        referer: 'https://www.premierbet.com/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
        ...opts.headers,
      },
    });
    const body = await res.text();
    return { name, elapsed: Date.now() - start, status: res.status, len: body.length, body_start: body.slice(0, 300).replace(/\s+/g, ' ') };
  } catch (e) { return { name, elapsed: Date.now() - start, error: e.message }; }
}

const results = [];

// 1. Direct fetch featured
results.push(await tryFetch('featured direct', 'https://sports-api.premierbet.com/cg/v1/events/featured?country=CG&group=g5&platform=desktop&locale=fr&pageId=63fe10b530a2f04c64fbd643'));

// 2. Direct fetch by sport (pattern probable pour foot)
for (const path of [
  '/cg/v1/events/prematch?country=CG&group=g5&platform=desktop&locale=fr&sportId=1',
  '/cg/v1/events/prematch?country=CG&group=g5&sportId=1',
  '/cg/v1/events/live?country=CG&group=g5&sportId=1&platform=desktop&locale=fr',
  '/cg/v1/events?country=CG&group=g5&sportId=1',
  '/cg/v1/sports?country=CG&group=g5',
  '/cg/v1/categories?country=CG&sportId=1',
  '/cg/v1/events/upcoming?country=CG&sportId=1&group=g5',
  '/cg/v1/events/all?country=CG&sportId=1',
]) {
  results.push(await tryFetch(`direct ${path}`, `https://sports-api.premierbet.com${path}`));
}

// 3. CMS metadata (structure page)
results.push(await tryFetch('cms metadata', 'https://cms-ui-data-prd.sahara.editec-online.com/CG/sports/sport/football/desktop/fr'));

// 4. Si direct echoue, essai stealth (fingerprint rotation)
const featuredHit = results.find((r) => r.name === 'featured direct');
if (featuredHit && (featuredHit.error || featuredHit.status >= 400)) {
  results.push({ name: '--- stealth fallback ---' });
  const j = await stealthGetJson('https://sports-api.premierbet.com/cg/v1/events/featured?country=CG&group=g5&platform=desktop&locale=fr&pageId=63fe10b530a2f04c64fbd643', { headers: {
    accept: 'application/json', origin: 'https://www.premierbet.com', referer: 'https://www.premierbet.com/',
  }, timeoutMs: 20000 });
  results.push({ name: 'stealth featured', result: j ? { has_data: true, keys: Object.keys(j).slice(0, 10) } : null });
}

// 5. Si direct echoue et stealth aussi, tester via Scrape.do (au moins on saura si c'est proteccion IP-based)
if (TOKEN) {
  const qs = new URLSearchParams({ token: TOKEN, url: 'https://sports-api.premierbet.com/cg/v1/events/featured?country=CG&group=g5&platform=desktop&locale=fr&pageId=63fe10b530a2f04c64fbd643' }).toString();
  const res = await fetch(`https://api.scrape.do/?${qs}`, { signal: AbortSignal.timeout(30000) });
  const body = await res.text();
  results.push({ name: 'via scrape.do', status: res.status, len: body.length, body_start: body.slice(0, 300) });
}

console.log('=== RESULTS ===');
console.log(JSON.stringify(results, null, 2));
console.log('=== END ===');
process.exit(0);
