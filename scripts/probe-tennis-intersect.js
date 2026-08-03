#!/usr/bin/env node
// PROBE tennis : pourquoi 0 opps ? Prend 3 matchs communs a >=3 books,
// dump TOUTES les cles d'odds cote a cote. But : voir si les cles se
// recoupent entre books (ex : 1xbet hcp_home_2.5 vs congobet hcp_home_+2.5)
// ou si les parseurs produisent des cles disjointes.

import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';

const BOOKS = ['1xbet', 'congobet', 'apollo', 'betmomo', 'sportybet'];
const SPORT = 'tennis';

console.log('▶▶▶ PROBE tennis intersection cles cross-book');

// 1) Liste les matchs de chaque book
const catalogs = new Map();
for (const bk of BOOKS) {
  const b = bookmakersByKey[bk];
  if (!b) { console.log(`skip ${bk}`); continue; }
  try {
    const m = await b.listMatches({ live: false, horizonHours: 48, sport: SPORT });
    catalogs.set(bk, m);
    console.log(`  ${bk}: ${m.length} matchs`);
  } catch (e) { console.log(`  ${bk} ERR ${e.message}`); }
}

// 2) Align
const entries = alignCatalogs(catalogs, {});
console.log(`\n${entries.length} entrees alignees`);

// 3) Filtre entrees avec >= 3 books
const rich = entries.filter(e => Object.keys(e.matches || {}).length >= 3);
console.log(`${rich.length} entrees a >=3 books\n`);

if (!rich.length) {
  console.log('❌ Aucun match a >=3 books. Le matching (alignCatalogs) est le probleme.');
  console.log('Top 5 entrees alignees (2 books) :');
  for (const e of entries.slice(0, 5)) {
    console.log(`  "${e.ref?.home}" vs "${e.ref?.away}" (${Object.keys(e.matches || {}).join(',')})`);
  }
  process.exit(0);
}

// 4) Prendre top 3
const sample = rich.slice(0, 3);

for (const entry of sample) {
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`MATCH: "${entry.ref?.home}" vs "${entry.ref?.away}"`);
  console.log(`  Books: ${Object.keys(entry.matches).join(', ')}`);

  const oddsByBook = new Map();
  for (const [bk, mObj] of Object.entries(entry.matches)) {
    const b = bookmakersByKey[bk];
    try {
      const o = await b.getOdds({ id: mObj.id, home: mObj.home, away: mObj.away }, { live: false, sport: SPORT, noCache: true });
      oddsByBook.set(bk, o || {});
    } catch (e) { oddsByBook.set(bk, { __err: e.message }); }
  }

  // Union des cles
  const allKeys = new Set();
  for (const [, odds] of oddsByBook) {
    if (odds.__err) continue;
    for (const k of Object.keys(odds)) allKeys.add(k);
  }

  console.log(`\n  ${allKeys.size} cles distinctes tous books confondus`);
  console.log(`  Cles par book: ${[...oddsByBook.entries()].map(([b, o]) => `${b}=${Object.keys(o || {}).length}`).join(' | ')}`);

  // Table cote a cote
  const sortedKeys = [...allKeys].sort();
  const bookList = [...oddsByBook.keys()];
  console.log(`\n  ${'KEY'.padEnd(28)} ${bookList.map(b => b.padEnd(9)).join('')}`);
  console.log(`  ${'-'.repeat(28)} ${bookList.map(() => '---------').join('')}`);
  let intersectCount = 0;
  for (const k of sortedKeys) {
    const vals = bookList.map(b => {
      const v = oddsByBook.get(b)?.[k];
      return v == null ? '   —     ' : String(v).padEnd(9);
    });
    const nonNull = vals.filter(v => v.trim() !== '—').length;
    if (nonNull >= 2) intersectCount++;
    // Marquer les cles qui intersectent >=2 books
    const marker = nonNull >= 2 ? '✅' : '  ';
    console.log(`  ${marker}${k.padEnd(28)} ${vals.join('')}`);
  }
  console.log(`\n  🔍 Cles intersectant >=2 books : ${intersectCount}/${allKeys.size}`);
}

console.log('\n═══ FIN PROBE ═══');
