// PremierBet phase 2 : analyser bestsellers en detail + trouver endpoint cotes
const TOKEN = process.env.SCRAPE_DO_KEY;
if (!TOKEN) { console.log('missing'); process.exit(1); }

async function scrape(url) {
  const qs = new URLSearchParams({ token: TOKEN, url }).toString();
  const res = await fetch(`https://api.scrape.do/?${qs}`, { signal: AbortSignal.timeout(60_000) });
  return { status: res.status, body: await res.text() };
}

// 1. Full body de bestsellers
console.log('[1] Full bestsellers JSON...');
const bs = await scrape('https://premierbetzone.com/rest/market/events/bestsellers');
let events = [];
try {
  const j = JSON.parse(bs.body);
  events = j.data || [];
} catch (e) { console.log('parse err', e.message); }
console.log(`  events: ${events.length}`);
if (events.length) {
  const e0 = events[0];
  console.log(`  sample event keys: ${Object.keys(e0).join(', ')}`);
  console.log(`  first 3 events:`);
  for (const e of events.slice(0, 3)) {
    console.log(`    ${e.eventId} | ${e.eventName} | type=${e.eventType} | cat=${e.category3Id}/${e.category2Id}/${e.category1Id || '?'}`);
  }
  // Distribution eventType et categoryX pour trouver le foot
  const types = {}; const cats = {};
  for (const e of events) {
    types[e.eventType] = (types[e.eventType] || 0) + 1;
    if (e.category1Id !== undefined) cats[`cat1=${e.category1Id}`] = (cats[`cat1=${e.category1Id}`] || 0) + 1;
  }
  console.log(`  eventType distribution: ${JSON.stringify(types)}`);
  console.log(`  category1 distribution: ${JSON.stringify(cats)}`);
}

// 2. Tester patterns endpoint cotes pour le 1er event
const testEndpoints = events.length ? [
  `https://premierbetzone.com/rest/market/event/${events[0].eventId}`,
  `https://premierbetzone.com/rest/market/events/${events[0].eventId}`,
  `https://premierbetzone.com/rest/market/event/${events[0].eventId}/markets`,
  `https://premierbetzone.com/rest/market/event/${events[0].eventId}/odds`,
  `https://premierbetzone.com/rest/market/eventOdds/${events[0].eventId}`,
  `https://premierbetzone.com/rest/market/eventDetail/${events[0].eventId}`,
  `https://premierbetzone.com/rest/market/eventMarkets/${events[0].eventId}`,
] : [];

console.log('\n[2] Test endpoints cotes...');
const results = [];
for (const u of testEndpoints) {
  const r = await scrape(u);
  const short = { url: u, status: r.status, body_len: r.body.length, sample: r.body.slice(0, 150).replace(/\s+/g, ' ') };
  results.push(short);
  console.log(`  ${r.status} ${r.body.length}B ${u}`);
}

// 3. Test aussi les endpoints de listing par sport/categorie
const listingEndpoints = [
  `https://premierbetzone.com/rest/market/events/prematch`,
  `https://premierbetzone.com/rest/market/events/live`,
  `https://premierbetzone.com/rest/market/events/sport/1`,
  `https://premierbetzone.com/rest/market/events?eventType=1`,
  `https://premierbetzone.com/rest/market/sports`,
  `https://premierbetzone.com/rest/market/categories`,
];
console.log('\n[3] Test endpoints listing...');
const listResults = [];
for (const u of listingEndpoints) {
  const r = await scrape(u);
  const short = { url: u, status: r.status, body_len: r.body.length, sample: r.body.slice(0, 200).replace(/\s+/g, ' ') };
  listResults.push(short);
  console.log(`  ${r.status} ${r.body.length}B ${u}`);
}

console.log('\n=== SUMMARY ===');
console.log(JSON.stringify({
  bestsellers_events: events.length,
  bestsellers_sample: events.slice(0, 2),
  test_odds_endpoints: results,
  test_listing_endpoints: listResults,
}, null, 2));
console.log('=== END ===');
process.exit(0);
