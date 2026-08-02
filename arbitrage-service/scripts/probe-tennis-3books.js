// Probe sport IDs tennis pour premierbet + betpawa + sportybet.
// Teste plusieurs IDs candidats et affiche le nombre d'events retournés.

const results = [];
const log = (m) => console.log(m);

// ─── SPORTYBET ────────────────────────────────────────────────────────────
// Format sr:sport:X (BetRadar). Foot = sr:sport:1. Tennis attendu = sr:sport:5.
async function probeSportybet() {
  const HDR = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    'Accept': '*/*', 'Accept-Language': 'en',
    'Referer': 'https://www.sportybet.com/ng/sport/football/today',
    'Origin': 'https://www.sportybet.com',
    'Cookie': 'locale=en; device-id=b0671631-24f3-4e60-a281-117254ea1551; sb_country=ng',
    'clientid': 'web', 'operid': '2', 'platform': 'web',
  };
  log('\n=== SPORTYBET (format sr:sport:X) ===');
  for (const id of [1, 2, 3, 4, 5, 6, 20, 34]) {
    try {
      const url = `https://www.sportybet.com/api/ng/factsCenter/liveOrPrematchEvents?sportId=sr%3Asport%3A${id}&_t=${Date.now()}`;
      const res = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(10_000) });
      const txt = await res.text();
      let count = 0, sample = '';
      try {
        const j = JSON.parse(txt);
        for (const t of j?.data || []) count += (t?.events?.length || 0);
        const ev = j?.data?.[0]?.events?.[0];
        if (ev) sample = `${ev.homeTeamName || '?'} vs ${ev.awayTeamName || '?'}`;
      } catch {}
      log(`  sr:sport:${id} → status=${res.status} events=${count} sample="${sample}"`);
    } catch (e) { log(`  sr:sport:${id} → ERR ${e.message}`); }
  }
}

// ─── BETPAWA ──────────────────────────────────────────────────────────────
// Format categoryId=X. Foot = 2. Tennis à trouver.
// Endpoint: /api/sportsbook/v4/events/lists/by-queries?q={categoryId:X, hasOdds:true, marketId:"1X2"}
async function probeBetpawa() {
  const HDR = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    'Accept': '*/*', 'Accept-Language': 'en',
    'Referer': 'https://cg.betpawa.com/events',
    'Origin': 'https://cg.betpawa.com',
    'X-Pawa-Language': 'en',
    'X-Pawa-Brand': 'betpawa-congo-brazzaville',
  };
  log('\n=== BETPAWA (format categoryId=X) ===');
  for (const id of [1, 2, 3, 4, 5, 6, 10, 20]) {
    try {
      const q = [{ eventType: 'PREMATCH', categoryId: String(id), hasOdds: true, take: 3, skip: 0 }];
      const url = `https://cg.betpawa.com/api/sportsbook/v4/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`;
      const res = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(10_000) });
      const txt = await res.text();
      let count = 0, sample = '', catName = '';
      try {
        const j = JSON.parse(txt);
        const events = j?.responses?.[0]?.responses || j?.[0]?.responses || [];
        count = events.length;
        if (events[0]) {
          const p = events[0].event?.participants || [];
          sample = p.length >= 2 ? `${p[0].name} vs ${p[1].name}` : JSON.stringify(events[0]?.event).slice(0, 80);
          catName = events[0].event?.category?.name || events[0].event?.competition?.category?.name || '';
        }
      } catch {}
      log(`  categoryId=${id} → status=${res.status} events=${count} cat="${catName}" sample="${sample}"`);
    } catch (e) { log(`  categoryId=${id} → ERR ${e.message}`); }
  }
}

// ─── PREMIERBET (sports-api.guineegames.com) ─────────────────────────────
// Format sportId=X. Foot = 1. Tennis à trouver. Test /events/upcoming.
async function probePremierbet() {
  const KEY = process.env.SCRAPE_DO_KEY || '';
  const HDR = { 'User-Agent': 'Mozilla/5.0 Chrome/151.0.0.0' };
  log('\n=== PREMIERBET (sports-api.guineegames.com, sportId=X) ===');
  for (const id of [1, 2, 3, 4, 5, 6, 10]) {
    try {
      const inner = `https://sports-api.guineegames.com/v1/events/upcoming?sportId=${id}&timeOffset=-60&date=${new Date().toISOString().slice(0,10)}`;
      const url = KEY
        ? `http://api.scrape.do/?token=${KEY}&url=${encodeURIComponent(inner)}`
        : inner;
      const res = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(20_000) });
      const txt = await res.text();
      let count = 0, sample = '', sportName = '';
      try {
        const j = JSON.parse(txt);
        const events = j?.data?.events || j?.events || (Array.isArray(j?.data) ? j.data : []);
        count = events.length;
        if (events[0]) {
          sample = events[0].name || `${events[0]?.competitors?.[0]?.name || '?'} vs ${events[0]?.competitors?.[1]?.name || '?'}`;
          sportName = events[0].sport?.name || events[0].sportName || '';
        }
      } catch {}
      log(`  sportId=${id} → status=${res.status} events=${count} sport="${sportName}" sample="${sample.slice(0, 60)}"`);
    } catch (e) { log(`  sportId=${id} → ERR ${e.message}`); }
  }
}

await probeSportybet();
await probeBetpawa();
await probePremierbet();
log('\nDONE');
