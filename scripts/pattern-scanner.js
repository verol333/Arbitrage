#!/usr/bin/env node
// ÉTAPE 3 : scan des patterns cartographiés sur les 4 books.
// Chaque pattern décrit une "coverage set" (comb de sélections qui couvre tous
// les scores possibles). On récupère les données fraiches (comme étape 1),
// puis on applique chaque pattern en prenant la meilleure cote cross-book.
//
// Un pattern est un ARBITRAGE si sum(1/cotes) < 1.
// Le script SKIPPE proprement les patterns dont un marché manque dans les données.
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const BOOKS = ['1xbet', '1win', 'congobet', 'betpawa'];
const TOP_MATCHES = 3;
const MIN_PROFIT_REPORT = -0.10; // affiche tous les patterns au-dessus de -10% (voir le "près de l'arb")

// ─── CATALOGUE DES PATTERNS ────────────────────────────────────────────────
// Chaque pattern liste les CLÉS NORMALISÉES nécessaires. Si une clé n'est pas
// dans les données, le pattern est skippé.
const PATTERNS = [
  // === Famille A : simples (déjà connus) ===
  { name: 'A1_1X2_triway', family: 'A', slots: ['match_1', 'match_X', 'match_2'] },
  { name: 'A2_OU_0.5', family: 'A', slots: ['match_over_0.5', 'match_under_0.5'] },
  { name: 'A2_OU_1.5', family: 'A', slots: ['match_over_1.5', 'match_under_1.5'] },
  { name: 'A2_OU_2.5', family: 'A', slots: ['match_over_2.5', 'match_under_2.5'] },
  { name: 'A2_OU_3.5', family: 'A', slots: ['match_over_3.5', 'match_under_3.5'] },
  { name: 'A2_OU_4.5', family: 'A', slots: ['match_over_4.5', 'match_under_4.5'] },
  { name: 'A2_OU_5.5', family: 'A', slots: ['match_over_5.5', 'match_under_5.5'] },
  { name: 'A3_BTTS', family: 'A', slots: ['btts_yes', 'btts_no'] },
  { name: 'A4_DC_1X+away', family: 'A', slots: ['dc_1X', 'match_2'] },
  { name: 'A4_DC_X2+home', family: 'A', slots: ['dc_X2', 'match_1'] },
  { name: 'A4_DC_12+draw', family: 'A', slots: ['dc_12', 'match_X'] },

  // === Famille A HT/2H (1ère et 2ème mi-temps) ===
  { name: 'A1_HT_1X2', family: 'A', slots: ['ht_match_1', 'ht_match_X', 'ht_match_2'] },
  { name: 'A1_H2_1X2', family: 'A', slots: ['h2_match_1', 'h2_match_X', 'h2_match_2'] },
  { name: 'A2_HT_OU_0.5', family: 'A', slots: ['ht_over_0.5', 'ht_under_0.5'] },
  { name: 'A2_HT_OU_1.5', family: 'A', slots: ['ht_over_1.5', 'ht_under_1.5'] },
  { name: 'A2_HT_OU_2.5', family: 'A', slots: ['ht_over_2.5', 'ht_under_2.5'] },
  { name: 'A2_H2_OU_0.5', family: 'A', slots: ['h2_over_0.5', 'h2_under_0.5'] },
  { name: 'A2_H2_OU_1.5', family: 'A', slots: ['h2_over_1.5', 'h2_under_1.5'] },
  { name: 'A2_H2_OU_2.5', family: 'A', slots: ['h2_over_2.5', 'h2_under_2.5'] },
  { name: 'A3_HT_BTTS', family: 'A', slots: ['ht_btts_yes', 'ht_btts_no'] },
  { name: 'A3_H2_BTTS', family: 'A', slots: ['h2_btts_yes', 'h2_btts_no'] },

  // Odd/Even
  { name: 'A5_odd_even', family: 'A', slots: ['odd', 'even'] },
  { name: 'A5_HT_odd_even', family: 'A', slots: ['ht_odd', 'ht_even'] },
  { name: 'A5_H2_odd_even', family: 'A', slots: ['h2_odd', 'h2_even'] },

  // === Famille G : Handicap Asian complémentaires ===
  { name: 'G1_Hcp_+0.5', family: 'G', slots: ['hcp_home_0.5', 'hcp_away_-0.5'] },
  { name: 'G1_Hcp_-0.5', family: 'G', slots: ['hcp_home_-0.5', 'hcp_away_0.5'] },
  { name: 'G1_Hcp_+1.5', family: 'G', slots: ['hcp_home_1.5', 'hcp_away_-1.5'] },
  { name: 'G1_Hcp_-1.5', family: 'G', slots: ['hcp_home_-1.5', 'hcp_away_1.5'] },
  { name: 'G1_Hcp_+2.5', family: 'G', slots: ['hcp_home_2.5', 'hcp_away_-2.5'] },
  { name: 'G1_HT_Hcp_+0.5', family: 'G', slots: ['ht_hcp_home_0.5', 'ht_hcp_away_-0.5'] },
  { name: 'G1_HT_Hcp_-0.5', family: 'G', slots: ['ht_hcp_home_-0.5', 'ht_hcp_away_0.5'] },
  { name: 'G1_HT_Hcp_+1.5', family: 'G', slots: ['ht_hcp_home_1.5', 'ht_hcp_away_-1.5'] },
  { name: 'G1_H2_Hcp_+0.5', family: 'G', slots: ['h2_hcp_home_0.5', 'h2_hcp_away_-0.5'] },
  { name: 'G1_H2_Hcp_+1.5', family: 'G', slots: ['h2_hcp_home_1.5', 'h2_hcp_away_-1.5'] },

  // === Famille H : Team Totals complémentaires ===
  // Home O/U X.5 = 2-way partition sur h uniquement. Pour couvrir tout (h,a),
  // on cross-produit avec Away O/U. Pattern 4-way:
  { name: 'H1_TT_home_away_0.5', family: 'H',
    slots4way: {
      tt_home_under_0.5: 'h=0',
      tt_home_over_0.5: 'h>=1',
      tt_away_under_0.5: 'a=0',
      tt_away_over_0.5: 'a>=1',
    },
    // Ces 4 slots ne sont pas mutuellement exclusifs. On les traite en 2 patterns 2-way :
    slots: ['tt_home_over_0.5', 'tt_home_under_0.5'],
  },
  // Chaque Team O/U seul = 2-way arb sur les buts d'UNE équipe (impartition tot).
  { name: 'H1a_TThome_0.5', family: 'H', slots: ['tt_home_over_0.5', 'tt_home_under_0.5'] },
  { name: 'H1a_TThome_1.5', family: 'H', slots: ['tt_home_over_1.5', 'tt_home_under_1.5'] },
  { name: 'H1a_TThome_2.5', family: 'H', slots: ['tt_home_over_2.5', 'tt_home_under_2.5'] },
  { name: 'H1a_TTaway_0.5', family: 'H', slots: ['tt_away_over_0.5', 'tt_away_under_0.5'] },
  { name: 'H1a_TTaway_1.5', family: 'H', slots: ['tt_away_over_1.5', 'tt_away_under_1.5'] },
  { name: 'H1a_TTaway_2.5', family: 'H', slots: ['tt_away_over_2.5', 'tt_away_under_2.5'] },

  // === Famille I : mixtes exotiques ===
  { name: 'I3_CS_home_away_BTTS', family: 'I', slots: ['cs_home_yes', 'cs_away_yes', 'btts_yes'] },
  //   CS home yes = a=0, CS away yes = h=0, BTTS yes = h≥1 ∧ a≥1
  //   Union = {a=0} ∪ {h=0} ∪ {h≥1 ∧ a≥1} = tous ✅
  //   Overlaps sur {0-0} mais OK pour arb (bonus si winner overlap)

  // === Famille Corners (nouveaux marchés potentiellement mal exploités) ===
  { name: 'COR_OU_10.5', family: 'COR', slots: ['cor_over_10.5', 'cor_under_10.5'] },
  { name: 'COR_1X2', family: 'COR', slots: ['cor_match_1', 'cor_match_X', 'cor_match_2'] },
  { name: 'COR_odd_even', family: 'COR', slots: ['cor_odd', 'cor_even'] },
  { name: 'COR_Hcp_-1.5', family: 'COR', slots: ['cor_hcp_home_-1.5', 'cor_hcp_away_1.5'] },
  { name: 'COR_Hcp_+1.5', family: 'COR', slots: ['cor_hcp_home_1.5', 'cor_hcp_away_-1.5'] },
];

