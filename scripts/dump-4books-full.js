#!/usr/bin/env node
// Dump COMPLET des marches sur 2 matchs, 4 books (1xbet, 1win, congobet, betpawa).
// Utilise DIRECTEMENT les parseurs de prod (bookmakerByKey.getOdds) qui produisent
// des cles normalisees (deja mappees). Puis analyse combinatoire au dessus.
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';

const BOOKS = ['1xbet', '1win', 'congobet', 'betpawa'];
const TOP_MATCHES = 2;

console.log('═══════════════════════════════════════════════════════════════');
console.log('  DUMP 4 BOOKS × 2 MATCHS × TOUS MARCHES (via parseurs prod)');
console.log(`  Books : ${BOOKS.join(', ')}`);
console.log('═══════════════════════════════════════════════════════════════\n');

// 1. Liste matchs
const catalogs = new Map();
for (const key of BOOKS) {
  const book = bookmakersByKey[key];
  if (!book) { console.log(`[${key}] not in registry`); continue; }
  try {
    const matches = await book.listMatches({ live: false, sport: 'football', horizonHours: 30 });
    catalogs.set(key, matches);
    console.log(`[${key}] ${matches.length} matchs`);
  } catch (e) { console.log(`[${key}] KO ${e.message}`); }
}

// 2. Aligne pour trouver matchs communs aux 4
const entries = alignCatalogs(catalogs, { minBooks: 4, horizonMs: Date.now() + 30 * 3600 * 1000 });
entries.sort((a,b) => Object.keys(b.matches).length - Object.keys(a.matches).length);
const top = entries.slice(0, TOP_MATCHES);
console.log(`\n${top.length} matchs presents sur >=4 books :`);
for (const e of top) console.log(`  ${e.ref.home} vs ${e.ref.away} — ${Object.keys(e.matches).length} books — ${e.ref.start ? new Date(e.ref.start).toISOString() : 'no start'}`);

// Store des cotes par match
const data = []; // [{ home, away, byBook: { book: { key: odds } } }]

// 3. getOdds pour chaque match/book (via connecteur prod)
for (const entry of top) {
  const rec = { home: entry.ref.home, away: entry.ref.away, byBook: {} };
  console.log(`\n▓▓ ${entry.ref.home} vs ${entry.ref.away}`);
  // 1win a un getOddsBatch — on utilise getOdds pour rester simple
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
      rec.byBook[bookKey] = clean;
      console.log(`  [${bookKey}] ${Object.keys(clean).length} cles`);
    } catch (e) {
      console.log(`  [${bookKey}] KO ${e.message}`);
      rec.byBook[bookKey] = {};
    }
  }
  data.push(rec);
}

// 4. Rapport : pour chaque match, liste toutes les cles avec cotes par book cote a cote
console.log(`\n═══════════════════════════════════════════════════════════════`);
console.log(`  TABLEAU CROSS-BOOK PAR MATCH`);
console.log(`═══════════════════════════════════════════════════════════════`);
for (const rec of data) {
  console.log(`\n▓▓ ${rec.home} vs ${rec.away}`);
  const allKeys = new Set();
  for (const b of Object.values(rec.byBook)) for (const k of Object.keys(b)) allKeys.add(k);
  const sorted = [...allKeys].sort();
  const header = `KEY${' '.repeat(37)}| ${BOOKS.map(b => b.padStart(8)).join(' | ')}`;
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const k of sorted) {
    const row = BOOKS.map(b => {
      const v = rec.byBook[b]?.[k];
      return v != null ? v.toFixed(2).padStart(8) : '   -    ';
    });
    console.log(`${k.padEnd(40)}| ${row.join(' | ')}`);
  }
}

// 5. Analyse arbitrage classique (meme cle sur plusieurs books)
console.log(`\n═══════════════════════════════════════════════════════════════`);
console.log(`  OPPORTUNITES DETECTEES (>=2 books meme cle, sum(1/odds)<1)`);
console.log(`═══════════════════════════════════════════════════════════════\n`);
const arbOpps = [];
for (const rec of data) {
  const keySet = new Set();
  for (const b of Object.values(rec.byBook)) for (const k of Object.keys(b)) keySet.add(k);
  for (const k of keySet) {
    const cotes = [];
    for (const b of BOOKS) if (rec.byBook[b]?.[k] != null) cotes.push({ book: b, key: k, odds: rec.byBook[b][k] });
    if (cotes.length < 2) continue;
    // Pour un arb 2-way on a besoin de la CONTRE-cle (ex: match_1 vs match_2 + match_x)
    // Pour un arb multi-book simple sur meme cle : meilleur odds vs 1/n (parfait tie)
    // Simplification : on liste juste les gros ecarts entre books (>= 20% ecart)
    const max = Math.max(...cotes.map(c => c.odds));
    const min = Math.min(...cotes.map(c => c.odds));
    if (max / min >= 1.20 && max >= 1.5) {
      arbOpps.push({ match: `${rec.home} vs ${rec.away}`, key: k, cotes, spread: (max/min - 1) * 100 });
    }
  }
}
arbOpps.sort((a,b) => b.spread - a.spread);
console.log(`${arbOpps.length} sélections avec écart >= 20% cross-book :\n`);
for (const [i, op] of arbOpps.slice(0, 30).entries()) {
  console.log(`#${i+1} ${op.match} — ${op.key} — écart ${op.spread.toFixed(1)}%`);
  for (const c of op.cotes) console.log(`  [${c.book.padEnd(10)}] @ ${c.odds.toFixed(2)}`);
  console.log('');
}

console.log('Fin.');
process.exit(0);
