// Découvre le vrai sport ID "Tennis" pour chaque bookmaker en listant tous
// les sports connus (id + nom) via l'API de chacun.

import { viaWorker as xviaWorker, FEED as XFEED, COUNTRY as XCOUNTRY, PARTNER as XPARTNER } from '../../src/bookmakers/xbet/api.js';
import { xget as scget } from '../../src/bookmakers/sportcash/api.js';
import { evapi as ybevapi, BASE_URL as YBBASE } from '../../src/bookmakers/yellowbet/api.js';
import { apolloGet } from '../../src/bookmakers/apollo/api.js';
import { swarmSession } from '../../src/bookmakers/betmomo/api.js';
import { CONGO_API, congoJson } from '../../src/bookmakers/congobet/api.js';
import { API_BASE as WINBASE, ORIGIN as WINORIG, UA as WINUA, PLATFORM as WINPL } from '../../src/bookmakers/onewin/api.js';

async function xbetSports() {
  // 1xBet : GetSportsShortZip liste les sports.
  const r = await xviaWorker(`${XFEED}/service-api/LineFeed/GetSportsShortZip?lng=en&country=${XCOUNTRY}&partner=${XPARTNER}`);
  return (r?.Value || []).map((s) => ({ id: s.I || s.id, name: s.E || s.name || s.N }));
}

async function onewinSports() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(`${WINBASE}/sports/get-many`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: WINORIG, Referer: `${WINORIG}/`, 'User-Agent': WINUA },
      body: JSON.stringify({ l: 'en-001', p: WINPL, limit: 100 }),
      signal: ctrl.signal,
    });
    const data = await res.json();
    return (data?.result?.items || []).map((s) => ({ id: s.id, name: s.name, slug: s.slug }));
  } finally { clearTimeout(t); }
}

async function congobetSports() {
  const r = await congoJson(`${CONGO_API}sportCategories?l=fr`);
  return (Array.isArray(r) ? r : []).map((c) => ({ id: c.id, name: c.name }));
}

async function yellowbetSports() {
  // BetConstruct evapi has getSports or getMenu.
  try {
    const r = await ybevapi(`${YBBASE}/main/GetSports`);
    return (r?.data || r || []).map((s) => ({ id: s.id ?? s.sid, name: s.name ?? s.n }));
  } catch (e) { return { error: e.message }; }
}

async function apolloSports() {
  const j = await apolloGet('/sport/offer/v3/sports');
  const list = j?.Response || j?.Sports || j || [];
  return (Array.isArray(list) ? list : []).slice(0, 100).map((s) => ({ id: s.Id ?? s.id, name: s.Name ?? s.name }));
}

async function betmomoSports() {
  try {
    return await swarmSession(async (send) => {
      const data = await send({ sport: ['id', 'name', 'alias'] }, {});
      return Object.values(data?.sport || {}).map((s) => ({ id: s.id, name: s.name, alias: s.alias }));
    });
  } catch (e) { return { error: e.message }; }
}

async function sportcashSports() {
  const wc = await scget('getWidgetCentrali', {});
  const found = new Map();
  if (wc?.lms) for (const k of Object.keys(wc.lms)) {
    const b = wc.lms[k];
    if (b?.avs) for (const av of b.avs) if (av.ds) found.set(av.ds, k);
  }
  if (wc?.tms) for (const t of wc.tms) if (t.ds) found.set(t.ds, 'tms');
  if (wc?.bws) for (const bw of wc.bws) for (const av of (bw.avs || [])) if (av.ds) found.set(av.ds, 'bws');
  return [...found.entries()].map(([name, key]) => ({ name, lmsKey: key }));
}

(async () => {
  const out = { at: new Date().toISOString(), sports_per_book: {} };
  for (const [name, fn] of [
    ['xbet', xbetSports],
    ['onewin', onewinSports],
    ['congobet', congobetSports],
    ['yellowbet', yellowbetSports],
    ['apollo', apolloSports],
    ['betmomo', betmomoSports],
    ['sportcash', sportcashSports],
  ]) {
    process.stderr.write(`[probe-sports] ${name}...\n`);
    try {
      const r = await fn();
      // Filter to tennis-related entries
      if (Array.isArray(r)) {
        const tennis = r.filter((s) => /tennis/i.test(s.name || '') && !/table|ping|court/i.test(s.name || ''));
        out.sports_per_book[name] = { total: r.length, tennis, top10: r.slice(0, 10) };
      } else {
        out.sports_per_book[name] = { error: r.error, raw: r };
      }
    } catch (e) { out.sports_per_book[name] = { error: e.message }; }
  }
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
