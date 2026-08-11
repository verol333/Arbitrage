#!/usr/bin/env node
// AUDIT BetPawa exhaustif :
//   1) Counts par sport (foot/tennis/basket + test hockey)
//   2) Sur 2 samples/sport : dump TOUS les marketId + names + samples de rows
//   3) Compare aux marketIds actuellement mappes dans parse.js
//   4) Sort la liste des NOUVEAUX marches (id inconnu de parse.js)

import bp from '../src/bookmakers/betpawa/index.js';
import { bpFetchEvent, bpFetchList, buildEventsListUrl, splitTeams, MARKET_TYPES_BY_SPORT, CATEGORY_IDS } from '../src/bookmakers/betpawa/api.js';
import { betpawaFlatOdds, betpawaTennisFlatOdds, betpawaBasketFlatOdds } from '../src/bookmakers/betpawa/parse.js';

const PARSERS = { football: betpawaFlatOdds, tennis: betpawaTennisFlatOdds, basket: betpawaBasketFlatOdds };

function sanity2way(o, k1, k2) {
  const a = o[k1], b = o[k2];
  if (!a || !b) return '-';
  const inv = 1 / a + 1 / b;
  const margin = Math.round((inv - 1) * 1000) / 10;
  return `sum=${a.toFixed(2)}+${b.toFixed(2)}→inv=${inv.toFixed(3)} margin=${margin}%`;
}

// Set des marketIds DEJA connus par parse.js (extrait a jour 2026-08-11).
const KNOWN = new Set([
  // Football
  '3743','4693','3795','4703','5000','5006','5003','4833',
  '3668','4673','3789','4697','4958','4794',
  '3685','4681','3792','4700','4976','4809',
  '4728','3774', // 3774 = Asian Hcp FT (ajoute 2026-08-11)
  // Tennis
  '2043818','4758','4770','3532590','4666923','4895','4880','2068161','2068172','3597899',
  // Basket
  '4791','5009','3777','4839',
]);

const SPORTS_TO_TEST = ['football', 'tennis', 'basket'];
// Hockey : BetPawa Congo n'a pas de category confirmee. Test ID probables :
const HOCKEY_CANDIDATES = ['4','5','10','20','62','63'];

async function tryHockeyCategory(catId) {
  const url = buildEventsListUrl({ eventType: 'UPCOMING', categories: [catId], marketTypes: ['3743','4791','5000','5009'], skip: 0, take: 20 });
  const strings = await bpFetchList(url);
  const ids = new Set();
  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    if (/^\d{7,10}$/.test(s)) {
      const name = strings[i + 1] || '';
      if (name.includes(' - ')) ids.add(s);
    }
  }
  return { catId, count: ids.size, samples: [...ids].slice(0, 3) };
}

async function dumpAllMarkets(matchId) {
  const ev = await bpFetchEvent(matchId, 20_000, { fresh: true });
  if (!ev) return null;
  const markets = ev.markets || [];
  const summary = [];
  for (const m of markets) {
    const mid = String(m?.marketType?.id ?? '');
    const mname = m?.marketType?.name || m?.name || '';
    const description = m?.description || '';
    const rows = Array.isArray(m.row) ? m.row : [];
    // 1er row : specifiers + prices
    const rowSample = rows[0] || {};
    const specKeys = rowSample.specifier ? Object.keys(rowSample.specifier) : [];
    const specValues = specKeys.map(k => `${k}=${rowSample.specifier[k]}`).join(',');
    const prices = rowSample.price ? Object.entries(rowSample.price).map(([label, po]) => `${label}=${po.odds ?? po}`).join(' | ') : '';
    summary.push({ mid, mname, description, nrows: rows.length, specValues, prices });
  }
  return { home: ev.homeName, away: ev.awayName, league: ev.competitionName, markets: summary };
}

console.log('▶ AUDIT BetPawa\n');

for (const sport of SPORTS_TO_TEST) {
  console.log(`\n═══════════════════ ${sport.toUpperCase()} ═══════════════════`);
  let matches;
  try {
    matches = await bp.listMatches({ sport });
  } catch (e) { console.log(`  listMatches err=${e.message}`); continue; }
  console.log(`  Matchs listes : ${matches.length}`);
  if (matches.length === 0) { console.log('  ⚠ 0 matchs — sport peut-etre non supporte'); continue; }
  console.log(`  Samples : ${matches.slice(0, 3).map(m => `${m.home} vs ${m.away}`).join(' | ')}`);

  const samples = matches.slice(0, 2);
  for (const s of samples) {
    console.log(`\n  ── ${s.home} vs ${s.away} (id=${s.id}) ──`);
    const dump = await dumpAllMarkets(s.id);
    if (!dump) { console.log('    ⚠ event fetch failed'); continue; }
    console.log(`    ${dump.markets.length} markets dans /events/${s.id}`);
    const newOnes = dump.markets.filter(m => !KNOWN.has(m.mid));
    console.log(`    Marches deja MAPPES : ${dump.markets.filter(m => KNOWN.has(m.mid)).length}`);
    console.log(`    Marches NOUVEAUX   : ${newOnes.length}`);
    for (const nm of newOnes.slice(0, 25)) {
      const specStr = nm.specValues ? ` specs=[${nm.specValues}]` : '';
      console.log(`      NEW id=${nm.mid} nrows=${nm.nrows} name="${nm.mname}"${specStr}`);
      if (nm.prices) console.log(`        row0: ${nm.prices}`);
    }
    // ─── VERIFICATION SEMANTIQUE : parse via parseur reel + sanity check ─
    const eventFull = await bpFetchEvent(s.id, 15_000);
    const parser = PARSERS[sport];
    if (parser && eventFull) {
      const parsed = parser(eventFull);
      const keys = Object.keys(parsed).filter(k => k !== '_ids');
      console.log(`    ► parseur emit ${keys.length} keys plates`);
      // Sanity samples
      if (parsed.match_1 && parsed.match_2) console.log(`      match_1/2  : ${sanity2way(parsed, 'match_1', 'match_2')}`);
      if (parsed.match_X) console.log(`      match_X    : ${parsed.match_X}`);
      // Sanity handicaps (foot)
      const hcpLines = [...new Set(keys.filter(k => k.startsWith('hcp_home_')).map(k => k.replace('hcp_home_', '')))].slice(0, 3);
      for (const l of hcpLines) {
        const home = parsed[`hcp_home_${l}`], away = parsed[`hcp_away_${-Number(l)}`];
        console.log(`      hcp L=${l}   : home=${home ?? '-'} away=${away ?? '-'} ${home && away ? `→ inv=${(1/home + 1/away).toFixed(3)}` : ''}`);
      }
    }
  }
}

console.log('\n═══════════════════ HOCKEY : test category IDs ═══════════════════');
for (const cat of HOCKEY_CANDIDATES) {
  const r = await tryHockeyCategory(cat);
  console.log(`  category=${cat} → ${r.count} matchs ${r.samples.length ? '(samples: ' + r.samples.join(',') + ')' : ''}`);
}

console.log('\n═══ FIN AUDIT BetPawa ═══');
process.exit(0);
