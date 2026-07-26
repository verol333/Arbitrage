// Découvrir les endpoints API de PremierBet via Scrape.do render=true
// (une seule requête à 5cr — on récupère HTML + captures JS pour identifier
// les URLs XHR appelées par le sportsbook).
const TOKEN = process.env.SCRAPE_DO_KEY;
if (!TOKEN) { console.log('SCRAPE_DO_KEY missing'); process.exit(1); }

async function scrape(url, params = {}) {
  const qs = new URLSearchParams({ token: TOKEN, url, ...params }).toString();
  const res = await fetch(`https://api.scrape.do/?${qs}`, { signal: AbortSignal.timeout(60_000) });
  return { status: res.status, body: await res.text(), headers: Object.fromEntries(res.headers.entries()) };
}

// 1. Fetch home + sportsbook prématch en basic (1cr chacun)
console.log('[1] Home (basic)...');
const home = await scrape('https://premierbetzone.com/');
console.log(`  status=${home.status} body_len=${home.body.length}`);

console.log('[2] Sportsbook prematch (basic)...');
const sportsPre = await scrape('https://premierbetzone.com/en/sportsbook/prematch');
console.log(`  status=${sportsPre.status} body_len=${sportsPre.body.length}`);

console.log('[3] Sportsbook live (basic)...');
const sportsLive = await scrape('https://premierbetzone.com/en/sportsbook/live');
console.log(`  status=${sportsLive.status} body_len=${sportsLive.body.length}`);

// 2. Extraire URLs candidates depuis le body de chaque page
function extractApiUrls(body) {
  const urls = new Set();
  // URLs absolues et relatives
  const patterns = [
    /https?:\/\/[a-z0-9.-]*premierbet[a-z0-9.-]*\.[a-z]{2,}\/[a-zA-Z0-9._\-\/?&=]+/gi,
    /"(\/api\/[a-zA-Z0-9._\-\/?&=]+)"/g,
    /"(\/rest\/[a-zA-Z0-9._\-\/?&=]+)"/g,
    /"(\/service[a-zA-Z0-9._\-\/?&=]*)"/g,
    /"(\/sportsbook\/api\/[a-zA-Z0-9._\-\/?&=]+)"/g,
    /apiUrl\s*[:=]\s*['"]([^'"]+)['"]/gi,
    /baseUrl\s*[:=]\s*['"]([^'"]+)['"]/gi,
    /endpoint\s*[:=]\s*['"]([^'"]+)['"]/gi,
  ];
  for (const rx of patterns) {
    let m;
    while ((m = rx.exec(body)) !== null) urls.add(m[1] || m[0]);
  }
  return [...urls];
}

const apiUrls = new Set([
  ...extractApiUrls(home.body),
  ...extractApiUrls(sportsPre.body),
  ...extractApiUrls(sportsLive.body),
]);

// 3. Essayer les principaux endpoints candidats + endpoints "standard" sportsbook
const testEndpoints = [
  'https://premierbetzone.com/api/sports',
  'https://premierbetzone.com/api/v1/sports',
  'https://premierbetzone.com/api/v2/sports',
  'https://premierbetzone.com/api/prematch/events',
  'https://premierbetzone.com/api/live/events',
  'https://premierbetzone.com/api/events?sportId=1',
  'https://premierbetzone.com/rest/market/events',
  'https://premierbetzone.com/rest/market/events/bestsellers',
  'https://premierbetzone.com/sportsbook/api/sports',
  'https://premierbetzone.com/sportsbook/api/events',
  'https://premierbetzone.com/service/api/sports',
  'https://premierbetzone.com/api/getSports',
  'https://premierbetzone.com/api/getEvents',
];

const apiResults = [];
for (const u of testEndpoints.slice(0, 8)) {  // limite 8 pour ne pas cramer trop de crédits
  const r = await scrape(u);
  const short = { url: u, status: r.status, body_len: r.body.length };
  short.body_start = r.body.slice(0, 200).replace(/\s+/g, ' ');
  short.is_json = (r.headers['content-type'] || '').includes('json') || /^[\[\{]/.test(r.body.trim());
  apiResults.push(short);
}

// 4. Aussi tester l'accès à l'HTML sportsbook complet une fois pour voir les <script> qui contiennent la config
const configExtract = {
  home_scripts_urls: [...(home.body.matchAll(/<script[^>]+src=["']([^"']+)["']/g))].map((m) => m[1]).slice(0, 20),
  home_inline_apis: [...(home.body.matchAll(/(?:api|endpoint|baseUrl)['"]\s*:\s*['"]([^'"]+)['"]/gi))].map((m) => m[1]).slice(0, 10),
  discovered_urls: [...apiUrls].slice(0, 30),
};

console.log('=== DISCOVER RESULT ===');
console.log(JSON.stringify({
  page_status: { home: home.status, prematch: sportsPre.status, live: sportsLive.status },
  api_results: apiResults,
  config: configExtract,
}, null, 2));
console.log('=== END ===');
process.exit(0);
