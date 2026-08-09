#!/usr/bin/env node
// PROBE MIRRORS — cherche les bookmakers qui partagent le backend Betster/Modulor de lnbpari.
// Test aussi les endpoints HTTP manquants + extrait URLs du bundle transport.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

async function req(url, opts = {}) {
  const { timeoutMs = 12_000, headers = {} } = opts;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
    });
    return { status: res.status, body: await res.text(), ct: res.headers.get('content-type') };
  } catch (e) { return { status: 0, body: null, err: e.message }; }
}

// ═════ 1. Confirme lonabet.bf backend ═════
console.log('══ 1. LONABET.BF DISCOVERY ══');
const lona = await req('https://m.lonabet.bf/');
console.log(`  Home: status=${lona.status} len=${lona.body?.length || 0}`);
if (lona.body) {
  const scripts = [...lona.body.matchAll(/["']([^"']*\.js)["']/g)].map((m) => m[1]).slice(0, 15);
  console.log(`  Scripts (${scripts.length}): ${scripts.slice(0, 5).join(', ')}`);
  const apiRefs = [...lona.body.matchAll(/["'](https?:\/\/[a-z0-9.-]+(?:api|feed|sport|odds)[a-z0-9.-]*\.[a-z]{2,4})/gi)]
    .map((m) => m[1]).filter((u, i, a) => a.indexOf(u) === i).slice(0, 10);
  console.log(`  API hosts: ${apiRefs.join(' | ')}`);
  const providers = ['betster', 'modulor', 'mdlr', 'betlab', 'apollo', 'RCS', 'sports-api', 'sportbook', 'widget', 'iolite'];
  for (const p of providers) if (lona.body.toLowerCase().includes(p)) console.log(`  ⚡ mention: ${p}`);
}

// ═════ 2. Bookmakers Betster candidats — chercher x-teamname pattern ═════
console.log('\n══ 2. CANDIDATS BETSTER (10 books) ══');
const candidates = [
  'https://star2000.bj/',
  'https://www.betpari.com/',
  'https://sunubet.sn/',
  'https://www.betwinner.com/fr',
  'https://1xbet.bj/fr',
  'https://premierbet.bj/',
  'https://parionsport.ci/',
  'https://www.betka.bj/',
  'https://www.pmubetting.com/',
  'https://ubet.bj/',
];
for (const url of candidates) {
  const r = await req(url);
  if (r.status === 0 || r.status >= 400) { console.log(`  [${r.status || 'ERR'}] ${url} ${r.err || ''}`); continue; }
  const isBetster = r.body?.includes('Sport Widgets Tech') || r.body?.includes('betster') || r.body?.includes('/api/v0/sport/feed/');
  const hasMdlr = r.body?.includes('mdlr.tech') || r.body?.includes('modulor');
  const hasBetlab = r.body?.includes('betlab');
  console.log(`  [${r.status}] ${url} len=${r.body?.length || 0} betster=${isBetster?'✅':'❌'} mdlr=${hasMdlr?'✅':'❌'} betlab=${hasBetlab?'✅':'❌'}`);
  if (isBetster || hasMdlr || hasBetlab) {
    const hosts = [...(r.body?.matchAll(/["'](https?:\/\/[a-z0-9.-]+\.(?:com|tech|net|io|bj|sn|ci|bf))["']/g) || [])]
      .map((m) => m[1]).filter((u) => /api|feed|sport|widget|mdlr|betster/i.test(u)).filter((u, i, a) => a.indexOf(u) === i).slice(0, 8);
    console.log(`      → hosts intéressants: ${hosts.join(' | ')}`);
  }
}

// ═════ 3. Fetch betbook-transport.js et extraire URLs ═════
console.log('\n══ 3. BETBOOK-TRANSPORT BUNDLE ══');
const tries = [
  'https://lnbpari.com/@sport/betbook-transport.js',
  'https://lnbpari.com/betbook-transport.js',
  'https://lnbpari.com/assets/betbook-transport.js',
];
let bundle = null;
for (const u of tries) {
  const r = await req(u);
  console.log(`  ${u} → status=${r.status} len=${r.body?.length || 0}`);
  if (r.status === 200 && r.body?.length > 5000) { bundle = r.body; break; }
}
if (bundle) {
  // Extraire ws/wss URLs + patterns HTTP
  const ws = [...bundle.matchAll(/["'`](wss?:\/\/[^"'`]{4,200})["'`]/g)].map((m) => m[1]).filter((u, i, a) => a.indexOf(u) === i);
  const httpUrls = [...bundle.matchAll(/["'`](\/api\/v\d+\/[^"'`]{2,150})["'`]/g)].map((m) => m[1]).filter((u, i, a) => a.indexOf(u) === i);
  const templates = [...bundle.matchAll(/`(\/api\/v\d+\/[^`]{2,150})`/g)].map((m) => m[1].replace(/\$\{[^}]+\}/g, ':param')).filter((u, i, a) => a.indexOf(u) === i);
  const paths = [...bundle.matchAll(/["'`](\/(?:sport|feed|odds|prices|markets)\/[^"'`]{2,100})["'`]/g)].map((m) => m[1]).filter((u, i, a) => a.indexOf(u) === i);
  console.log(`\n  WS URLs (${ws.length}):`);
  ws.forEach((u) => console.log(`    - ${u}`));
  console.log(`\n  HTTP /api/vN/ paths (${httpUrls.length}):`);
  httpUrls.slice(0, 30).forEach((u) => console.log(`    - ${u}`));
  console.log(`\n  Template literals (${templates.length}):`);
  templates.slice(0, 30).forEach((u) => console.log(`    - ${u}`));
  console.log(`\n  Autres paths sport/feed/odds (${paths.length}):`);
  paths.slice(0, 20).forEach((u) => console.log(`    - ${u}`));
}

// ═════ 4. Test endpoints HTTP additionnels sur lnbpari (les qu'on n'a pas testé) ═════
console.log('\n══ 4. LNBPARI — endpoints HTTP additionnels ══');
const HEADERS = {
  'User-Agent': UA,
  Accept: 'application/json',
  Origin: 'https://lnbpari.com',
  Referer: 'https://lnbpari.com/fr',
  'x-api-key': '9ba6608f-c15b-4d37-83e8-bb89aa22d2e7',
  'x-application-id': '0e4a4d8d-46a5-483e-ba1c-893d909244ee',
  'x-language': 'fr',
  'x-channel': 'MOBILE_WEB',
};
const EID = '17300494';
const missing = [
  `/api/v0/sport/feed/localization/markets/${EID}?language=fr-BENIN`,
  `/api/v0/sport/feed/markets/${EID}`,
  `/api/v0/sport/feed/prices/${EID}`,
  `/api/v0/sport/feed/odds/${EID}`,
  `/api/v0/sport/feed/data/${EID}`,
  `/api/v0/sport/feed/main-markets/${EID}`,
  `/api/v0/sport/feed/main-markets/${EID}?language=fr-BENIN`,
  `/api/v0/sport/feed/prematch/markets/${EID}`,
  `/api/v0/sport/feed/prematch/${EID}`,
  `/api/v0/sport/feed/events/${EID}?language=fr-BENIN`,
  `/api/v0/sport/feed/events/${EID}/markets`,
  `/api/v0/sport/feed/events/${EID}/prices`,
  `/api/v0/sport/feed/tournaments/99b4b490e92048d297aa15ddba5cf474/events`,
  `/api/v0/sport/feed/tournaments/99b4b490e92048d297aa15ddba5cf474/markets`,
  `/api/v0/sport/feed/localization/tournaments/99b4b490e92048d297aa15ddba5cf474?language=fr-BENIN`,
];
for (const p of missing) {
  const r = await req(`https://lnbpari.com${p}`, { headers: HEADERS });
  const cls = r.status === 200 && r.ct?.includes('json') ? '✅ JSON' : `⚠️ ${r.status}`;
  console.log(`  [${cls}] len=${r.body?.length || 0} ${p}`);
  if (r.status === 200 && r.body?.length > 100 && r.body.length < 5000) console.log(`      ${r.body.slice(0, 400).replace(/\s+/g, ' ')}`);
}

console.log('\n▶ Fin.');
process.exit(0);
