// Audit Sportcash foot PROFOND : 3 matchs, tous cs codes + eqs + validation dictionnaire.
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
  if (wc?.lms) for (const sk of Object.keys(wc.lms)) {
    const b = wc.lms[sk];
    if (b?.avs) for (const av of b.avs) evs.push(av);
  }
  if (hl?.tms) for (const tm of hl.tms) evs.push(tm);
  if (hl?.lvs) for (const lv of hl.lvs) { if (lv?.avs) for (const av of lv.avs) evs.push(av); else evs.push(lv); }
  const seen = new Set(); const out = [];
  for (const e of evs) {
    if (e.ds !== SPORT_LABEL) continue;
    const key = `${e.p}_${e.a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const teams = splitTeams(e.da);
    if (!teams) continue;
    if (isVirtual(`${teams.home} ${teams.away} ${e.dt || ''}`)) continue;
    out.push({ p: e.p, a: e.a, home: teams.home, away: teams.away, league: e.dt || e.dc || '', start: parseTs(e.ts) });
  }
  return out;
}

console.log('=== SPORTCASH DIAGNOSTIC PROFOND ===\n');
const events = await listSportEvents();
console.log(`Total events foot listés: ${events.length}`);

// Distribution ligues
const lg = {}; for (const e of events) lg[e.league] = (lg[e.league] || 0) + 1;
console.log('\nTop ligues :');
for (const [k, n] of Object.entries(lg).sort((a,b)=>b[1]-a[1]).slice(0,10)) console.log(`  ${k}: ${n}`);

// 3 matchs échantillonnés
const now = Date.now();
const upcoming = events.filter(e => e.start && e.start > now).sort((a,b) => a.start - b.start);
const picks = [];
if (upcoming.length >= 3) {
  picks.push(upcoming[0]);
  picks.push(upcoming[Math.floor(upcoming.length / 2)]);
  picks.push(upcoming[upcoming.length - 1]);
} else picks.push(...upcoming.slice(0, 3));

// Rejoue les matchs en profondeur
const allCsSeen = new Map(); // cs → { count_matches, samples: [{d, first_eqs}] }
for (const [i, m] of picks.entries()) {
  console.log(`\n\n─── MATCH ${i+1}/${picks.length} : ${m.home} vs ${m.away} [${m.league}] ${new Date(m.start).toISOString()} ───`);
  const j = await xget('getEvento', { pal: String(m.p), avv: String(m.a), idAggregata: '-1', isLive: 'false' }, 20000);
  const markets = j?.scs || [];
  console.log(`Total markets: ${markets.length}`);
  const cs = {};
  for (const mk of markets) {
    const k = mk.cs;
    if (!cs[k]) cs[k] = { count: 0, d: mk.d, h_samples: [], eqs_first: [] };
    cs[k].count++;
    if (mk.h != null) cs[k].h_samples.push(Number(mk.h)/100);
    if (cs[k].eqs_first.length < 3) {
      for (const e of (mk.eqs || [])) cs[k].eqs_first.push({ ce: e.ce, d: e.d, q: e.q });
    }
    // Global aggregation
    if (!allCsSeen.has(k)) allCsSeen.set(k, { matches: new Set(), d: mk.d, sample_eqs: cs[k].eqs_first });
    allCsSeen.get(k).matches.add(i);
  }
  console.log(`\ncs codes distincts : ${Object.keys(cs).length}`);
  for (const [csCode, info] of Object.entries(cs).sort((a,b)=>Number(a[0])-Number(b[0]))) {
    const eqStr = info.eqs_first.slice(0,4).map(e=>`ce=${e.ce}"${(e.d||'').slice(0,25)}"q=${e.q}`).join(' | ');
    const hStr = info.h_samples.length ? ` h∈[${[...new Set(info.h_samples)].sort((a,b)=>a-b).slice(0,6).join(',')}]` : '';
    console.log(`  cs=${csCode} x${info.count} "${(info.d||'').slice(0,35)}"${hStr}\n     ${eqStr}`);
  }
  const parsed = sportcashFlatOdds(markets);
  const parsedKeys = Object.keys(parsed);
  console.log(`\nParseur produit ${parsedKeys.length} cotes :`);
  console.log(`  ${parsedKeys.sort().join(', ')}`);
}

// Rapport global
console.log('\n\n=== SYNTHÈSE cs codes vus sur les 3 matchs ===');
const currentDict = new Set([3, 8, 14, 16, 17, 18, 19, 560, 569, 1749, 1750, 7989,
  4, 5, 7, 165, 166, 550, 551, 420, 421, 422, 425, 563, 564, 570, 571,
  688, 689, 690, 838, 7328, 7329, 7330, 7331, 7332, 7333, 7446]);
const notInDict = [];
const inDict = [];
for (const [cs, info] of [...allCsSeen.entries()].sort((a,b)=>Number(a[0])-Number(b[0]))) {
  const status = currentDict.has(Number(cs)) ? '✅ dict' : '❌ MANQUANT';
  const eqStr = info.sample_eqs.slice(0,3).map(e=>`ce=${e.ce}"${(e.d||'').slice(0,20)}"q=${e.q}`).join(' | ');
  console.log(`  cs=${cs} (${info.matches.size}/3 matchs) ${status} "${(info.d||'').slice(0,35)}"\n     ${eqStr}`);
  if (currentDict.has(Number(cs))) inDict.push(cs); else notInDict.push({cs, d: info.d, eqs: info.sample_eqs});
}
console.log(`\n📊 Dans dictionnaire : ${inDict.length} codes | Hors dictionnaire : ${notInDict.length} codes`);
if (notInDict.length) {
  console.log('\n⚠️ Codes cs manquants (probablement des marchés utiles) :');
  for (const {cs, d, eqs} of notInDict) console.log(`  cs=${cs} "${d}" — sample: ${JSON.stringify(eqs.slice(0,3))}`);
}
process.exit(0);
