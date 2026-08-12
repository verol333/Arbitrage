// Probe ciblé SportyBet volleyball : tester différents pays + paramètres pour
// comprendre pourquoi on retourne 0 matchs volleyball.
import { fetchJson } from '../src/net/fetcher.js';

const BASE = 'https://www.sportybet.com';
const HDR = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en',
  'Origin': 'https://www.sportybet.com',
  'clientid': 'web',
  'operid': '2',
  'platform': 'web',
};

async function testUrl(label, url, extraHdr = {}) {
  try {
    const res = await fetch(url, {
      headers: { ...HDR, ...extraHdr },
      signal: AbortSignal.timeout(15_000),
    });
    console.log(`\n[${label}] ${res.status} ${res.statusText}`);
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.log(`  body preview: ${t.slice(0, 200)}`);
      return;
    }
    const j = await res.json();
    const tournaments = j?.data?.tournaments;
    const events = j?.data?.events;
    if (Array.isArray(tournaments)) {
      const nEvents = tournaments.reduce((s, t) => s + (t.events?.length || 0), 0);
      console.log(`  tournaments=${tournaments.length} events=${nEvents} totalNum=${j?.data?.totalNum}`);
      tournaments.slice(0, 3).forEach((t) => {
        console.log(`  · ${t.name} (${t.events?.length || 0} matchs)`);
        (t.events || []).slice(0, 2).forEach((e) => {
          console.log(`      - ${e.homeTeamName} vs ${e.awayTeamName} @ ${e.estimateStartTime ? new Date(Number(e.estimateStartTime)).toISOString() : '?'}`);
        });
      });
    } else if (Array.isArray(events)) {
      console.log(`  events=${events.length}`);
    } else {
      console.log(`  data keys: ${Object.keys(j?.data || {}).join(',')} bizCode=${j?.bizCode} message=${j?.message}`);
    }
  } catch (e) {
    console.log(`[${label}] ERR ${e.message}`);
  }
}

(async () => {
  const ts = Date.now();
  const VOL = 'sr%3Asport%3A23';
  const VMKT = '186,202,309,311,26,196,201';
  // Test 1 : Nigeria (config actuelle)
  await testUrl('NG option=1 tl=24 marketId', `${BASE}/api/ng/factsCenter/pcUpcomingEvents?sportId=${VOL}&marketId=${VMKT}&pageSize=100&pageNum=1&option=1&timeline=24&sortOption=SORT_BY_DEFAULT&_t=${ts}`,
    { 'Referer': 'https://www.sportybet.com/ng/sport/volleyball/today' });
  await testUrl('NG option=1 tl=48 marketId', `${BASE}/api/ng/factsCenter/pcUpcomingEvents?sportId=${VOL}&marketId=${VMKT}&pageSize=100&pageNum=1&option=1&timeline=48&sortOption=SORT_BY_DEFAULT&_t=${ts}`,
    { 'Referer': 'https://www.sportybet.com/ng/sport/volleyball/today' });
  await testUrl('NG option=0 no timeline no marketId', `${BASE}/api/ng/factsCenter/pcUpcomingEvents?sportId=${VOL}&pageSize=100&pageNum=1&option=0&sortOption=SORT_BY_DEFAULT&_t=${ts}`,
    { 'Referer': 'https://www.sportybet.com/ng/sport/volleyball/today' });
  await testUrl('NG option=1 no timeline no marketId', `${BASE}/api/ng/factsCenter/pcUpcomingEvents?sportId=${VOL}&pageSize=100&pageNum=1&option=1&sortOption=SORT_BY_DEFAULT&_t=${ts}`,
    { 'Referer': 'https://www.sportybet.com/ng/sport/volleyball/today' });
  // Test 2 : autres pays
  for (const country of ['ke','gh','ug','tz','za','cm']) {
    await testUrl(`${country.toUpperCase()} option=1 tl=24 marketId`, `${BASE}/api/${country}/factsCenter/pcUpcomingEvents?sportId=${VOL}&marketId=${VMKT}&pageSize=100&pageNum=1&option=1&timeline=24&sortOption=SORT_BY_DEFAULT&_t=${ts}`,
      { 'Referer': `https://www.sportybet.com/${country}/sport/volleyball/today` });
  }
  // Test 3 : sanity — football sur ng doit retourner qqch
  await testUrl('NG football sanity', `${BASE}/api/ng/factsCenter/pcUpcomingEvents?sportId=sr%3Asport%3A1&marketId=1&pageSize=10&pageNum=1&option=1&timeline=24&sortOption=SORT_BY_DEFAULT&_t=${ts}`,
    { 'Referer': 'https://www.sportybet.com/ng/sport/football/today' });
  process.exit(0);
})();
