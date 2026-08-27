#!/usr/bin/env node
// RECENSEMENT FOOTBALL — quelles familles de marches chaque book expose reellement,
// et sur combien de matchs deux books au moins exposent la meme famille.
// C'est la mesure du carburant disponible : sans deux books sur une meme famille,
// aucune partition d'issues n'est possible, donc aucun arbitrage.
//
// Ne place rien, ne modifie rien : lecture seule + rapport docs/foot-market-census.md
import { writeFileSync, mkdirSync } from 'node:fs';
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';
import { rawOutcomes, RAW_BOOKS } from '../src/foot/rawOutcomes.js';
import { classify, GRID_FAMILIES } from '../src/foot/families.js';

const TOP_MATCHES = Number(process.env.TOP_MATCHES || 15);
const HORIZON_HOURS = Number(process.env.HORIZON_HOURS || 48);
const MIN_BOOKS = Number(process.env.MIN_BOOKS || 2);

const t0 = Date.now();
console.log('=== RECENSEMENT MARCHES FOOTBALL ===');
console.log('books   : ' + RAW_BOOKS.join(', '));
console.log('matchs  : ' + TOP_MATCHES + ' | horizon ' + HORIZON_HOURS + 'h');

// 1. Catalogues football par book
const catalogs = new Map();
for (const key of RAW_BOOKS) {
  const book = bookmakersByKey[key];
  if (!book) { console.log('[' + key + '] absent du registre'); continue; }
  try {
    const matches = await book.listMatches({ live: false, sport: 'football', horizonHours: HORIZON_HOURS });
    catalogs.set(key, matches);
    console.log('[' + key + '] ' + matches.length + ' matchs listes');
  } catch (e) {
    console.log('[' + key + '] listMatches KO : ' + e.message);
  }
}

// 2. Matchs presents chez le plus de books
const entries = alignCatalogs(catalogs, { minBooks: MIN_BOOKS, horizonMs: Date.now() + HORIZON_HOURS * 3600 * 1000 });
entries.sort((a, b) => {
  const d = Object.keys(b.matches).length - Object.keys(a.matches).length;
  return d !== 0 ? d : (a.ref.start || 0) - (b.ref.start || 0);
});
const targets = entries.slice(0, TOP_MATCHES);
console.log('\n' + entries.length + ' matchs apparies, ' + targets.length + ' retenus\n');

// 3. Lecture brute + classification
const bookStats = new Map(RAW_BOOKS.map((k) => [k, { matches: 0, withData: 0, outcomes: 0, errors: new Map(), families: new Map() }]));
const familyMatchBooks = new Map(); // famille -> [nb books] par match
const unknownNames = new Map();     // libelle brut non classe -> { count, books:Set }

for (const entry of targets) {
  const label = entry.ref.home + ' vs ' + entry.ref.away;
  const perBook = await Promise.all(
    Object.entries(entry.matches).map(async ([key, m]) => {
      if (!RAW_BOOKS.includes(key)) return null;
      const { outcomes, error } = await rawOutcomes(key, m.id);
      return { key, outcomes, error };
    })
  );
  const famBooks = new Map(); // famille -> Set(book)
  for (const r of perBook) {
    if (!r) continue;
    const st = bookStats.get(r.key);
    st.matches += 1;
    if (r.error) { st.errors.set(r.error, (st.errors.get(r.error) || 0) + 1); }
    if (r.outcomes.length) st.withData += 1;
    st.outcomes += r.outcomes.length;
    const seen = new Set();
    for (const o of r.outcomes) {
      const fam = classify(o.market, o.selection);
      seen.add(fam);
      if (fam === 'OTHER') {
        const u = unknownNames.get(o.market) || { count: 0, books: new Set() };
        u.count += 1; u.books.add(r.key);
        unknownNames.set(o.market, u);
      }
    }
    for (const fam of seen) {
      st.families.set(fam, (st.families.get(fam) || 0) + 1);
      if (!famBooks.has(fam)) famBooks.set(fam, new Set());
      famBooks.get(fam).add(r.key);
    }
  }
  for (const [fam, books] of famBooks) {
    if (!familyMatchBooks.has(fam)) familyMatchBooks.set(fam, []);
    familyMatchBooks.get(fam).push(books.size);
  }
  const covered = [...famBooks].filter(([, b]) => b.size >= 2).length;
  console.log(label.padEnd(42) + ' | familles chez 2+ books : ' + covered);
}

// 4. Rapport
const rows = [...familyMatchBooks.entries()].map(([fam, counts]) => ({
  fam,
  grid: GRID_FAMILIES.has(fam),
  present: counts.length,
  duo: counts.filter((n) => n >= 2).length,
  trio: counts.filter((n) => n >= 3).length,
  maxBooks: Math.max(...counts),
})).sort((a, b) => b.duo - a.duo || b.present - a.present);

const md = [];
md.push('# Recensement des marches football');
md.push('');
md.push('Genere : ' + new Date().toISOString());
md.push('Matchs analyses : ' + targets.length + ' | horizon ' + HORIZON_HOURS + 'h | duree ' + Math.round((Date.now() - t0) / 1000) + 's');
md.push('');
md.push('## Couverture par bookmaker');
md.push('');
md.push('| Book | Matchs | Avec cotes | Outcomes/match | Erreurs |');
md.push('|---|---:|---:|---:|---|');
for (const [key, st] of bookStats) {
  const errs = [...st.errors.entries()].map(([e, n]) => e + ' x' + n).join(' ; ') || '-';
  const avg = st.withData ? Math.round(st.outcomes / st.withData) : 0;
  md.push('| ' + key + ' | ' + st.matches + ' | ' + st.withData + ' | ' + avg + ' | ' + errs.slice(0, 120) + ' |');
}
md.push('');
md.push('## Familles de marches — potentiel de partition');
md.push('');
md.push('`2+ books` = nombre de matchs ou au moins deux books cotent cette famille : c est la seule colonne qui cree des opportunites.');
md.push('');
md.push('| Famille | Grille | Matchs | 2+ books | 3+ books | Max books |');
md.push('|---|:--:|---:|---:|---:|---:|');
for (const r of rows) {
  md.push('| ' + r.fam + ' | ' + (r.grid ? 'oui' : '-') + ' | ' + r.present + ' | ' + r.duo + ' | ' + r.trio + ' | ' + r.maxBooks + ' |');
}
md.push('');
md.push('## Marches non classes (a integrer si utiles)');
md.push('');
md.push('| Libelle natif | Occurrences | Books |');
md.push('|---|---:|---|');
const unknown = [...unknownNames.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 60);
for (const [name, u] of unknown) {
  md.push('| ' + name.replace(/\|/g, '/').slice(0, 70) + ' | ' + u.count + ' | ' + [...u.books].join(', ') + ' |');
}
md.push('');

mkdirSync('docs', { recursive: true });
writeFileSync('docs/foot-market-census.md', md.join('\n'));
console.log('\nRapport ecrit : docs/foot-market-census.md');
console.log('Familles exploitables chez 2+ books : ' + rows.filter((r) => r.grid && r.duo > 0).length);