// ─── SOLVEUR ───────────────────────────────────────────────────────────────
function evaluatePattern(pattern, matchOdds) {
  // Pour chaque slot, trouve la meilleure cote cross-book
  const picks = [];
  const missing = [];
  for (const slot of pattern.slots) {
    let bestBook = null, bestOdds = 0;
    for (const [book, odds] of Object.entries(matchOdds)) {
      const c = odds[slot];
      if (c != null && c > bestOdds) { bestOdds = c; bestBook = book; }
    }
    if (!bestBook) { missing.push(slot); continue; }
    picks.push({ slot, book: bestBook, odds: bestOdds });
  }
  if (missing.length > 0) return { skipped: true, missing };
  const sumInv = picks.reduce((s, p) => s + 1 / p.odds, 0);
  return { picks, sumInv, profit: 1 - sumInv, isArb: sumInv < 1 };
}

// ─── MAIN ──────────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════');
console.log('  ÉTAPE 3 : SCAN PATTERNS SUR 4 BOOKS');
console.log(`  Books : ${BOOKS.join(', ')}`);
console.log(`  ${PATTERNS.length} patterns catalogués`);
console.log('═══════════════════════════════════════════════════════════════\n');

// 1. Listing
const catalogs = new Map();
for (const key of BOOKS) {
  const book = bookmakersByKey[key];
  if (!book) continue;
  try {
    const matches = await book.listMatches({ live: false, sport: 'football', horizonHours: 30 });
    catalogs.set(key, matches);
    console.log(`[${key}] ${matches.length} matchs`);
  } catch (e) { console.log(`[${key}] KO ${e.message}`); }
}

