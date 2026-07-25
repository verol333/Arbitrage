// Audit Sportcash foot : dump tous les cs (codes marché) réellement renvoyés
// par getEvento vs ce que le parseur écoute.
import { xget, parseTs, splitTeams, isVirtual } from '../src/bookmakers/sportcash/api.js';
import { sportcashFlatOdds } from '../src/bookmakers/sportcash/parse.js';

const SPORT_LABEL = 'Football';

async function listSportEvents() {
  const [wc, hl] = await Promise.all([
    xget('getWidgetCentrali', {}),
    xget('getHomeLandingData', { timezone: '1' }),
  ]);
  const evs = [];
  if (wc?.bws) for (const bw of wc.bws) for (const av of (bw.avs || [])) evs.push(av);
  if (wc?.tms) for (const tm of wc.tms) evs.push(tm);
  if (wc?.lms) for (const sportKey of Object.keys(wc.lms)) {
    const bucket = wc.lms[sportKey];
    if (bucket?.avs) for (const av of bucket.avs) evs.push(av);
  }
  if (hl?.tms) for (const tm of hl.tms) evs.push(tm);
  if (hl?.lvs) for (const lv of hl.lvs) {
    if (lv?.avs) for (const av of lv.avs) evs.push(av);
    else evs.push(lv);
  }
  const seen = new Set(); const out = [];
  for (const e of evs) {
    if (e.ds !== SPORT_LABEL) continue;
    const key = `${e.p}_${e.a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const teams = splitTeams(e.da);
    if (!teams) continue;
    if (isVirtual(`${teams.home} ${teams.away} ${e.dt || ''}`)) continue;
    out.push({ p: e.p, a: e.a, id: key, home: teams.home, away: teams.away, league: e.dt || '', start: parseTs(e.ts) });
  }
  return out;
}

const events = await listSportEvents();
console.log(`Total foot events found: ${events.length}`);
console.log(`Sample: ${events.slice(0, 5).map(e => `${e.home} vs ${e.away}`).join(' | ')}`);

if (!events.length) { console.log('NO EVENTS'); process.exit(1); }

// Prend 3 matchs différents et dump leurs cs
const results = [];
for (const e of events.slice(0, 3)) {
  try {
    const detail = await xget('getEvento', { pal: String(e.p), avv: String(e.a), idAggregata: '-1', isLive: 'false' }, 15000);
    const markets = detail && Array.isArray(detail.scs) ? detail.scs : [];
    // Group by cs code, count + sample eqs
    const byCs = {};
    for (const m of markets) {
      const cs = m.cs;
      if (!byCs[cs]) byCs[cs] = { count: 0, sample: null, d: m.d };
      byCs[cs].count++;
      if (!byCs[cs].sample) {
        byCs[cs].sample = {
          h: m.h,
          hs: m.hs,
          d: m.d,  // "d" is often the market label
          eqs: (m.eqs || []).slice(0, 6).map((x) => ({ ce: x.ce, q: x.q, qo: x.qo })),
        };
      }
    }
    const parsed = sportcashFlatOdds(markets);
    results.push({
      match: `${e.home} vs ${e.away}`,
      league: e.league,
      market_count: markets.length,
      cs_codes: byCs,
      parsed_count: Object.keys(parsed).length,
      parsed: parsed,
    });
  } catch (err) {
    results.push({ match: `${e.home} vs ${e.away}`, error: err.message });
  }
}

console.log('=== SPORTCASH FOOT AUDIT START ===');
console.log(JSON.stringify(results, null, 2));
console.log('=== SPORTCASH FOOT AUDIT END ===');
process.exit(0);
