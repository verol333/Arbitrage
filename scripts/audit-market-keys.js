// Audit des clés d'odds émises par chaque book sur 3 matches foot random.
// Vérifie que les clés SONT bien standardisées (match_1, dc_1X, over_X.X, hcp_home_X, etc.)
// et repère les clés non-standard qui échapperaient au comparateur.
import { bookmakers } from '../src/bookmakers/index.js';

const STANDARD_PATTERNS = [
  /^match_[12X]$/, /^dc_(1X|12|X2)$/, /^btts_(yes|no)$/, /^dnb_[12]$/,
  /^(match_)?over_\d+(\.\d+)?$/, /^(match_)?under_\d+(\.\d+)?$/,
  /^hcp_(home|away)_-?\d+(\.\d+)?$/, /^tt_(home|away)_(over|under)_\d+(\.\d+)?$/,
  /^ht_(match_[12X]|dc_(1X|12|X2)|btts_(yes|no)|over_\d+(\.\d+)?|under_\d+(\.\d+)?|hcp_(home|away)_-?\d+(\.\d+)?|odd|even)$/,
  /^h2_(match_[12X]|dc_(1X|12|X2)|btts_(yes|no)|over_\d+(\.\d+)?|under_\d+(\.\d+)?|hcp_(home|away)_-?\d+(\.\d+)?|odd|even)$/,
  /^cor_(over_\d+(\.\d+)?|under_\d+(\.\d+)?|hcp_(home|away)_-?\d+(\.\d+)?|odd|even|ht_(over|under)_\d+(\.\d+)?)$/,
  /^(odd|even|half_most_(ht|equal|h2))$/,
];
const isStandard = (k) => STANDARD_PATTERNS.some((r) => r.test(k));

const results = {};
for (const book of bookmakers) {
  if (!book.supports.prematch) continue;
  try {
    const matches = await book.listMatches({ sport: 'football', horizonHours: 168 });
    const sample = matches.slice(0, 2);
    const allKeys = new Set();
    const nonStd = new Set();
    for (const m of sample) {
      const odds = book.getOddsBatch
        ? (await book.getOddsBatch(sample, { sport: 'football' })).get(m.id) || {}
        : await book.getOdds(m, { sport: 'football' });
      for (const k of Object.keys(odds || {})) {
        allKeys.add(k);
        if (!isStandard(k)) nonStd.add(k);
      }
      if (book.getOddsBatch) break; // batch fait tout
    }
    results[book.key] = { total_keys: allKeys.size, nonStd: [...nonStd], samples: [...allKeys].slice(0, 15) };
  } catch (e) { results[book.key] = { error: e.message }; }
}

console.log('=== MARKET KEYS AUDIT PAR BOOK ===\n');
for (const [b, r] of Object.entries(results)) {
  if (r.error) { console.log(`${b}: ERR ${r.error}`); continue; }
  console.log(`${b}: total=${r.total_keys} nonStandard=${r.nonStd.length}`);
  if (r.nonStd.length) console.log(`   ⚠️  non-standard: ${r.nonStd.slice(0, 20).join(', ')}`);
  console.log(`   samples: ${r.samples.join(', ')}\n`);
}
// Union / intersection cross-book (top clés)
console.log('=== CROSS-BOOK KEY COVERAGE ===');
const keyToBooks = new Map();
for (const [b, r] of Object.entries(results)) {
  if (!r.samples) continue;
  for (const k of r.samples) {
    if (!keyToBooks.has(k)) keyToBooks.set(k, []);
    keyToBooks.get(k).push(b);
  }
}
const sorted = [...keyToBooks.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 30);
for (const [k, bs] of sorted) console.log(`  ${k.padEnd(25)} ${bs.length}× [${bs.join(',')}]`);
process.exit(0);
