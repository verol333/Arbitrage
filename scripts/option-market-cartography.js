#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// ÉTAPE 2 — CARTOGRAPHIE DES MARCHÉS À OPTIONS + DÉTECTION D'ARBITRAGE.
//
// Lit le dump produit par dump-option-markets.js, traduit chaque cote en
// clé canonique (module lib/optionMarketKeys.js), puis répond aux deux
// seules questions qui comptent :
//   1. quels marchés à options existent chez AU MOINS 2 books (donc
//      appariables) ?
//   2. sur ces marchés, un couple de books couvre-t-il toutes les issues
//      avec une marge positive (opportunité réelle) ?
//
//   node scripts/option-market-cartography.js
// ═══════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { canonicalize } from './lib/optionMarketKeys.js';

const IN = path.resolve('scripts/out/option-markets-dump.json');
if (!fs.existsSync(IN)) {
  console.log('Dump absent — lancer d\'abord : node scripts/dump-option-markets.js');
  process.exit(1);
}
const dump = JSON.parse(fs.readFileSync(IN, 'utf8'));

console.log('═══════════════════════════════════════════════════');
console.log(`  CARTOGRAPHIE MARCHÉS À OPTIONS — ${dump.match}`);
console.log('═══════════════════════════════════════════════════\n');

// 1. Canonisation : set → outcome → book → meilleure cote.
const sets = new Map(); // set → { family, size, outcomes: Map(outcome → Map(book → {odds, market, selection})) }
const rejected = new Map(); // libellés non reconnus (pour élargir le mapping)

for (const [book, data] of Object.entries(dump.books || {})) {
  for (const row of data.rows || []) {
    const k = canonicalize(row);
    if (!k) {
      rejected.set(row.market, (rejected.get(row.market) || 0) + 1);
      continue;
    }
    if (!sets.has(k.set)) sets.set(k.set, { family: k.family, size: k.size, outcomes: new Map() });
    const s = sets.get(k.set);
    if (!s.outcomes.has(k.outcome)) s.outcomes.set(k.outcome, new Map());
    const byBook = s.outcomes.get(k.outcome);
    const prev = byBook.get(book);
    if (!prev || row.odds > prev.odds) byBook.set(book, { odds: row.odds, market: row.market, selection: row.selection });
  }
}

// 2. Marchés appariables : présents chez ≥ 2 books.
const shared = [];
for (const [key, s] of sets) {
  const books = new Set();
  for (const byBook of s.outcomes.values()) for (const b of byBook.keys()) books.add(b);
  if (books.size >= 2) shared.push({ key, ...s, books: [...books] });
}
shared.sort((a, b) => b.books.length - a.books.length || a.key.localeCompare(b.key));

console.log(`${shared.length} marchés à options présents chez au moins 2 books :\n`);
const byFamily = new Map();
for (const s of shared) byFamily.set(s.family, (byFamily.get(s.family) || 0) + 1);
for (const [f, n] of [...byFamily].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${f}`);

// 3. Arbitrage : ensemble complet + meilleure cote par issue, tous books confondus.
const opportunities = [];
for (const s of shared) {
  if (s.outcomes.size < s.size) continue; // ensemble incomplet → non couvrable
  const legs = [];
  for (const [outcome, byBook] of s.outcomes) {
    let best = null;
    for (const [book, v] of byBook) if (!best || v.odds > best.odds) best = { book, outcome, ...v };
    legs.push(best);
  }
  const booksUsed = new Set(legs.map((l) => l.book));
  if (booksUsed.size < 2) continue; // un seul book = pas d'arbitrage
  const inv = legs.reduce((acc, l) => acc + 1 / l.odds, 0);
  if (inv >= 1) continue;
  opportunities.push({ key: s.key, family: s.family, profit: (1 / inv - 1) * 100, legs });
}
opportunities.sort((a, b) => b.profit - a.profit);

console.log(`\n─── OPPORTUNITÉS DÉTECTÉES : ${opportunities.length} ───\n`);
for (const o of opportunities.slice(0, 25)) {
  console.log(`+${o.profit.toFixed(2)}%  ${o.key}  [${o.family}]`);
  for (const l of o.legs) console.log(`      ${l.book.padEnd(9)} ${l.odds.toFixed(2).padStart(6)}  ${l.market} → ${l.selection}`);
  console.log('');
}
if (!opportunities.length) console.log('Aucune couverture rentable sur ce match.\n');

// 4. Marchés jetés : la liste sert à élargir le mapping au prochain tour.
const top = [...rejected].sort((a, b) => b[1] - a[1]).slice(0, 30);
console.log('─── LIBELLÉS NON RECONNUS (top 30) ───');
for (const [label, n] of top) console.log(`  ${String(n).padStart(4)}  ${label}`);
