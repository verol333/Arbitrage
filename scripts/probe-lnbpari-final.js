#!/usr/bin/env node
// PROBE LNBPARI FINAL — test des endpoints DATA reels decouverts via performance API user.

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

async function req(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: HEADERS,
    });
    return { status: res.status, body: await res.text(), ct: res.headers.get('content-type') };
  } catch (e) { return { status: 0, body: null, err: e.message }; }
}

console.log('▶ LNBPARI FINAL PROBE\n');

const EID = '17300494';

const endpoints = [
  // 1. Content d'un event
  `/api/v0/sport/feed/localization/content/${EID}?language=fr-BENIN`,
  // 2. Recommendations tournois avec limit haut
  `/api/v1/recommendations/sport/tournaments?model=mix&stage=prematch&sports=F&use_auto_limit=true&add_pinned=true`,
  `/api/v1/recommendations/sport/tournaments?model=mix&stage=prematch&sports=F&limit_tournaments=100`,
  // 3. Recommendations events avec limit haut
  `/api/v1/recommendations/sport/events?model=mix&limit_events=200&sports=F&stage=prematch`,
  `/api/v1/recommendations/sport/events?model=mix&limit_events=500`,
  `/api/v1/recommendations/sport/events?stage=prematch&sports=F&limit_events=200`,
  // 4. Layouts config
  `/config/marketLayouts.b4db7817b31c76aab99c3002206047a6.json`,
  // 5. Competitors info
  `/api/v0/sport/competitors-info/89338/results?subsport=&locale=fr`,
  // 6. Filters marchés
  `/api/v0/sport/feed/main-markets/filters/pro_main_period`,
  `/api/v0/sport/feed/main-markets/filters/pro_current_period`,
  `/api/v0/sport/feed/main-markets/filters/extended_card`,
  // 7. Tester d'autres variantes recommendations
  `/api/v1/recommendations/sport/events?model=mix&stage=prematch&limit_events=1000&sports=F`,
  // 8. Tester endpoint eventContent
  `/api/v0/sport/event-content/${EID}`,
  `/api/v0/sport/event-content/check/map?eventId=${EID}`,
  // 9. Content deeper
  `/api/v0/sport/feed/localization/content/${EID}?language=fr-BENIN&stage=prematch`,
  `/api/v0/sport/feed/content/${EID}?language=fr-BENIN`,
  `/api/v0/sport/feed/event/${EID}?language=fr-BENIN`,
];

const results = [];
for (const p of endpoints) {
  const r = await req(`https://lnbpari.com${p}`);
  const ok = r.status === 200 && r.ct?.includes('json');
  const prev = r.body ? r.body.slice(0, 500).replace(/\s+/g, ' ') : '';
  console.log(`  [${ok ? '✅ JSON' : `⚠️ ${r.status}`}] len=${r.body?.length || 0} ${p}`);
  if (ok && r.body.length > 50) {
    results.push({ url: p, size: r.body.length, sample: r.body.slice(0, 2500) });
  }
}

// Full dump des JSON prometteurs
for (const r of results) {
  console.log(`\n═══════════════ ${r.url} (${r.size}B) ═══════════════`);
  console.log(r.sample);
}

console.log('\n▶ Fin.');
process.exit(0);
