// Probe : dump la shape brute d'un match live pour chaque bookmaker,
// pour identifier les champs score/minute exposés.
import { fetchJson } from '../src/net/fetcher.js';
import { swarmSession, BETMOMO_SID } from '../src/bookmakers/betmomo/api.js';

const results = {};

// 1xBet Live via CF worker.
try {
  const workerUrl = process.env.CF_WORKER_PROXY_URL || 'https://hidden-pine-7436.veolalex3.workers.dev';
  const target = 'https://1xbet.cg/service-api/LiveFeed/Get1x2_VZip?sports=1&count=3&lng=en&mode=4&country=93&partner=192&getEmpty=true';
  const j = await fetchJson(`${workerUrl}/?url=${encodeURIComponent(target)}`, {
    headers: { accept: 'application/json' }, timeoutMs: 15000,
  });
  const first = j?.Value?.find((m) => m.SC || m.MIS) || j?.Value?.[0];
  results['1xbet'] = first ? { keys: Object.keys(first), sample: JSON.parse(JSON.stringify(first)) } : { error: 'no-value' };
} catch (e) { results['1xbet'] = { error: e.message }; }

// Apollo Live
try {
  const j = await fetchJson('https://sportapis-apollo.webapis.sk/SportsOfferApi/api/sport/offer/v3/sports/offer?Offset=0&Limit=5&SportIds=388&Live=true', {
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Origin: 'https://m.apollogames.cg', Referer: 'https://m.apollogames.cg/' },
    timeoutMs: 15000,
  });
  let first;
  for (const s of j?.Response || []) for (const c of s.Categories || []) for (const l of c.Leagues || []) for (const m of l.Matches || []) { first = m; break; }
  results['apollo'] = first ? { keys: Object.keys(first), sample: first } : { error: 'no-match' };
} catch (e) { results['apollo'] = { error: e.message }; }

// 1win Live
try {
  const res = await fetch('https://api-gateway.top-parser.com/matches/get-many', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://1win.ng', Referer: 'https://1win.ng/', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({ sportId: 18, isLive: true, startAtFrom: Math.floor(Date.now()/1000)-4*3600, startAtTo: Math.floor(Date.now()/1000)+600, limit: 5, offset: 0, l: 'en-001', p: '44ba10e5-7df2-47ab-a44d-dc93803c7a6e' }),
  });
  const j = res.ok ? await res.json() : null;
  const first = j?.result?.items?.[0];
  results['1win'] = first ? { keys: Object.keys(first), sample: first } : { error: 'no-match' };
} catch (e) { results['1win'] = { error: e.message }; }

// Congobet Live
try {
  const j = await fetchJson('https://hg-event-api-prod.sporty-tech.net/api/events/sports/live?offset=0&length=5', {
    headers: { accept: 'application/json, text/plain, */*', 'accept-language': 'fr-FR,fr;q=0.9', 'user-agent': 'Mozilla/5.0', origin: 'https://www.congobet.net', referer: 'https://www.congobet.net/sports' },
    timeoutMs: 15000,
  });
  const first = Array.isArray(j) ? j[0] : j?.data?.[0];
  results['congobet'] = first ? { keys: Object.keys(first), sample: first } : { error: 'no-match' };
} catch (e) { results['congobet'] = { error: e.message }; }

// YellowBet Live (stealth)
try {
  const { stealthGetJson } = await import('../src/net/stealth.js');
  const j = await stealthGetJson('https://yellowbet.cg/services/evapi/event/GetEvents?sportIds=31&isLive=true&count=5&take=5', {
    headers: { brandid: '122', channelid: '4', language: 'fr', terminal: 'yellowbet.cg' }, timeoutMs: 15000,
  });
  const first = j?.data?.find((ev) => ev?.lv) || j?.data?.[0];
  results['yellowbet'] = first ? { keys: Object.keys(first), sample: first } : { error: 'no-match' };
} catch (e) { results['yellowbet'] = { error: e.message }; }

// Sportcash Live
try {
  const j = await fetchJson('https://sportcash.ci/XSportDatastore/getWidgetCentrali?systemCode=SPORTCASH&lingua=FR&hash=', {
    headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json, text/plain, */*', referer: 'https://sportcash.ci/' },
    timeoutMs: 15000,
  });
  const j2 = await fetchJson('https://sportcash.ci/XSportDatastore/getHomeLandingData?systemCode=SPORTCASH&lingua=FR&hash=&timezone=1', {
    headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json, text/plain, */*', referer: 'https://sportcash.ci/' },
    timeoutMs: 15000,
  });
  const lvs = j2?.lvs || j?.lvs || [];
  const first = Array.isArray(lvs) && lvs.length ? (lvs[0].avs?.[0] || lvs[0]) : null;
  results['sportcash'] = first ? { keys: Object.keys(first), sample: first } : { error: 'no-live-shape', top_j: Object.keys(j || {}), top_j2: Object.keys(j2 || {}), lvs_len: (j2?.lvs || j?.lvs || []).length };
} catch (e) { results['sportcash'] = { error: e.message }; }

// BetMomo Live via SWARM — on demande TOUS les champs plausibles
try {
  const out = await swarmSession(async (send) => {
    const listData = await send(
      { sport: ['id'], region: ['name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'is_live', 'start_ts', 'info', 'stats', 'live_events', 'markets_count', 'exclude_ids'] },
      { sport: { id: BETMOMO_SID.football }, game: { is_live: 1 } },
    );
    let first;
    for (const s of Object.values(listData?.sport || {})) {
      for (const g of Object.values(s.game || {})) { first = g; break; }
      if (!first) for (const r of Object.values(s.region || {})) {
        for (const c of Object.values(r.competition || {})) {
          for (const g of Object.values(c.game || {})) { first = g; break; }
          if (first) break;
        }
        if (first) break;
      }
      if (first) break;
    }
    return first;
  });
  results['betmomo'] = out ? { keys: Object.keys(out), sample: out } : { error: 'no-live-game' };
} catch (e) { results['betmomo'] = { error: e.message }; }

console.log('=== PROBE LIVE SCORES START ===');
console.log(JSON.stringify(results, null, 2));
console.log('=== PROBE LIVE SCORES END ===');
process.exit(0);
