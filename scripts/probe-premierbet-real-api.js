// Probe v3 : sports-api.premierbet.com via Scrape.do — PARALLELE + logs progressifs
const TOKEN = process.env.SCRAPE_DO_KEY || '';
if (!TOKEN) { console.error('SCRAPE_DO_KEY missing'); process.exit(1); }

async function viaScrape(url, timeoutMs = 20000) {
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
  if (d?.events && Array.isArray(d.events)) return d.events.length;
  return 0;
}

const BASE = 'https://sports-api.premierbet.com';

const endpoints = [
  { name: 'featured', url: `${BASE}/cg/v1/events/featured?country=CG&group=g5&platform=desktop&locale=fr&pageId=63fe10b530a2f04c64fbd643` },
  { name: 'featured-nopageId', url: `${BASE}/cg/v1/events/featured?country=CG&group=g5&platform=desktop&locale=fr` },
  { name: 'events-sportId1', url: `${BASE}/cg/v1/events?country=CG&group=g5&platform=desktop&locale=fr&sportId=1` },
  { name: 'events-prematch', url: `${BASE}/cg/v1/events/prematch?country=CG&group=g5&platform=desktop&locale=fr&sportId=1` },
  { name: 'events-upcoming', url: `${BASE}/cg/v1/events/upcoming?country=CG&group=g5&platform=desktop&locale=fr&sportId=1` },
  { name: 'events-all', url: `${BASE}/cg/v1/events/all?country=CG&group=g5&platform=desktop&locale=fr&sportId=1` },
  { name: 'events-live', url: `${BASE}/cg/v1/events/live?country=CG&group=g5&platform=desktop&locale=fr&sportId=1` },
  { name: 'sport1-events', url: `${BASE}/cg/v1/sports/1/events?country=CG&group=g5&platform=desktop&locale=fr` },
  { name: 'sports-list', url: `${BASE}/cg/v1/sports?country=CG&group=g5&platform=desktop&locale=fr` },
  { name: 'categories', url: `${BASE}/cg/v1/categories?country=CG&group=g5&sportId=1&platform=desktop&locale=fr` },
  { name: 'competitions', url: `${BASE}/cg/v1/competitions?country=CG&group=g5&sportId=1&platform=desktop&locale=fr` },
  { name: 'pages', url: `${BASE}/cg/v1/pages?country=CG&group=g5&platform=desktop&locale=fr` },
  { name: 'menu', url: `${BASE}/cg/v1/menu?country=CG&group=g5&platform=desktop&locale=fr` },
  { name: 'cms-metadata', url: 'https://cms-ui-data-prd.sahara.editec-online.com/CG/sports/sport/football/desktop/fr' },
  { name: 'cms-root', url: 'https://cms-ui-data-prd.sahara.editec-online.com/CG/sports/sport' },
];

console.log(`Firing ${endpoints.length} parallel requests...`);
const t0 = Date.now();

const results = await Promise.all(endpoints.map(async (ep) => {
  const r = await viaScrape(ep.url);
  const ne = countEvents(r.json);
  console.log(`  [${(Date.now()-t0)/1000|0}s] ${ep.name}: status=${r.status||'ERR'} len=${r.len||0} events=${ne} ${r.error?'err='+r.error:''}`);
  return { ...ep, ...r, events_count: ne, json: undefined };
}));

console.log(`\nAll done in ${(Date.now()-t0)/1000|0}s\n`);

// Re-fetch endpoints avec events > 0 pour dumper structure
const promising = results.filter((r) => r.events_count > 0 || (r.status === 200 && r.len > 500));
console.log(`\n=== PROMISING ENDPOINTS (events>0 or 200+data): ${promising.length} ===`);
for (const p of promising) console.log(`  ${p.name}: events=${p.events_count} len=${p.len}`);

// Dump structure du meilleur
const best = [...results].filter((r) => r.status === 200).sort((a, b) => b.events_count - a.events_count)[0];
if (best) {
  console.log(`\n=== DEEP DUMP: ${best.name} (events=${best.events_count}) ===`);
  const r = await viaScrape(best.url);
  if (r.json) {
    console.log('Top keys:', Object.keys(r.json));
    if (r.json.data) {
      if (Array.isArray(r.json.data)) {
        console.log(`data flat array, len=${r.json.data.length}`);
        console.log('First event:', JSON.stringify(r.json.data[0], null, 2).slice(0, 3500));
      } else if (r.json.data.categories) {
        console.log(`data.categories.len=${r.json.data.categories.length}`);
        r.json.data.categories.forEach((c, i) => {
          const evs = c.competitions?.reduce((a, cp) => a + (cp.events?.length || 0), 0) || 0;
          if (i < 5) console.log(`  cat[${i}] "${c.name}" comps=${c.competitions?.length} events=${evs}`);
        });
        const firstEv = r.json.data.categories[0]?.competitions?.[0]?.events?.[0];
        console.log('First event:', JSON.stringify(firstEv, null, 2).slice(0, 3500));
      } else {
        console.log('data keys:', Object.keys(r.json.data));
        console.log(JSON.stringify(r.json.data, null, 2).slice(0, 3500));
      }
    }
  } else {
    console.log('body_start:', r.body_start?.slice(0, 1000));
  }
}

// Résumé JSON compact
console.log('\n=== SUMMARY JSON ===');
console.log(JSON.stringify(results.map((r) => ({ name: r.name, status: r.status, len: r.len, events: r.events_count, elapsed: r.elapsed, error: r.error })), null, 2));

process.exit(0);
