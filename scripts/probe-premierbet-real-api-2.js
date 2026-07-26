// Probe #2 : sports-api.premierbet.com via Scrape.do (direct bloque)
// Objectif : trouver endpoint listant TOUS foot events + dump featured complet
import 'dotenv/config';

const TOKEN = process.env.SCRAPE_DO_KEY || '';
if (!TOKEN) { console.error('SCRAPE_DO_KEY missing'); process.exit(1); }

async function viaScrape(url, timeoutMs = 30000) {
  const start = Date.now();
  const qs = new URLSearchParams({ token: TOKEN, url }).toString();
  try {
    const res = await fetch(`https://api.scrape.do/?${qs}`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.text();
    let json = null;
    try { json = JSON.parse(body); } catch {}
    return { url, elapsed: Date.now() - start, status: res.status, len: body.length, json, body_start: json ? null : body.slice(0, 400) };
  } catch (e) { return { url, elapsed: Date.now() - start, error: e.message }; }
}

const BASE = 'https://sports-api.premierbet.com';
const results = [];

// 1. Featured complet — combien events ? Structure ?
const featured = await viaScrape(`${BASE}/cg/v1/events/featured?country=CG&group=g5&platform=desktop&locale=fr&pageId=63fe10b530a2f04c64fbd643`);
results.push({ name: 'featured', status: featured.status, len: featured.len,
  n_events: Array.isArray(featured.json?.data) ? featured.json.data.length : (featured.json?.data?.categories?.reduce((a,c) => a + (c.competitions?.reduce((b,cp) => b + (cp.events?.length||0), 0) || 0), 0) || 0),
  first_event_markets: (featured.json?.data?.[0]?.markets?.length || featured.json?.data?.categories?.[0]?.competitions?.[0]?.events?.[0]?.markets?.length) || 0,
  data_type: Array.isArray(featured.json?.data) ? 'flat_array' : 'nested_categories',
  keys: featured.json ? Object.keys(featured.json).slice(0, 10) : null,
  sample_first_100: JSON.stringify(featured.json).slice(0, 500),
});

// 2. Endpoints candidats pour liste complete
const candidates = [
  '/cg/v1/events?country=CG&group=g5&platform=desktop&locale=fr&sportId=1',
  '/cg/v1/events?country=CG&group=g5&sportId=1',
  '/cg/v1/events/prematch?country=CG&group=g5&platform=desktop&locale=fr&sportId=1',
  '/cg/v1/events/upcoming?country=CG&group=g5&platform=desktop&locale=fr&sportId=1',
  '/cg/v1/events/all?country=CG&group=g5&platform=desktop&locale=fr&sportId=1',
  '/cg/v1/events/live?country=CG&group=g5&platform=desktop&locale=fr&sportId=1',
  '/cg/v1/events/sport/1?country=CG&group=g5&platform=desktop&locale=fr',
  '/cg/v1/sports/1/events?country=CG&group=g5&platform=desktop&locale=fr',
  '/cg/v1/sport/1?country=CG&group=g5&platform=desktop&locale=fr',
  '/cg/v1/sports?country=CG&group=g5&platform=desktop&locale=fr',
  '/cg/v1/categories?country=CG&group=g5&sportId=1&platform=desktop&locale=fr',
  '/cg/v1/competitions?country=CG&group=g5&sportId=1&platform=desktop&locale=fr',
  '/cg/v1/pages?country=CG&group=g5&platform=desktop&locale=fr',
];

for (const p of candidates) {
  const r = await viaScrape(`${BASE}${p}`);
  const events_count = Array.isArray(r.json?.data) ? r.json.data.length
    : (r.json?.data?.categories?.reduce((a,c) => a + (c.competitions?.reduce((b,cp) => b + (cp.events?.length||0), 0) || 0), 0) || 0);
  results.push({
    name: p, status: r.status, len: r.len, events_count,
    has_data: r.json && r.json.data != null,
    body_start: r.body_start || (r.json ? JSON.stringify(r.json).slice(0, 300) : null),
    error: r.error,
  });
}

// 3. CMS metadata via Scrape.do (pour voir tous les pageIds disponibles)
const cms = await viaScrape('https://cms-ui-data-prd.sahara.editec-online.com/CG/sports/sport/football/desktop/fr');
results.push({ name: 'cms metadata', status: cms.status, len: cms.len, body_start: cms.body_start || JSON.stringify(cms.json).slice(0, 800), error: cms.error });

console.log('=== RESULTS ===');
console.log(JSON.stringify(results, null, 2));
console.log('=== END ===');

// Dump full featured pour analyse structure detaillee
if (featured.json) {
  console.log('=== FEATURED FULL STRUCTURE (top-level keys + first item) ===');
  console.log('Top keys:', Object.keys(featured.json));
  if (Array.isArray(featured.json.data)) {
    console.log('First event keys:', Object.keys(featured.json.data[0] || {}));
    console.log('First event:', JSON.stringify(featured.json.data[0], null, 2).slice(0, 2500));
    console.log('Events count:', featured.json.data.length);
  } else if (featured.json.data) {
    console.log('data.keys:', Object.keys(featured.json.data));
    console.log('data sample:', JSON.stringify(featured.json.data).slice(0, 2000));
  }
}
process.exit(0);
