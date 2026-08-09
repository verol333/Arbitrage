#!/usr/bin/env node
// PROBE LNBPARI/MDLR — cible platform.mdlr.tech (backend API detecte via preconnect)
//
// Plan :
//   1. Fetch HTML complet lnbpari.com pour extraire ALL URLs mdlr.tech + tokens
//   2. Test endpoints candidats sur platform.mdlr.tech
//   3. Cherche patterns Modulor typiques (JSON API type SportRadar-derive)

async function direct(url, opts = {}) {
  const { timeoutMs = 15_000, headers = {} } = opts;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120',
        Accept: 'application/json, text/html, */*',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        Origin: 'https://lnbpari.com',
        Referer: 'https://lnbpari.com/',
        ...headers,
      },
    });
    return { status: res.status, body: await res.text(), headers: Object.fromEntries(res.headers) };
  } catch (e) { return { status: 0, body: null, err: e.message }; }
}

console.log('▶ LNBPARI/MDLR DEEP PROBE\n');

// ═══ 1. Fetch HTML complet → extraction exhaustive ═══
console.log('══ 1. HTML COMPLET (extract mdlr.tech URLs + config) ══');
const html = await direct('https://lnbpari.com/');
console.log(`  status=${html.status} len=${html.body?.length || 0}`);

const mdlrUrls = new Set();
const jsBundles = new Set();
const inlineConfig = new Set();
if (html.body) {
  // Toutes les URLs mdlr.tech
  for (const m of html.body.matchAll(/https?:\/\/[^"'\s<>]*mdlr\.tech[^"'\s<>]*/gi)) mdlrUrls.add(m[0].slice(0, 200));
  // JS bundles
  for (const m of html.body.matchAll(/["'](\/(?:assets|static|js|_next)\/[^"'\s]+\.js)["']/g)) jsBundles.add(m[1]);
  for (const m of html.body.matchAll(/src=["']([^"']*\.js)["']/g)) jsBundles.add(m[1]);
  // window.__CONFIG, __NEXT_DATA__, __INITIAL_STATE__
  const nextData = html.body.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]{0,50000}?)<\/script>/);
  if (nextData) inlineConfig.add(`__NEXT_DATA__ (${nextData[1].length}B): ${nextData[1].slice(0, 2500)}`);
  const winConf = html.body.match(/window\.(?:__CONFIG|__INITIAL_STATE__|__PRELOADED_STATE__|APP_CONFIG)\s*=\s*({[\s\S]{0,10000}?})[;<]/);
  if (winConf) inlineConfig.add(`window config (${winConf[1].length}B): ${winConf[1].slice(0, 2000)}`);
  // Inline JSON avec API URLs
  const apiHosts = new Set();
  for (const m of html.body.matchAll(/["']((?:https?:)?\/\/[a-z0-9.-]*(?:api|sport|feed|odds|event|backend|prod|dev|staging|platform|mdlr)[a-z0-9.-]*(?:\.com|\.tech|\.io|\.net)[^"'\s<>]*)["']/gi)) apiHosts.add(m[1].slice(0, 200));
  for (const m of html.body.matchAll(/(?:apiUrl|apiBase|apiHost|baseUrl|host)\s*[:=]\s*["']([^"']+)["']/g)) apiHosts.add(m[1]);

  console.log(`  URLs mdlr.tech (${mdlrUrls.size}):`);
  [...mdlrUrls].slice(0, 15).forEach((u) => console.log(`    - ${u}`));
  console.log(`  JS bundles (${jsBundles.size}) sample: ${[...jsBundles].slice(0, 5).join(', ')}`);
  console.log(`  API hosts trouves (${apiHosts.size}):`);
  [...apiHosts].slice(0, 15).forEach((u) => console.log(`    - ${u}`));
  console.log(`  Inline config (${inlineConfig.size}):`);
  [...inlineConfig].forEach((c) => console.log(`    ${c}`));

  // Cherche brandId / operatorId / tokens
  const brandMatch = html.body.match(/brand(?:Id|_id)?\s*[:=]\s*["']?([a-z0-9_-]+)["']?/gi);
  if (brandMatch) console.log(`  brandIds: ${brandMatch.slice(0, 5).join(' | ')}`);
  const opMatch = html.body.match(/operator(?:Id|_id)?\s*[:=]\s*["']?([a-z0-9_-]+)["']?/gi);
  if (opMatch) console.log(`  operators: ${opMatch.slice(0, 5).join(' | ')}`);
}

// ═══ 2. Test platform.mdlr.tech endpoints ═══
console.log('\n══ 2. PLATFORM.MDLR.TECH ENDPOINTS ══');
const mdlrCandidates = [
  'https://platform.mdlr.tech/',
  'https://platform.mdlr.tech/api',
  'https://platform.mdlr.tech/api/v1/sports',
  'https://platform.mdlr.tech/api/v2/sports',
  'https://platform.mdlr.tech/api/sports',
  'https://platform.mdlr.tech/api/events',
  'https://platform.mdlr.tech/api/prematch/soccer',
  'https://platform.mdlr.tech/api/prematch',
  'https://platform.mdlr.tech/api/config',
  'https://platform.mdlr.tech/graphql',
  'https://platform.mdlr.tech/api/v1/prematch/events?sportId=1',
  // Modulor-specific guess
  'https://platform.mdlr.tech/sportsbook/api/events',
  'https://platform.mdlr.tech/sportsbook/api/prematch',
  'https://platform.mdlr.tech/api/events/prematch?sport=soccer',
];
for (const u of mdlrCandidates) {
  const r = await direct(u, { timeoutMs: 10_000 });
  const preview = r.body ? r.body.slice(0, 150).replace(/\s+/g, ' ') : '';
  console.log(`  status=${r.status} len=${r.body?.length || 0} ${u}${preview ? ' | ' + preview : ''}`);
}

// ═══ 3. Ajoute URLs decouvertes du HTML ═══
if (mdlrUrls.size) {
  console.log('\n══ 3. URLs mdlr.tech DECOUVERTES ══');
  for (const u of [...mdlrUrls].slice(0, 8)) {
    // Deviner : /api/xxx ou /v1/xxx du meme host
    const parsedUrl = new URL(u);
    const host = `${parsedUrl.protocol}//${parsedUrl.host}`;
    const extraCandidates = [
      `${host}/api/prematch/soccer`,
      `${host}/api/v1/sports`,
      `${host}/api/events`,
    ];
    for (const eu of extraCandidates) {
      const r = await direct(eu, { timeoutMs: 8_000 });
      const preview = r.body ? r.body.slice(0, 120).replace(/\s+/g, ' ') : '';
      console.log(`  status=${r.status} len=${r.body?.length || 0} ${eu.slice(-70)}${preview ? ' | ' + preview : ''}`);
    }
    break; // just first host
  }
}

console.log('\n▶ Fin.');
process.exit(0);
