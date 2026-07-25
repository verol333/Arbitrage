// Enumère les sports disponibles pour chaque bookmaker afin de découvrir
// les sport IDs exacts pour basketball, ice hockey, volleyball.
import { fetchJson } from '../src/net/fetcher.js';
import { swarmSession, BETMOMO_SITE_ID } from '../src/bookmakers/betmomo/api.js';

const WORKER = process.env.CF_WORKER_PROXY_URL || 'https://hidden-pine-7436.veolalex3.workers.dev';
const results = {};

function match(name, kind) {
  const n = String(name || '').toLowerCase();
  if (kind === 'basket') return /basket|basketball/.test(n);
  if (kind === 'hockey') return /(ice.?hockey|hockey.?sur.?glace|\bhockey\b(?!.*field))/.test(n) && !/field\s*hockey|hockey.?sur.?gazon/.test(n);
  if (kind === 'volley') return /volley/.test(n) && !/beach.?volley/.test(n);
  return false;
}
const KINDS = ['basket', 'hockey', 'volley'];
function pickIds(entries, keyName = 'name', keyId = 'id') {
  const out = {};
  for (const k of KINDS) {
    const hit = entries.find((e) => match(e[keyName], k));
    if (hit) out[k] = { id: hit[keyId], name: hit[keyName] };
  }
  return out;
}

// 1xBet
try {
  const j = await fetchJson(`${WORKER}/?url=${encodeURIComponent('https://1xbet.cg/service-api/LineFeed/GetSportsShortZip?lng=en&country=93&partner=192')}`, { timeoutMs: 12000 });
  const entries = (j?.Value || []).map((s) => ({ id: s.I, name: s.EN || s.L || s.N }));
  results.xbet = { total: entries.length, matches: pickIds(entries) };
} catch (e) { results.xbet = { error: e.message }; }

// Apollo
try {
  const j = await fetchJson('https://sportapis-apollo.webapis.sk/SportsOfferApi/api/sport/offer/v3/tree/sports?Live=false', {
    headers: { Accept: 'application/json', Origin: 'https://m.apollogames.cg', Referer: 'https://m.apollogames.cg/' }, timeoutMs: 15000,
  });
  const entries = (j?.Response || []).map((s) => ({ id: s.Id, name: s.Name }));
  results.apollo = { total: entries.length, matches: pickIds(entries) };
} catch (e) { results.apollo = { error: e.message }; }

// 1win — sports lookup
try {
  const res = await fetch('https://api-gateway.top-parser.com/sports/get-many', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://1win.ng', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({ l: 'en-001', p: '44ba10e5-7df2-47ab-a44d-dc93803c7a6e' }),
  });
  const j = res.ok ? await res.json() : null;
  const entries = (j?.result?.items || []).map((s) => ({ id: s.id, name: s.name || s.slug }));
  results['1win'] = { total: entries.length, matches: pickIds(entries) };
} catch (e) { results['1win'] = { error: e.message }; }

// Congobet
try {
  const j = await fetchJson('https://hg-event-api-prod.sporty-tech.net/api/eventCategories?l=fr', {
    headers: { 'user-agent': 'Mozilla/5.0', origin: 'https://www.congobet.net', referer: 'https://www.congobet.net/sports' }, timeoutMs: 15000,
  });
  const entries = (Array.isArray(j) ? j : []).map((s) => ({ id: s.id, name: s.name }));
  results.congobet = { total: entries.length, matches: pickIds(entries) };
} catch (e) { results.congobet = { error: e.message }; }

// YellowBet — sports list via evapi
try {
  const { stealthGetJson } = await import('../src/net/stealth.js');
  const j = await stealthGetJson('https://yellowbet.cg/services/evapi/sport/GetSports', {
    headers: { brandid: '122', channelid: '4', language: 'fr', terminal: 'yellowbet.cg' }, timeoutMs: 15000,
  });
  const arr = j?.data || j?.sports || [];
  const entries = arr.map((s) => ({ id: s.id, name: s.n || s.name || s.slug }));
  results.yellowbet = { total: entries.length, matches: pickIds(entries) };
} catch (e) { results.yellowbet = { error: e.message }; }

// Sportcash
try {
  const j = await fetchJson('https://sportcash.ci/XSportDatastore/getWidgetCentrali?systemCode=SPORTCASH&lingua=FR&hash=', {
    headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://sportcash.ci/' }, timeoutMs: 15000,
  });
  const entries = [];
  // wc.lms keyed by sport ID (1=Foot etc)
  if (j?.lms) for (const [id, bucket] of Object.entries(j.lms)) {
    const nm = bucket?.nm || bucket?.d || bucket?.dsc || null;
    entries.push({ id, name: nm });
  }
  results.sportcash = { total: entries.length, matches: pickIds(entries), sample: entries.slice(0, 15) };
} catch (e) { results.sportcash = { error: e.message }; }

// BetMomo (SWARM)
try {
  const out = await swarmSession(async (send) => {
    const listData = await send({ sport: ['id', 'name', 'alias'] }, {});
    const sports = Object.values(listData?.sport || {});
    return sports.map((s) => ({ id: s.id, name: s.name || s.alias }));
  });
  results.betmomo = { total: out.length, matches: pickIds(out) };
} catch (e) { results.betmomo = { error: e.message }; }

console.log('=== SPORTS CATALOG START ===');
console.log(JSON.stringify(results, null, 2));
console.log('=== SPORTS CATALOG END ===');
process.exit(0);
