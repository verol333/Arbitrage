#!/usr/bin/env node
// POC combinatorial arbitrage : cherche des coverage sets multi-books multi-marches
// qui garantissent un profit >= seuil, meme quand ce n'est PAS le meme marche
// sur les 2/3 books. Objectif user : trouver >= 10-15-20% de profit.
//
// Ne modifie RIEN en prod. Juste un scan + analyse + rapport top opps.
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';

const BOOKS = ['1xbet', '1win', 'congobet', 'betpawa', 'yellowbet', 'sportybet', 'apollo'];
const MIN_PROFIT = 0.10; // seuil 10%
const SAMPLE_MATCHES_MAX = 200; // limite pour tenir dans 15 min
const DEBUG_KEYS = true; // dump les 30 premieres cles par book sur 1 match

// ─── Coverage patterns ────────────────────────────────────────────────────
// Chaque pattern definit un set de "slots" ; chaque slot exige une cle-marche
// specifique. On cherche pour chaque slot le book qui donne la meilleure cote.
// La coverage est GARANTIE par construction de chaque pattern.
const PATTERNS = [
  { name: '1X2 3-way (H+D+A)', slots: ['match_1', 'match_x', 'match_2'] },
  { name: 'DC 1X + match_2', slots: ['dc_1x', 'match_2'] },
  { name: 'DC X2 + match_1', slots: ['dc_x2', 'match_1'] },
  { name: 'DC 12 + match_x', slots: ['dc_12', 'match_x'] },
  { name: 'HT 3-way', slots: ['ht_match_1', 'ht_match_x', 'ht_match_2'] },
  { name: '2H 3-way', slots: ['h2_match_1', 'h2_match_x', 'h2_match_2'] },
  { name: 'BTTS Y/N', slots: ['btts_yes', 'btts_no'] },
  { name: 'HT BTTS Y/N', slots: ['ht_btts_yes', 'ht_btts_no'] },
  { name: '2H BTTS Y/N', slots: ['h2_btts_yes', 'h2_btts_no'] },
];

// Over/Under paires (auto-generation multi-lignes) :
for (const line of ['0.5', '1.5', '2.5', '3.5', '4.5', '5.5']) {
  PATTERNS.push({ name: `O/U ${line}`, slots: [`match_over_${line}`, `match_under_${line}`] });
}

// Handicap middles (potentiellement tres rentables si trouves)
// Ex: Home -1.5 + Away +2.5 → si home gagne 2-0, LES DEUX gagnent (bonus)
// (structure des cles hcp specifique aux books, on tente les plus courantes)
// Skipped en v1 pour rester simple : nos parseurs varient sur hcp

// ─── Fetch data ───────────────────────────────────────────────────────────
async function collectAllOdds() {
  const catalogs = new Map();
  const oddsMap = new Map(); // matchId → { book: { key: cote } }
  for (const key of BOOKS) {
    const book = bookmakersByKey[key];
    if (!book) continue;
    process.stdout.write(`[${key}] list... `);
    let matches;
    try {
      matches = await book.listMatches({ live: false, sport: 'football', horizonHours: 30 });
    } catch (e) { console.log(`❌ ${e.message}`); continue; }
    console.log(`${matches.length}`);
    catalogs.set(key, matches);
  }
  return { catalogs };
}

async function fetchOddsForAligned(entries, catalogs) {
  const perMatch = new Map(); // uid → { home, away, start, books: {book: {matchId, odds}} }
  let uid = 0;
  for (const entry of entries) {
    uid++;
    const key = `m${uid}`;
    perMatch.set(key, { home: entry.ref.home, away: entry.ref.away, start: entry.ref.start, books: {} });
    for (const [bookKey, match] of Object.entries(entry.matches)) {
      perMatch.get(key).books[bookKey] = { matchId: match.id, odds: null };
    }
  }
  // Fetch odds en parallele (batch limite par book)
  const BATCH = 8;
  const bookKeys = BOOKS;
  for (const bookKey of bookKeys) {
    const book = bookmakersByKey[bookKey];
    if (!book) continue;
    const tasks = [];
    for (const [uidKey, data] of perMatch) {
      if (data.books[bookKey]) tasks.push({ uidKey, matchId: data.books[bookKey].matchId });
    }
    process.stdout.write(`[${bookKey}] odds ${tasks.length} matchs `);
    for (let i = 0; i < tasks.length; i += BATCH) {
      const chunk = tasks.slice(i, i + BATCH);
      await Promise.all(chunk.map(async (t) => {
        try {
          const odds = await book.getOdds({ id: t.matchId }, { live: false, sport: 'football' });
          perMatch.get(t.uidKey).books[bookKey].odds = odds || {};
        } catch { perMatch.get(t.uidKey).books[bookKey].odds = {}; }
      }));
      process.stdout.write('.');
    }
    console.log(' done');
  }
  return perMatch;
}

