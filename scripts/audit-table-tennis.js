// AUDIT TABLE TENNIS — Congobet + Apollo.
// Objectifs :
//   1. Vérifier que listMatches retourne des matchs TT valides sur les 2 books.
//   2. Fetch cotes RAW + parser sur 3 matchs par book, dumper les clés produites.
//   3. Comparer les LIGNES (hcp, total) pour détecter si Apollo=Sets/Points vs
//      Congobet=Sets/Points — critique pour éviter faux positifs arbitrage.
//   4. Chercher un match commun (matching équipes) pour cross-check parseur.
import congobet from '../src/bookmakers/congobet/index.js';
import apollo from '../src/bookmakers/apollo/index.js';
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { apolloGet } from '../src/bookmakers/apollo/api.js';

const SPORT = 'table_tennis';

function keyStats(odds) {
  const keys = Object.keys(odds || {}).filter((k) => k !== '_ids');
  const buckets = { winner: [], hcp: [], total: [], sets: [], other: [] };
  for (const k of keys) {
    if (/^match_[12X]$/.test(k)) buckets.winner.push(`${k}=${odds[k]}`);
    else if (/^hcp_/.test(k)) buckets.hcp.push(`${k}=${odds[k]}`);
    else if (/^match_(over|under)_/.test(k)) buckets.total.push(`${k}=${odds[k]}`);
    else if (/^total_sets/.test(k) || /^hcp_sets/.test(k)) buckets.sets.push(`${k}=${odds[k]}`);
    else buckets.other.push(`${k}=${odds[k]}`);
  }
  return buckets;
}

function extractLines(odds, pattern) {
  const lines = new Set();
  for (const k of Object.keys(odds || {})) {
    const m = k.match(pattern);
    if (m) lines.add(parseFloat(m[1]));
  }
  return [...lines].sort((a, b) => a - b);
}

function classifyLines(lines) {
  if (!lines.length) return '—';
  const min = Math.min(...lines.map(Math.abs));
  const max = Math.max(...lines.map(Math.abs));
  if (max <= 6) return `SETS (min=${min}, max=${max})`;
  if (max <= 15) return `POINTS/SET (min=${min}, max=${max})`;
  if (max <= 100) return `POINTS/MATCH (min=${min}, max=${max})`;
  return `? (min=${min}, max=${max})`;
}

