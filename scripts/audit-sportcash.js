// Audit Sportcash foot v2 : dump compact des cs codes + test idAggregata variants.
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
    out.push({ p: e.p, a: e.a, home: teams.home, away: teams.away, league: e.dt || '' });
  }
  return out;
}

const events = await listSportEvents();
console.log(`events: ${events.length}`);
if (!events.length) { console.log('NO EVENTS'); process.exit(1); }

const e = events[0];
console.log(`match test: ${e.home} vs ${e.away} (${e.league})`);

// Test différents idAggregata + isLive pour trouver la config qui expose 1X2/Total/DC/BTTS
const configs = [
  { idAggregata: '-1', isLive: 'false' },  // config actuelle
  { idAggregata: '0', isLive: 'false' },
  { idAggregata: '1', isLive: 'false' },
  { idAggregata: '2', isLive: 'false' },
];

const results = {};
for (const cfg of configs) {
  const label = `agg=${cfg.idAggregata},live=${cfg.isLive}`;
  try {
    const detail = await xget('getEvento', { pal: String(e.p), avv: String(e.a), ...cfg }, 15000);
    const markets = detail && Array.isArray(detail.scs) ? detail.scs : [];
    // Groupe par cs, compact : juste count + label court
    const csMap = new Map();
    for (const m of markets) {
      const cs = m.cs;
      if (!csMap.has(cs)) csMap.set(cs, { count: 0, d: m.d, first_h: m.h });
      csMap.get(cs).count++;
    }
    const parsed = sportcashFlatOdds(markets);
    results[label] = {
      market_count: markets.length,
      cs_count: csMap.size,
      cs_codes: [...csMap.entries()].map(([cs, info]) => `cs=${cs} (x${info.count}) "${info.d}" h=${info.first_h}`).sort(),
      parsed_count: Object.keys(parsed).length,
      parsed_sample: Object.entries(parsed).slice(0, 15),
    };
  } catch (err) {
    results[label] = { error: err.message };
  }
}

// Aussi tenter getEventiPrincipali ou similaires
const otherEndpoints = ['getEventoScommesse', 'getScommesseEvento', 'getEventoDettaglio'];
for (const ep of otherEndpoints) {
  try {
    const j = await xget(ep, { pal: String(e.p), avv: String(e.a) }, 8000);
    results[`endpoint:${ep}`] = { has_data: !!j, keys: j ? Object.keys(j).slice(0, 10) : null, scs_count: (j?.scs || []).length };
  } catch (err) { results[`endpoint:${ep}`] = { error: err.message }; }
}

console.log('=== SPORTCASH CONFIG AUDIT START ===');
console.log(JSON.stringify(results, null, 2));
console.log('=== SPORTCASH CONFIG AUDIT END ===');
process.exit(0);