// ─── Solveur pattern ──────────────────────────────────────────────────────
function evaluatePattern(pattern, booksData) {
  // Pour chaque slot, trouve le book qui offre la meilleure cote (max)
  const picks = [];
  for (const slot of pattern.slots) {
    let best = null;
    for (const [bookKey, data] of Object.entries(booksData)) {
      const o = data.odds && data.odds[slot];
      if (typeof o !== 'number' || o < 1.01) continue;
      if (!best || o > best.odds) best = { book: bookKey, odds: o, slot };
    }
    if (!best) return null; // slot manquant sur tous les books
    picks.push(best);
  }
  // Verifie qu'on a au moins 2 books differents (sinon = un seul book, pas d'arb reel)
  const uniqBooks = new Set(picks.map((p) => p.book));
  if (uniqBooks.size < 2) return null;
  const invSum = picks.reduce((s, p) => s + 1 / p.odds, 0);
  const profitPct = 1 - invSum;
  return { picks, invSum, profitPct, uniqBooks: uniqBooks.size };
}

// ─── Main ─────────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════');
console.log('  COMBINATORIAL ARB POC : coverage sets multi-books multi-markets');
console.log(`  Seuil profit : ${(MIN_PROFIT * 100).toFixed(0)}%   Sample max : ${SAMPLE_MATCHES_MAX}`);
console.log('═══════════════════════════════════════════════════════════════\n');

const t0 = Date.now();

// 1. Listing matchs
console.log('── Phase 1 : listing matchs par book ──');
const { catalogs } = await collectAllOdds();
console.log('');

// 2. Alignement matchs cross-books (utilise le matching existant)
console.log('── Phase 2 : alignement matchs cross-books ──');
const entries = alignCatalogs(catalogs, { minBooks: 2, horizonMs: Date.now() + 30 * 3600 * 1000 });
console.log(`  ${entries.length} matchs alignes (>= 2 books)`);
const sample = entries.slice(0, SAMPLE_MATCHES_MAX);
console.log(`  Sample : ${sample.length}\n`);

// 3. Fetch cotes pour les matchs alignes
console.log('── Phase 3 : fetch cotes ──');
const perMatch = await fetchOddsForAligned(sample, catalogs);
console.log('');

// 3bis. DEBUG : dump les cles emises par chaque book sur le 1er match avec le max de books
if (DEBUG_KEYS) {
  console.log('── Phase 3bis : dump cles par book (debug) ──');
  let bestMatch = null;
  let bestBookCount = 0;
  for (const [uidKey, data] of perMatch) {
    const bookCount = Object.values(data.books).filter((b) => b.odds && Object.keys(b.odds).length > 0).length;
    if (bookCount > bestBookCount) { bestBookCount = bookCount; bestMatch = data; }
  }
  if (bestMatch) {
    console.log(`  Match sample : ${bestMatch.home} vs ${bestMatch.away} (${bestBookCount} books avec cotes)`);
    for (const [bookKey, bd] of Object.entries(bestMatch.books)) {
      const keys = bd.odds ? Object.keys(bd.odds).filter((k) => !k.startsWith('_')).sort() : [];
      console.log(`  [${bookKey}] ${keys.length} keys : ${keys.slice(0, 30).join(', ')}${keys.length > 30 ? '...' : ''}`);
    }
    console.log('');
  }
}

// 4. Application patterns
console.log('── Phase 4 : evaluation patterns ──');
const opps = [];
for (const [uidKey, data] of perMatch) {
  for (const pattern of PATTERNS) {
    const r = evaluatePattern(pattern, data.books);
    if (r && r.profitPct >= MIN_PROFIT) {
      opps.push({
        match: `${data.home} vs ${data.away}`,
        start: data.start ? new Date(data.start).toISOString() : null,
        pattern: pattern.name,
        picks: r.picks,
        profitPct: r.profitPct,
        invSum: r.invSum,
        books: r.uniqBooks,
      });
    }
  }
}
opps.sort((a, b) => b.profitPct - a.profitPct);
console.log(`  ${opps.length} opportunites detectees (profit >= ${(MIN_PROFIT*100).toFixed(0)}%)\n`);

// 5. Rapport top opportunites
console.log('═══════════════════════════════════════════════════════════════');
console.log('  TOP OPPORTUNITES');
console.log('═══════════════════════════════════════════════════════════════\n');

const TOP_N = 30;
for (const [i, o] of opps.slice(0, TOP_N).entries()) {
  console.log(`#${i+1} ${(o.profitPct*100).toFixed(1)}%  ${o.pattern}  (${o.books} books)`);
  console.log(`  ${o.match}  @  ${o.start || 'no start'}`);
  for (const p of o.picks) {
    console.log(`    - ${p.slot.padEnd(28)} → ${p.book.padEnd(10)} @ ${p.odds.toFixed(2)}`);
  }
  console.log('');
}

// 6. Stats par pattern
console.log('═══════════════════════════════════════════════════════════════');
console.log('  STATS PAR PATTERN');
console.log('═══════════════════════════════════════════════════════════════');
const perPattern = new Map();
for (const o of opps) {
  if (!perPattern.has(o.pattern)) perPattern.set(o.pattern, []);
  perPattern.get(o.pattern).push(o.profitPct);
}
for (const [pattern, profits] of [...perPattern.entries()].sort((a,b) => b[1].length - a[1].length)) {
  const max = Math.max(...profits);
  const avg = profits.reduce((s,x)=>s+x,0) / profits.length;
  console.log(`  ${pattern.padEnd(28)}  ${profits.length.toString().padStart(4)} opps  avg ${(avg*100).toFixed(1)}%  max ${(max*100).toFixed(1)}%`);
}

console.log(`\nFin POC. Duree ${((Date.now()-t0)/1000).toFixed(1)}s`);
process.exit(0);
