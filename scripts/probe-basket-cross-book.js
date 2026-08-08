#!/usr/bin/env node
// PROBE BASKET CROSS-BOOK — prend un match basket (par team-name search) et
// pour CHAQUE book qui supporte basket, dump les cotes Winner FT + Q1..Q4 +
// H1/H2. Detecte automatiquement les bugs "cotes identiques" (bug 1xBet Q1/Q2
// eleve au meme, ce serait grave si autres books souffrent du meme).
//
// Objectif user : "rassure-toi que le probleme ne soit pas sur les autres
// bookmakers" — verifier que le bug 1xBet est unique.
//
// Usage :
//   MATCH_SEARCH="Fu Jen" node scripts/probe-basket-cross-book.js
//   MATCH_SEARCH="Chicago" node scripts/probe-basket-cross-book.js
//   MATCH_SEARCH="WNBA" (moins precis)
import { bookmakers } from '../src/bookmakers/index.js';

const SEARCH = (process.env.MATCH_SEARCH || '').trim();
if (!SEARCH) {
  console.error('MATCH_SEARCH requis (ex: "Fu Jen", "Chicago", "Argentina")');
  process.exit(1);
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const matches = (m, q) => norm(m.home).includes(norm(q)) || norm(m.away).includes(norm(q));

console.log(`▶ PROBE BASKET CROSS-BOOK — search="${SEARCH}"\n`);

// Etape 1 : list all basket matches per book, find matching
const perBook = {};
await Promise.all(bookmakers.filter(b => b.supports.prematch).map(async (b) => {
  try {
    const list = await b.listMatches({ live: false, sport: 'basket' });
    const found = (list || []).filter(m => matches(m, SEARCH));
    perBook[b.key] = { book: b, list: found };
    if (found.length) console.log(`[${b.key}] catalog=${list?.length || 0} matched=${found.length} → ${found.map(m => `"${m.home} vs ${m.away}" (id=${m.id})`).join(' | ')}`);
    else console.log(`[${b.key}] catalog=${list?.length || 0} matched=0`);
  } catch (e) {
    console.log(`[${b.key}] listMatches ERR : ${e.message}`);
    perBook[b.key] = { book: b, list: [] };
  }
}));

const booksWithMatch = Object.entries(perBook).filter(([, v]) => v.list.length > 0);
if (!booksWithMatch.length) {
  console.log(`\n❌ Aucun book ne trouve le match "${SEARCH}" en prematch basket.`);
  process.exit(0);
}

console.log(`\n══════════════════════════════════════════════════════════`);
console.log(`ETAPE 2 : fetch cotes de chaque book pour le 1er match matche`);
console.log(`══════════════════════════════════════════════════════════`);

// Pour chaque book qui a trouvé le match, fetch fresh
const oddsPerBook = {};
for (const [key, { book, list }] of booksWithMatch) {
  const m = list[0];
  console.log(`\n[${key}] "${m.home} vs ${m.away}" (id=${m.id})`);
  try {
    const odds = await book.getOdds(m, { live: false, noCache: true, sport: 'basket' });
    oddsPerBook[key] = odds || {};
    const keys = Object.keys(oddsPerBook[key]).sort();
    // Focus : Winner FT, Q1-Q4, H1-H2 winners (les zones a risque bug duplicate)
    const focusKeys = keys.filter(k => /^(match_[12X]$|q[1-4]_match_[12X]$|h[12]_match_[12X]$)/.test(k));
    console.log(`  ${keys.length} cles totales, ${focusKeys.length} Winner (FT/Q/H) :`);
    for (const k of focusKeys) console.log(`     ${k.padEnd(20)} = ${oddsPerBook[key][k]}`);
    // Handicap/Total pour reference
    const otherHilite = keys.filter(k => /^(hcp_home_|match_over_|match_under_|q[1-4]_(over|under|hcp_home)_|h[12]_(over|under|hcp_home)_)/.test(k)).slice(0, 6);
    if (otherHilite.length) console.log(`  Extraits Handicap/Total : ${otherHilite.map(k => `${k}=${oddsPerBook[key][k]}`).join(' | ')}`);
  } catch (e) {
    console.log(`  ⚠️ getOdds ERR : ${e.message}`);
    oddsPerBook[key] = {};
  }
}

console.log(`\n══════════════════════════════════════════════════════════`);
console.log(`ETAPE 3 : DETECTION AUTO bugs "duplicate cotes"`);
console.log(`══════════════════════════════════════════════════════════`);
// Pour chaque book, verifier si des paires miroir (match_1/match_2, q1_match_1/2, etc.)
// ont exactement la meme valeur → indicateur de bug parseur ou placeholder non filtre.
const pairs = [
  ['match_1', 'match_2', 'Winner FT'],
  ['q1_match_1', 'q1_match_2', 'Q1 Winner'],
  ['q2_match_1', 'q2_match_2', 'Q2 Winner'],
  ['q3_match_1', 'q3_match_2', 'Q3 Winner'],
  ['q4_match_1', 'q4_match_2', 'Q4 Winner'],
  ['h1_match_1', 'h1_match_2', 'H1 Winner'],
  ['h2_match_1', 'h2_match_2', 'H2 Winner'],
];
let anyBug = false;
for (const [key, { }] of booksWithMatch) {
  const odds = oddsPerBook[key] || {};
  const flags = [];
  for (const [kA, kB, label] of pairs) {
    const a = odds[kA], b = odds[kB];
    if (a != null && b != null && a === b) {
      flags.push(`🚨 ${label} DUPLICATE (${kA}=${kB}=${a})`);
      anyBug = true;
    }
  }
  if (flags.length) console.log(`\n[${key}]  BUGS DETECTES :\n  ${flags.join('\n  ')}`);
  else if (Object.keys(odds).length) console.log(`\n[${key}] ✅ pas de duplicate detecte (${Object.keys(odds).length} cles)`);
  else console.log(`\n[${key}] ⚠️ aucune cote lue`);
}

console.log(`\n══════════════════════════════════════════════════════════`);
console.log(`ETAPE 4 : COMPARAISON cross-book par cle`);
console.log(`══════════════════════════════════════════════════════════`);
// Aggreger tous les books et pour chaque cle presente chez ≥2 books, afficher les cotes.
// Divergences suspectes (>>50%) = probable bug mapping.
const allKeys = new Set();
for (const key of Object.keys(oddsPerBook)) for (const k of Object.keys(oddsPerBook[key])) allKeys.add(k);
const focus = [...allKeys].filter(k => /^(match_[12X]|q[1-4]_match_[12]|h[12]_match_[12]|hcp_home_-?\d|match_over_\d|match_under_\d)/.test(k)).sort();
for (const k of focus) {
  const line = Object.entries(oddsPerBook).map(([key, o]) => o[k] != null ? `${key}=${o[k]}` : null).filter(Boolean);
  if (line.length >= 2) {
    // Detection divergence forte : ratio max/min > 1.5 sur meme cle
    const vals = line.map(s => Number(s.split('=')[1]));
    const ratio = Math.max(...vals) / Math.min(...vals);
    const flag = ratio > 2.0 ? '  🚨 DIVERGENCE FORTE' : ratio > 1.5 ? '  ⚠️ divergence' : '';
    console.log(`  ${k.padEnd(24)} ${line.join(' | ')}${flag}`);
  }
}

console.log(`\n✅ Fin probe. ${anyBug ? '🚨 BUGS DETECTES ci-dessus.' : '✅ Aucun bug duplicate detecte.'}`);
process.exit(0);