// 2. Alignement
const entries = alignCatalogs(catalogs, { minBooks: 4, horizonMs: Date.now() + 30 * 3600 * 1000 });
entries.sort((a, b) => Object.keys(b.matches).length - Object.keys(a.matches).length);
const top = entries.slice(0, TOP_MATCHES);
console.log(`\n${top.length} matchs sélectionnés :`);
for (const e of top) console.log(`  ${e.ref.home} vs ${e.ref.away}`);

// 3. Fetch odds
const matchesData = [];
for (const entry of top) {
  const rec = { home: entry.ref.home, away: entry.ref.away, odds: {} };
  for (const [bookKey, m] of Object.entries(entry.matches)) {
    const book = bookmakersByKey[bookKey];
    if (!book) continue;
    try {
      const odds = await book.getOdds(m, { live: false, sport: 'football' });
      const clean = {};
      if (odds) for (const [k, v] of Object.entries(odds)) {
        if (k.startsWith('_')) continue;
        if (typeof v === 'number' && v > 1) clean[k] = v;
      }
      rec.odds[bookKey] = clean;
    } catch { rec.odds[bookKey] = {}; }
  }
  matchesData.push(rec);
}

// 4. Application patterns
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  RÉSULTATS PAR MATCH & PATTERN');
console.log('═══════════════════════════════════════════════════════════════');

const allOpps = [];
const patternStats = new Map();
for (const p of PATTERNS) patternStats.set(p.name, { tested: 0, skipped: 0, arbs: 0, bestProfit: -Infinity });

for (const md of matchesData) {
  console.log(`\n▓▓ ${md.home} vs ${md.away}`);
  for (const pattern of PATTERNS) {
    const r = evaluatePattern(pattern, md.odds);
    const stats = patternStats.get(pattern.name);
    if (r.skipped) {
      stats.skipped++;
      continue;
    }
    stats.tested++;
    if (r.profit > stats.bestProfit) stats.bestProfit = r.profit;
    if (r.isArb) {
      stats.arbs++;
      allOpps.push({
        match: `${md.home} vs ${md.away}`,
        pattern: pattern.name,
        family: pattern.family,
        profit: r.profit,
        picks: r.picks,
      });
      const picksStr = r.picks.map(p => `${p.slot} @ ${p.odds.toFixed(2)} (${p.book})`).join('  |  ');
      console.log(`  ✅ ARB ${(r.profit*100).toFixed(1)}%  ${pattern.name}  →  ${picksStr}`);
    } else if (r.profit >= MIN_PROFIT_REPORT) {
      // pas arb mais proche : afficher pour référence
      const picksStr = r.picks.map(p => `${p.slot} @ ${p.odds.toFixed(2)} (${p.book})`).join('  |  ');
      console.log(`  · near ${(r.profit*100).toFixed(1)}%  ${pattern.name}  →  ${picksStr}`);
    }
  }
}

// 5. Résumé
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  RÉSUMÉ');
console.log('═══════════════════════════════════════════════════════════════');
allOpps.sort((a, b) => b.profit - a.profit);
console.log(`\n📊 TOTAL ARBITRAGES DÉTECTÉS : ${allOpps.length}\n`);
if (allOpps.length > 0) {
  console.log('TOP 10 :');
  for (const [i, o] of allOpps.slice(0, 10).entries()) {
    console.log(`  #${i+1} ${(o.profit*100).toFixed(1)}%  ${o.pattern}  (${o.match})`);
    for (const p of o.picks) console.log(`    - ${p.slot} @ ${p.odds.toFixed(2)}  [${p.book}]`);
  }
}

console.log('\n📋 STATS PAR PATTERN :');
console.log('Pattern                        | tested | skipped | arbs | bestProfit');
console.log('-'.repeat(75));
for (const [name, s] of patternStats) {
  const bp = s.bestProfit > -Infinity ? `${(s.bestProfit*100).toFixed(1)}%` : 'n/a';
  console.log(`${name.padEnd(30)} | ${String(s.tested).padStart(6)} | ${String(s.skipped).padStart(7)} | ${String(s.arbs).padStart(4)} | ${bp.padStart(8)}`);
}

// 6. Sauvegarde JSON
mkdirSync('output', { recursive: true });
const filename = `output/pattern-scan-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
writeFileSync(filename, JSON.stringify({
  generated_at: new Date().toISOString(),
  books: BOOKS,
  matches: matchesData.map(m => ({ home: m.home, away: m.away })),
  patterns_tested: PATTERNS.length,
  opportunities: allOpps,
  pattern_stats: Object.fromEntries(patternStats),
}, null, 2));
console.log(`\n✅ JSON sauvegardé : ${filename}`);
process.exit(0);