async function auditCongobet() {
  console.log(`\n${'='.repeat(60)}\n=== CONGOBET table_tennis PREMATCH\n${'='.repeat(60)}`);
  const matches = await congobet.listMatches({ sport: SPORT, live: false });
  console.log(`Total matchs: ${matches.length}`);
  if (!matches.length) return { matches: [], odds: [] };
  matches.slice(0, 5).forEach((m) => console.log(`  · [${m.league || '?'}] ${m.home} vs ${m.away}`));

  const sample = matches.slice(0, 3);
  const oddsPerMatch = [];
  const rawBtStats = new Map();
  for (const m of sample) {
    console.log(`\n─── ${m.home} vs ${m.away} (id=${m.id}) ───`);
    const parsed = await congobet.getOdds(m, { sport: SPORT });
    const buckets = keyStats(parsed);
    console.log(`  Winner (${buckets.winner.length}): ${buckets.winner.join(' | ')}`);
    console.log(`  Hcp (${buckets.hcp.length}): ${buckets.hcp.slice(0, 8).join(' | ')}${buckets.hcp.length > 8 ? '...' : ''}`);
    console.log(`  Total (${buckets.total.length}): ${buckets.total.slice(0, 8).join(' | ')}${buckets.total.length > 8 ? '...' : ''}`);
    console.log(`  Sets (${buckets.sets.length}): ${buckets.sets.join(' | ')}`);
    console.log(`  Other (${buckets.other.length}): ${buckets.other.slice(0, 5).join(' | ')}`);

    // Dump RAW betTypes non parsés
    const json = await congoJson(`${CONGO_API}events/${m.id}`);
    if (json?.eventBetTypes) {
      for (const bt of json.eventBetTypes) {
        const id = Number(bt.betTypeId);
        const norm = id >= 20000 && id < 30000 ? id - 10000 : id;
        const items = (bt.eventBetTypeItems || []).filter((it) => it.active && it.bettingAllowed);
        if (!items.length) continue;
        if (!rawBtStats.has(norm)) rawBtStats.set(norm, { name: bt.name, count: 0, sampleItems: [] });
        const stat = rawBtStats.get(norm);
        stat.count++;
        if (stat.sampleItems.length < 3) stat.sampleItems.push(items.slice(0, 4).map((it) => `${it.shortName}=${it.odds}`).join(','));
      }
    }
    oddsPerMatch.push({ match: m, odds: parsed });
  }
  console.log(`\nBetTypes RAW rencontrés (${rawBtStats.size}) :`);
  for (const [id, s] of [...rawBtStats.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${id}\t${s.name}\t(${s.count}× | ${s.sampleItems[0]})`);
  }
  return { matches, odds: oddsPerMatch };
}

async function auditApollo() {
  console.log(`\n${'='.repeat(60)}\n=== APOLLO table_tennis PREMATCH\n${'='.repeat(60)}`);
  const matches = await apollo.listMatches({ sport: SPORT, live: false });
  console.log(`Total matchs: ${matches.length}`);
  if (!matches.length) return { matches: [], odds: [] };
  matches.slice(0, 5).forEach((m) => console.log(`  · [${m.league || '?'}] ${m.home} vs ${m.away}`));

  const sample = matches.slice(0, 3);
  const oddsPerMatch = [];
  const rawBtkStats = new Map();
  for (const m of sample) {
    console.log(`\n─── ${m.home} vs ${m.away} (id=${m.id}) ───`);
    const parsed = await apollo.getOdds(m, { sport: SPORT });
    const buckets = keyStats(parsed);
    console.log(`  Winner (${buckets.winner.length}): ${buckets.winner.join(' | ')}`);
    console.log(`  Hcp (${buckets.hcp.length}): ${buckets.hcp.slice(0, 8).join(' | ')}${buckets.hcp.length > 8 ? '...' : ''}`);
    console.log(`  Total (${buckets.total.length}): ${buckets.total.slice(0, 8).join(' | ')}${buckets.total.length > 8 ? '...' : ''}`);
    console.log(`  Sets (${buckets.sets.length}): ${buckets.sets.join(' | ')}`);
    console.log(`  Other (${buckets.other.length}): ${buckets.other.slice(0, 5).join(' | ')}`);

    // Dump RAW offers non parsés
    const raw = await apolloGet(`/sport/offer/v3/match/offers?MatchId=${m.id}`);
    const offers = raw?.Offers || (raw?.BasicOffer ? [raw.BasicOffer] : []);
    for (const o of offers) {
      const k = String(o.BetTypeKey);
      if (!rawBtkStats.has(k)) rawBtkStats.set(k, { count: 0, sampleOdds: [] });
      const s = rawBtkStats.get(k);
      s.count++;
      if (s.sampleOdds.length < 2) {
        const oddSample = (o.Odds || []).slice(0, 4).map((od) => `${od.Type}=${od.Odd}${o.Sbv ? `@${o.Sbv}` : ''}`).join(',');
        s.sampleOdds.push(oddSample);
      }
    }
    oddsPerMatch.push({ match: m, odds: parsed });
  }
  console.log(`\nBetTypeKeys RAW rencontrés (${rawBtkStats.size}) :`);
  for (const [k, s] of [...rawBtkStats.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`  ${k}\t(${s.count}× | ${s.sampleOdds[0]})`);
  }
  return { matches, odds: oddsPerMatch };
}

// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log('▶ AUDIT TABLE TENNIS (Congobet + Apollo)\n');
  const cb = await auditCongobet();
  const ap = await auditApollo();

  // Analyse cross-book : lignes hcp et total pour identifier sets vs points
  console.log(`\n${'='.repeat(60)}\n=== ANALYSE LIGNES CROSS-BOOK\n${'='.repeat(60)}`);
  for (const [book, data] of [['CONGOBET', cb], ['APOLLO', ap]]) {
    const allHcp = [];
    const allTotal = [];
    for (const o of data.odds) {
      allHcp.push(...extractLines(o.odds, /^hcp_home_(-?\d+(?:\.\d+)?)$/));
      allTotal.push(...extractLines(o.odds, /^match_over_(-?\d+(?:\.\d+)?)$/));
    }
    console.log(`\n${book}:`);
    console.log(`  hcp lines: ${[...new Set(allHcp)].sort((a, b) => a - b).join(', ')} → ${classifyLines(allHcp)}`);
    console.log(`  total lines: ${[...new Set(allTotal)].sort((a, b) => a - b).join(', ')} → ${classifyLines(allTotal)}`);
  }

  // Cross-check match commun
  console.log(`\n${'='.repeat(60)}\n=== MATCHS COMMUNS\n${'='.repeat(60)}`);
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 8);
  const cbNames = new Map();
  for (const m of cb.matches) cbNames.set(norm(m.home) + norm(m.away), m);
  const matches = [];
  for (const am of ap.matches) {
    const k1 = norm(am.home) + norm(am.away);
    const k2 = norm(am.away) + norm(am.home);
    const cm = cbNames.get(k1) || cbNames.get(k2);
    if (cm) matches.push({ apollo: am, congobet: cm });
  }
  console.log(`Matchs communs (apollo ↔ congobet): ${matches.length}`);
  for (const { apollo: am, congobet: cm } of matches.slice(0, 3)) {
    console.log(`\n  · Apollo: ${am.home} vs ${am.away}`);
    console.log(`    Congobet: ${cm.home} vs ${cm.away}`);
    const aOdds = await apollo.getOdds(am, { sport: SPORT });
    const cOdds = await congobet.getOdds(cm, { sport: SPORT });
    const aM1 = aOdds?.match_1, aM2 = aOdds?.match_2;
    const cM1 = cOdds?.match_1, cM2 = cOdds?.match_2;
    console.log(`    Winner Apollo: 1=${aM1} 2=${aM2}`);
    console.log(`    Winner Congobet: 1=${cM1} 2=${cM2}`);
    if (aM1 && aM2 && cM1 && cM2) {
      const arb = Math.min(1 / aM1 + 1 / cM2, 1 / aM2 + 1 / cM1);
      console.log(`    → invsum optimal cross-book = ${arb.toFixed(4)} (${arb < 1 ? '⚠️ ARB' : 'no arb'})`);
    }
  }

  console.log('\n▶ Fin.');
  process.exit(0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
