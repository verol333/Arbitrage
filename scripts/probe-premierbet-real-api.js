// Probe v2 : sports-api.premierbet.com via Scrape.do (direct bloque 403)
// Objectif : trouver endpoint listant TOUS foot events + dump structure detaillee
const TOKEN = process.env.SCRAPE_DO_KEY || '';
if (!TOKEN) { console.error('SCRAPE_DO_KEY missing'); process.exit(1); }

async function viaScrape(url, timeoutMs = 30000) {
  const start = Date.now();
  const qs = new URLSearchParams({ token: TOKEN, url }).toString();
  try {
    const res = await fetch(`https://api.scrape.do/?${qs}`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.text();
    let json = null; try { json = JSON.parse(body); } catch {}
    return { elapsed: Date.now() - start, status: res.status, len: body.length, json, body_start: json ? null : body.slice(0, 400) };
  } catch (e) { return { elapsed: Date.now() - start, error: e.message }; }
}

function countEvents(json) {
  if (!json) return 0;
  const d = json.data;
  if (Array.isArray(d)) return d.length;
  if (d?.categories) return d.categories.reduce((a, c) => a + (c.competitions?.reduce((b, cp) => b + (cp.events?.length || 0), 0) || 0), 0);
  return 0;
}

const BASE = 'https://sports-api.premierbet.com';
const results = [];

// 1. Featured
const featured = await viaScrape(`${BASE}/cg/v1/events/featured?country=CG&group=g5&platform=desktop&locale=fr&pageId=63fe10b530a2f04c64fbd643`);
results.push({ name: 'featured', status: featured.status, len: featured.len, n_events: countEvents(featured.json), keys: featured.json ? Object.keys(featured.json) : null });

// 2. Candidats endpoints liste complete
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
  '/cg/v1/menu?country=CG&group=g5&platform=desktop&locale=fr',
  '/cg/v1/tree?country=CG&group=g5&platform=desktop&locale=fr',
  '/cg/v1/events/featured?country=CG&group=g5&platform=desktop&locale=fr',
];

for (const p of candidates) {
  const r = await viaScrape(`${BASE}${p}`);
  results.push({
    name: p, status: r.status, len: r.len, n_events: countEvents(r.json),
    body_start: r.body_start || (r.json ? JSON.stringify(r.json).slice(0, 250) : null),
    error: r.error,
  });
}

// 3. CMS metadata via Scrape.do
const cms = await viaScrape('https://cms-ui-data-prd.sahara.editec-online.com/CG/sports/sport/football/desktop/fr');
results.push({ name: 'cms metadata', status: cms.status, len: cms.len, body_start: cms.body_start || (cms.json ? JSON.stringify(cms.json).slice(0, 1500) : null), error: cms.error });

console.log('=== SUMMARY ===');
console.log(JSON.stringify(results, null, 2));

// Dump full featured structure
if (featured.json) {
  console.log('=== FEATURED DEEP DUMP ===');
  const d = featured.json.data;
  if (Array.isArray(d)) {
    console.log('data is flat array. Length:', d.length);
    console.log('First event:');
    console.log(JSON.stringify(d[0], null, 2).slice(0, 3000));
    if (d.length > 1) console.log('Second event teams:', d[1]?.eventNames);
  } else if (d?.categories) {
    console.log('data has categories. Count:', d.categories.length);
    console.log('First category:', d.categories[0]?.name, '- competitions:', d.categories[0]?.competitions?.length);
    const firstEv = d.categories[0]?.competitions?.[0]?.events?.[0];
    console.log('First event sample:');
    console.log(JSON.stringify(firstEv, null, 2).slice(0, 3000));
  } else {
    console.log('data structure unknown. keys:', Object.keys(d || {}));
    console.log(JSON.stringify(featured.json, null, 2).slice(0, 2000));
  }
}

process.exit(0);
