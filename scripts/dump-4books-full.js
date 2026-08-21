#!/usr/bin/env node
// ÉTAPE 1 UNIQUEMENT : dump complet des marchés sur 2 matchs × 4 books.
// Aucune analyse. Sauvegarde en JSON structuré + affichage console.
// Le fichier JSON est uploadé comme artifact GitHub pour réutilisation étape 2.
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const BOOKS = ['1xbet', '1win', 'congobet', 'betpawa'];
const TOP_MATCHES = 2;

console.log('═══════════════════════════════════════════════════════════════');
console.log('  ÉTAPE 1 : DUMP COMPLET DES MARCHÉS');
console.log(`  Books : ${BOOKS.join(', ')}`);
console.log(`  Matchs : top ${TOP_MATCHES} présents sur ≥4 books`);
console.log('═══════════════════════════════════════════════════════════════\n');

// 1. Liste matchs par book
const catalogs = new Map();
for (const key of BOOKS) {
  const book = bookmakersByKey[key];
  if (!book) { console.log(`[${key}] not in registry`); continue; }
  try {
    const matches = await book.listMatches({ live: false, sport: 'football', horizonHours: 30 });
    catalogs.set(key, matches);
    console.log(`[${key}] ${matches.length} matchs listés`);
  } catch (e) { console.log(`[${key}] KO ${e.message}`); }
}

// 2. Alignement (matchs communs aux 4)
const entries = alignCatalogs(catalogs, { minBooks: 4, horizonMs: Date.now() + 30 * 3600 * 1000 });
entries.sort((a, b) => Object.keys(b.matches).length - Object.keys(a.matches).length);
const top = entries.slice(0, TOP_MATCHES);
console.log(`\n${top.length} matchs sur ≥4 books sélectionnés :`);
for (const e of top) console.log(`  ${e.ref.home} vs ${e.ref.away} — ${e.ref.start ? new Date(e.ref.start).toISOString() : 'no start'}`);

// 3. Fetch odds via connecteurs prod
const dump = { generated_at: new Date().toISOString(), books: BOOKS, matches: [] };
for (const entry of top) {
  const rec = {
    home: entry.ref.home,
    away: entry.ref.away,
    start: entry.ref.start ? new Date(entry.ref.start).toISOString() : null,
    league: entry.ref.league || null,
    match_ids: {},
    odds: {}, // { book: { marketKey: cote } }
  };
  console.log(`\n▓▓ ${entry.ref.home} vs ${entry.ref.away}`);
  for (const [bookKey, m] of Object.entries(entry.matches)) {
    const book = bookmakersByKey[bookKey];
    if (!book) continue;
    rec.match_ids[bookKey] = m.id;
    try {
      const odds = await book.getOdds(m, { live: false, sport: 'football' });
      const clean = {};
      if (odds) for (const [k, v] of Object.entries(odds)) {
        if (k.startsWith('_')) continue;
        if (typeof v === 'number' && v > 1) clean[k] = v;
      }
      rec.odds[bookKey] = clean;
      console.log(`  [${bookKey}] ${Object.keys(clean).length} marchés récupérés`);
    } catch (e) {
      console.log(`  [${bookKey}] KO ${e.message}`);
      rec.odds[bookKey] = {};
    }
  }
  dump.matches.push(rec);
}

// 4. Sauvegarde JSON
mkdirSync('output', { recursive: true });
const filename = `output/4books-full-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
writeFileSync(filename, JSON.stringify(dump, null, 2));
console.log(`\n✅ JSON sauvegardé : ${filename}`);
console.log(`   Taille : ${(JSON.stringify(dump).length / 1024).toFixed(1)} KB`);

// 5. Affichage tableau cross-book
for (const rec of dump.matches) {
  console.log(`\n═══ ${rec.home} vs ${rec.away} ═══`);
  const allKeys = new Set();
  for (const b of Object.values(rec.odds)) for (const k of Object.keys(b)) allKeys.add(k);
  const sorted = [...allKeys].sort();
  console.log(`Total marchés uniques (union 4 books) : ${sorted.length}`);
  console.log(`\nKEY${' '.repeat(37)}| ${BOOKS.map(b => b.padStart(8)).join(' | ')}`);
  console.log('-'.repeat(82));
  for (const k of sorted) {
    const row = BOOKS.map(b => {
      const v = rec.odds[b]?.[k];
      return v != null ? v.toFixed(2).padStart(8) : '   -    ';
    });
    console.log(`${k.padEnd(40)}| ${row.join(' | ')}`);
  }
}

console.log(`\n═══ ÉTAPE 1 TERMINÉE ═══`);
console.log(`   JSON : ${filename}`);
console.log(`   Attend feu vert utilisateur pour étape 2 (cartographie opportunités).`);
process.exit(0);
