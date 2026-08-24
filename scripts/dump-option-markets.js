#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// ÉTAPE 1 — DUMP DES MARCHÉS D'UN MATCH POPULAIRE (4 books principaux).
//
// On abandonne les scores exacts : ils ne produisent rien. On va chercher
// les marchés "à options" (Moment du 2e but, Gagner au moins une mi-temps,
// But dans l'intervalle, Résultat + Total…). Ce script prend LE match le
// plus populaire, aspire TOUS les marchés bruts book par book, et écrit un
// fichier JSON exploité ensuite par option-market-cartography.js.
//
//   node scripts/dump-option-markets.js
// ═══════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';
import { OPTION_BOOKS, rawMarkets } from './lib/rawOptionMarkets.js';

const OUT = path.resolve('scripts/out/option-markets-dump.json');

console.log('═══════════════════════════════════════════════════');
console.log('  DUMP MARCHÉS À OPTIONS — ' + OPTION_BOOKS.join(', '));
console.log('═══════════════════════════════════════════════════\n');

// 1. Catalogues préma des 4 books.
const catalogs = new Map();
for (const key of OPTION_BOOKS) {
  const book = bookmakersByKey[key];
  if (!book) { console.log(`[${key}] absent du registre`); continue; }
  try {
    const matches = await book.listMatches({ live: false, sport: 'football', horizonHours: 48 });
    catalogs.set(key, matches);
    console.log(`[${key}] ${matches.length} matchs`);
  } catch (e) {
    console.log(`[${key}] listMatches KO : ${e.message}`);
  }
}

// 2. Le match présent sur le plus de books, le plus proche dans le temps.
const entries = alignCatalogs(catalogs, { minBooks: 3, horizonMs: Date.now() + 48 * 3600 * 1000 });
entries.sort((a, b) => {
  const d = Object.keys(b.matches).length - Object.keys(a.matches).length;
  return d !== 0 ? d : (a.ref.start || 0) - (b.ref.start || 0);
});
const entry = entries[0];
if (!entry) { console.log('\nAucun match commun trouvé — réessayer plus tard.'); process.exit(1); }

const label = `${entry.ref.home} vs ${entry.ref.away}`;
console.log(`\nMatch retenu : ${label} — ${Object.keys(entry.matches).length} books\n`);

// 3. Aspiration brute, book par book.
const dump = { match: label, kickoff: entry.ref.start ? new Date(entry.ref.start).toISOString() : null, books: {} };
for (const key of OPTION_BOOKS) {
  const m = entry.matches[key];
  if (!m) { console.log(`[${key}] pas de correspondance`); continue; }
  const res = await rawMarkets(key, m.id);
  if (!res.ok) { console.log(`[${key}] ${res.error}`); continue; }
  const families = [...new Set(res.rows.map((r) => r.market))];
  dump.books[key] = { match_id: String(m.id), rows: res.rows, nb_markets: families.length, nb_odds: res.rows.length };
  console.log(`[${key}] ${families.length} marchés / ${res.rows.length} cotes`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(dump, null, 2));
console.log(`\nÉcrit : ${OUT}`);
console.log('Étape suivante : node scripts/option-market-cartography.js');
