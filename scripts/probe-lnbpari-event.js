#!/usr/bin/env node
// PROBE LNBPARI EVENT — teste avec vrai eventId 17300494 (Plymouth-Exeter City)
// capture par l'user via URL /fr/events/plymouth-exeter-city-17300494

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  Origin: 'https://lnbpari.com',
  Referer: 'https://lnbpari.com/fr/events/plymouth-exeter-city-17300494',
  'x-api-key': '9ba6608f-c15b-4d37-83e8-bb89aa22d2e7',
  'x-application-id': '0e4a4d8d-46a5-483e-ba1c-893d909244ee',
  'x-clientid': '96e7561d00e40561a556b6835b807738',
  'x-teamname': 'Sport Widgets Tech',
  'x-place': 'betslip-widget',
  'x-language': 'fr',
  'x-channel': 'MOBILE_WEB',
  'x-platform': 'web-mobile',
  'x-betsterversion': '2.4.0',
  'x-betster-team-consumer': 'Sport Widgets Tech',
  'x-extensionname': 'sportsApi',
  'x-extensionversion': '1.39.0',
};

async function req(url, opts = {}) {
  const { timeoutMs = 10_000 } = opts;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: HEADERS,
    });
    return { status: res.status, body: await res.text(), ct: res.headers.get('content-type') };
  } catch (e) { return { status: 0, body: null, err: e.message }; }
}

function classify(r) {
  if (!r.body && r.status !== 204) return 'ERR';
  if (r.body?.length >= 242000 && r.body?.length < 243000) return 'SHELL';
  if (r.body === '404 page not found' || r.body === '404 page not found\n') return 'NF';
  if (r.status === 204) return '204';
  if (r.status === 401) return 'AUTH';
  if (r.status === 405) return 'MBAD';
  if (r.ct?.includes('json')) return 'JSON';
  return `${r.status}`;
}

console.log('▶ LNBPARI EVENT PROBE (eventId=17300494)\n');

const EID = '17300494';
const SLUG = 'plymouth-exeter-city-17300494';

// ═══ 1. Patterns /apg/v0/sport/* ═══
console.log('══ 1. /apg/v0/sport/* ══');
const paths = [
  // Sport tools revealed by user's F12 (all under /apg/v0/sport/)
  `/apg/v0/sport/events/${EID}`,
  `/apg/v0/sport/event/${EID}`,
  `/apg/v0/sport/prematch/event/${EID}`,
  `/apg/v0/sport/prematch/events/${EID}`,
  `/apg/v0/sport/event/${EID}/odds`,
  `/apg/v0/sport/event/${EID}/markets`,
  `/apg/v0/sport/event/${SLUG}`,
  `/apg/v0/sport/events/${SLUG}`,
  // Match variant
  `/apg/v0/sport/match/${EID}`,
  `/apg/v0/sport/matches/${EID}`,
  // Tournament/List variants
  `/apg/v0/sport/tournaments`,
  `/apg/v0/sport/tournaments?sportId=F`,
  `/apg/v0/sport/sports`,
  `/apg/v0/sport/prematch`,
  `/apg/v0/sport/prematch/tournaments`,
  `/apg/v0/sport/prematch/events`,
  `/apg/v0/sport/prematch/events?sport=F`,
  `/apg/v0/sport/prematch/events?sportId=F`,
  `/apg/v0/sport/live/events`,
  // Feed variants (already found /api/v0/sport/feed/localization/markets works)
  `/api/v0/sport/feed/events/${EID}`,
  `/api/v0/sport/feed/event/${EID}`,
  `/api/v0/sport/feed/prematch/events/${EID}`,
  `/api/v0/sport/feed/prematch/events?sport=F`,
  `/api/v0/sport/feed/tournaments?sport=F&stage=1&language=fr-BENIN`,
  `/api/v0/sport/feed/events?sport=F&stage=1&language=fr-BENIN`,
  `/api/v0/sport/feed/prematch?sport=F&language=fr-BENIN`,
  // Widgets pattern found earlier
  `/apg/v0/widgets/v0/event/${EID}`,
  `/apg/v0/widgets/v0/events/${EID}`,
  `/apg/v0/widgets/v0/sportsbook/event/${EID}`,
];

const jsonHits = [];
for (const p of paths) {
  const r = await req(`https://lnbpari.com${p}`);
  const cls = classify(r);
  if (cls === 'SHELL' || cls === 'NF' || cls === 'ERR') continue;
  const prev = r.body ? r.body.slice(0, 200).replace(/\s+/g, ' ') : '';
  console.log(`  [${cls}] status=${r.status} len=${r.body?.length || 0} ${p}${prev ? ' | ' + prev : ''}`);
  if (cls === 'JSON' && r.body.length > 3) jsonHits.push({ p, len: r.body.length, sample: r.body.slice(0, 800) });
}

// ═══ 2. Test tournaments/sports listing (sans eventId) ═══
console.log('\n══ 2. LIST ENDPOINTS ══');
const listPaths = [
  `/apg/v0/sport/prematch/tournaments?sport=F`,
  `/apg/v0/sport/tournaments?sport=F&stage=1`,
  `/apg/v0/sport/prematch/tournaments/F`,
  `/apg/v0/sport/prematch/F`,
  `/apg/v0/sport/prematch/F/tournaments`,
  `/apg/v0/sport/prematch/F/events`,
  `/apg/v0/sport/F/prematch`,
  `/apg/v0/sport/F/prematch/tournaments`,
  `/apg/v0/sport/F/prematch/events`,
  `/api/v0/sport/feed/localization/sports?stage=1&language=fr-BENIN`,
  `/api/v0/sport/feed/localization/tournaments?sport=F&stage=1&language=fr-BENIN`,
  `/api/v0/sport/feed/data/prematch?sport=F&stage=1&language=fr-BENIN`,
];
for (const p of listPaths) {
  const r = await req(`https://lnbpari.com${p}`);
  const cls = classify(r);
  if (cls === 'SHELL' || cls === 'NF' || cls === 'ERR') continue;
  const prev = r.body ? r.body.slice(0, 200).replace(/\s+/g, ' ') : '';
  console.log(`  [${cls}] status=${r.status} len=${r.body?.length || 0} ${p}${prev ? ' | ' + prev : ''}`);
  if (cls === 'JSON' && r.body.length > 3) jsonHits.push({ p, len: r.body.length, sample: r.body.slice(0, 800) });
}

// Recap
console.log(`\n══ JSON HITS (${jsonHits.length}) ══`);
for (const h of jsonHits.slice(0, 10)) {
  console.log(`\n  ▸ ${h.p} → ${h.len}B`);
  console.log(`    ${h.sample}`);
}

console.log('\n▶ Fin.');
process.exit(0);
