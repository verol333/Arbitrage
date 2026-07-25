// Probe v2 : dump la liste complète des sports par bookmaker.
import { fetchJson } from '../src/net/fetcher.js';
import { swarmSession } from '../src/bookmakers/betmomo/api.js';

const WORKER = process.env.CF_WORKER_PROXY_URL || 'https://hidden-pine-7436.veolalex3.workers.dev';
const results = {};

// 1xBet — GetSports (pas GetSportsShort, dépréciée)
try {
  const urls = [
    'https://1xbet.cg/service-api/LineFeed/GetSportsZip?lng=en&country=93&partner=192',
    'https://1xbet.cg/service-api/LineFeed/GetSportsShortZip?lng=en&country=93&partner=192',
    'https://1xbet.cg/service-api/LiveFeed/Get1x2_VZip?count=1&lng=en&country=93&partner=192',
  ];
  let entries = [];
  for (const u of urls) {
    const j = await fetchJson(`${WORKER}/?url=${encodeURIComponent(u)}`, { timeoutMs: 12000 });
    if (Array.isArray(j?.Value)) entries = j.Value.slice(0, 60).map((s) => ({ id: s.I ?? s.SI, name: s.EN || s.L || s.N || s.LE }));
    if (entries.length) break;
  }
  results.xbet = entries;
} catch (e) { results.xbet = { error: e.message }; }

// Apollo — vrai endpoint sports/list
try {
  const paths = [
    '/sport/offer/v3/sports',
    '/sport/offer/v3/tree',
    '/sport/offer/v3/sports/tree',
  ];
  let entries = [];
  for (const p of paths) {
    const j = await fetchJson('https://sportapis-apollo.webapis.sk/SportsOfferApi/api' + p, {
      headers: { Accept: 'application/json', Origin: 'https://m.apollogames.cg', Referer: 'https://m.apollogames.cg/' }, timeoutMs: 15000,
    });
    const arr = j?.Response || j?.Sports || (Array.isArray(j) ? j : []);
    if (arr.length) { entries = arr.slice(0, 60).map((s) => ({ id: s.Id ?? s.SportId, name: s.Name ?? s.SportName })); break; }
  }
  results.apollo = entries;
} catch (e) { results.apollo = { error: e.message }; }

// 1win
try {
  const res = await fetch('https://api-gateway.top-parser.com/sports/get-many', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://1win.ng', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({ l: 'en-001', p: '44ba10e5-7df2-47ab-a44d-dc93803c7a6e' }),
  });
  const j = res.ok ? await res.json() : null;
  results['1win'] = (j?.result?.items || []).slice(0, 60).map((s) => ({ id: s.id, name: s.name || s.slug || s.tag }));
} catch (e) { results['1win'] = { error: e.message }; }

// Congobet — deep dump
try {
  const paths = [
    'sports?l=fr',
    'sports/list?l=fr',
    'eventCategories?l=fr',
    'sports/summary?l=fr',
  ];
  let entries = [];
  for (const p of paths) {
    const j = await fetchJson('https://hg-event-api-prod.sporty-tech.net/api/' + p, {
      headers: { 'user-agent': 'Mozilla/5.0', origin: 'https://www.congobet.net', referer: 'https://www.congobet.net/sports' }, timeoutMs: 15000,
    });
    const arr = Array.isArray(j) ? j : (j?.data || j?.sports || []);
    if (arr.length) { entries = arr.slice(0, 60).map((s) => ({ id: s.id, name: s.name || s.categoryPath })); break; }
  }
  results.congobet = entries;
} catch (e) { results.congobet = { error: e.message }; }

// YellowBet — via evapi/event/GetEvents et regrouper par sid
try {
  const { stealthGetJson } = await import('../src/net/stealth.js');
  // Essayer d'énumérer les sports via GetSports variants
  const urls = [
    'https://yellowbet.cg/services/evapi/sport/getSportsMenu',
    'https://yellowbet.cg/services/evapi/sport/GetSportsMenu',
    'https://yellowbet.cg/services/evapi/sports/GetSportsMenu',
    'https://yellowbet.cg/services/evapi/menu/GetSportsMenu',
    'https://yellowbet.cg/services/evapi/event/GetSports',
  ];
  let entries = [];
  for (const u of urls) {
    const j = await stealthGetJson(u, { headers: { brandid: '122', channelid: '4', language: 'fr', terminal: 'yellowbet.cg' }, timeoutMs: 12000 });
    const arr = j?.data || j?.items || j?.sports || (Array.isArray(j) ? j : []);
    if (arr.length) { entries = arr.slice(0, 60).map((s) => ({ id: s.id ?? s.sid, name: s.n || s.name || s.sn })); break; }
  }
  // Fallback : requête events avec chaque sportIds 1..70 pour voir lequel renvoie du contenu
  if (!entries.length) {
    for (const sid of [1, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 18, 23, 31, 43, 53, 67]) {
      const j = await stealthGetJson(`https://yellowbet.cg/services/evapi/event/GetEvents?sportIds=${sid}&count=1&take=1`, {
        headers: { brandid: '122', channelid: '4', language: 'fr', terminal: 'yellowbet.cg' }, timeoutMs: 8000,
      });
      const ev = j?.data?.[0];
      if (ev) entries.push({ id: sid, name: ev.sn || ev.spn || '?', sample_team: ev.h + ' vs ' + ev.a });
    }
  }
  results.yellowbet = entries;
} catch (e) { results.yellowbet = { error: e.message }; }

// Sportcash — dump wc.lms KEYED par sport ID, extraire les avs[].ds pour trouver noms
try {
  const j = await fetchJson('https://sportcash.ci/XSportDatastore/getWidgetCentrali?systemCode=SPORTCASH&lingua=FR&hash=', {
    headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://sportcash.ci/' }, timeoutMs: 15000,
  });
  const entries = [];
  if (j?.lms) for (const [sid, bucket] of Object.entries(j.lms)) {
    // ds = disport (sport display), take from first event
    const first = bucket?.avs?.[0] || bucket?.tms?.[0] || null;
    entries.push({ id: sid, name: first?.ds || bucket?.d || bucket?.dsc || '?', n_events: (bucket?.avs || []).length });
  }
  results.sportcash = entries;
} catch (e) { results.sportcash = { error: e.message }; }

// BetMomo — déjà validé mais on redonne pour confirmation
try {
  const out = await swarmSession(async (send) => {
    const listData = await send({ sport: ['id', 'name', 'alias'] }, {});
    return Object.values(listData?.sport || {}).map((s) => ({ id: s.id, name: s.name || s.alias }));
  });
  results.betmomo = out;
} catch (e) { results.betmomo = { error: e.message }; }

console.log('=== SPORTS DUMP START ===');
console.log(JSON.stringify(results, null, 2));
console.log('=== SPORTS DUMP END ===');
process.exit(0);
