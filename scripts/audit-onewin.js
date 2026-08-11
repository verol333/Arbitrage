#!/usr/bin/env node
// AUDIT 1win : counts par sport + dump groupes marketes non-parses.
// 1win : WebSocket → oddsGroups [{ name, oddsList: [{ name, coef, ... }] }].
// Le parseur match sur group.name (regex low-case). Un group non matche = trou.

import win from '../src/bookmakers/onewin/index.js';
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';
import { winFlatOdds, winTennisFlatOdds, winBasketFlatOdds } from '../src/bookmakers/onewin/parse.js';

// hockey routed to winFlatOdds (3-way regulation like foot).
const PARSERS = { football: winFlatOdds, tennis: winTennisFlatOdds, basket: winBasketFlatOdds, hockey: winFlatOdds };
const SPORTS = ['football','tennis','basket','hockey'];

function sanity2way(o, k1, k2) {
  const a = o[k1], b = o[k2];
  if (!a || !b) return '-';
  const inv = 1 / a + 1 / b;
  return `${a.toFixed(2)}+${b.toFixed(2)}→inv=${inv.toFixed(3)}`;
}

console.log('▶ AUDIT 1win\n');

for (const sport of SPORTS) {
  console.log(`\n═══════════════════ ${sport.toUpperCase()} ═══════════════════`);
  let matches;
  try {
    matches = await win.listMatches({ sport });
  } catch (e) { console.log(`  listMatches err=${e.message}`); continue; }
  console.log(`  Matchs listes : ${matches.length}`);
  if (matches.length === 0) { console.log('  ⚠ 0 matchs — a investiguer'); continue; }
  console.log(`  Samples : ${matches.slice(0, 3).map(m => `${m.home} vs ${m.away}`).join(' | ')}`);

  const samples = matches.slice(0, 2);
  const sampleIds = samples.map(s => s.id);
  const oddsMap = await fetchOddsWS(sampleIds, { timeoutMs: 20_000, quietMs: 3_000 });
  const parser = PARSERS[sport];

  for (const s of samples) {
    console.log(`\n  ── ${s.home} vs ${s.away} (id=${s.id}) ──`);
    const groups = oddsMap.get(s.id);
    if (!groups) { console.log('    ⚠ ws returned no groups'); continue; }
    const names = { home: s.home, away: s.away };
    const groupNames = Object.keys(groups);
    console.log(`    ${groupNames.length} groups reçus`);
    // Parse
    const parsed = parser ? parser(groups, names) : {};
    const keys = Object.keys(parsed).filter(k => k !== '_ids');
    console.log(`    ► parseur emit ${keys.length} keys plates`);

    if (parsed.match_1 && parsed.match_2) console.log(`      match_1/2  : ${sanity2way(parsed, 'match_1', 'match_2')}`);
    if (parsed.match_X) console.log(`      match_X    : ${parsed.match_X}`);
    const hcpLines = [...new Set(keys.filter(k => k.startsWith('hcp_home_')).map(k => k.replace('hcp_home_', '')))].slice(0, 2);
    for (const l of hcpLines) {
      const home = parsed[`hcp_home_${l}`], away = parsed[`hcp_away_${-Number(l)}`];
      if (home && away) console.log(`      hcp L=${l}: ${sanity2way(parsed, `hcp_home_${l}`, `hcp_away_${-Number(l)}`)}`);
    }
    // Dump les groupes qui n'ont produit aucune key (heuristique : count groupname avant/apres)
    // Difficile a mesurer sans instrumenter parse.js. On dump juste les noms de groups
    // pour reperer ce qui existe.
    const catBuckets = { winner: [], handicap: [], total: [], oddeven: [], halfhalf: [], quarter: [], teamtotal: [], corner: [], other: [] };
    for (const gn of groupNames) {
      const low = gn.toLowerCase();
      if (/winner|result/.test(low)) catBuckets.winner.push(gn);
      else if (/handicap/.test(low)) catBuckets.handicap.push(gn);
      else if (/total.*(even|odd)|odd.*even/.test(low)) catBuckets.oddeven.push(gn);
      else if (/total/.test(low) && /team|home|away|player/.test(low)) catBuckets.teamtotal.push(gn);
      else if (/total/.test(low)) catBuckets.total.push(gn);
      else if (/1st half|2nd half|half/.test(low)) catBuckets.halfhalf.push(gn);
      else if (/1st quarter|2nd quarter|3rd quarter|4th quarter|quarter/.test(low)) catBuckets.quarter.push(gn);
      else if (/corner/.test(low)) catBuckets.corner.push(gn);
      else catBuckets.other.push(gn);
    }
    console.log(`    Groups par categorie :`);
    for (const [k, arr] of Object.entries(catBuckets)) {
      if (arr.length) console.log(`      ${k}: [${arr.slice(0, 8).join(' | ')}${arr.length > 8 ? ` ...+${arr.length - 8}` : ''}]`);
    }
  }
}

console.log('\n═══ FIN AUDIT 1win ═══');
process.exit(0);
