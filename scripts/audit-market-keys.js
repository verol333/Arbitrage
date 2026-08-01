// Audit couverture marchés : matrice bookmaker × famille de marché (football).
// Pour chaque book, échantillonne N matchs, extrait les cotes, et classe les
// clés dans des familles. Rend un tableau lisible en un coup d'œil : "quel
// book expose quoi ?". Sert de check-list après chaque changement de parser.
import { bookmakers } from '../src/bookmakers/index.js';

const SAMPLE = 5;
const FAMILIES = {
  '1X2':          (k) => /^match_[12X]$/.test(k),
  'DC':           (k) => /^dc_(1X|12|X2)$/.test(k),
  'DNB':          (k) => /^dnb_[12]$/.test(k),
  'BTTS':         (k) => /^btts_(yes|no)$/.test(k),
  'Total':        (k) => /^match_(over|under)_\d/.test(k),
  'TeamTotal':    (k) => /^tt_(home|away)_(over|under)_\d/.test(k),
  'Handicap':     (k) => /^hcp_(home|away)_-?\d/.test(k),
  'OddEven':      (k) => /^(odd|even)$/.test(k),
  '1MT 1X2':      (k) => /^ht_match_[12X]$/.test(k),
  '1MT DC':       (k) => /^ht_dc_(1X|12|X2)$/.test(k),
  '1MT BTTS':     (k) => /^ht_btts_(yes|no)$/.test(k),
  '1MT DNB':      (k) => /^ht_dnb_[12]$/.test(k),
  '1MT Total':    (k) => /^ht_(over|under)_\d/.test(k),
  '1MT TT':       (k) => /^ht_tt_(home|away)_(over|under)_\d/.test(k),
  '1MT HCP':      (k) => /^ht_hcp_(home|away)_-?\d/.test(k),
  '1MT O/E':      (k) => /^ht_(odd|even)$/.test(k),
  '2MT 1X2':      (k) => /^h2_match_[12X]$/.test(k),
  '2MT DC':       (k) => /^h2_dc_(1X|12|X2)$/.test(k),
  '2MT BTTS':     (k) => /^h2_btts_(yes|no)$/.test(k),
  '2MT DNB':      (k) => /^h2_dnb_[12]$/.test(k),
  '2MT Total':    (k) => /^h2_(over|under)_\d/.test(k),
  'Corners Tot':  (k) => /^cor_(over|under)_\d/.test(k),
  'Corners HCP':  (k) => /^cor_hcp_(home|away)_-?\d/.test(k),
  'Corners O/E':  (k) => /^cor_(odd|even)$/.test(k),
  'MostGoals':    (k) => /^half_most_(ht|h2|equal)$/.test(k),
  'FirstScore':   (k) => /^fts_(home|away|none)$/.test(k),
};
const FAM_NAMES = Object.keys(FAMILIES);
const nonStandard = (k) => !Object.values(FAMILIES).some((fn) => fn(k));

async function auditBook(book) {
  try {
    const matches = await book.listMatches({ sport: 'football', horizonHours: 168 });
    if (!matches.length) return { listed: 0, sample: 0, families: {}, nonStd: [], total: 0 };
    const sample = matches.slice(0, SAMPLE);
    let batch = null;
    if (book.getOddsBatch) batch = await book.getOddsBatch(sample, { sport: 'football' });
    const perMatch = [];
    for (const m of sample) {
      const odds = batch ? (batch.get(m.id) || {}) : (await book.getOdds(m, { sport: 'football' }) || {});
      perMatch.push({ id: m.id, home: m.home, away: m.away, odds });
    }
    // Compte par famille : combien de matchs (sur SAMPLE) ont au moins une clé de cette famille.
    const famCount = {};
    for (const fam of FAM_NAMES) famCount[fam] = 0;
    const nonStd = new Set();
    let totalKeys = 0;
    for (const { odds } of perMatch) {
      const seenFams = new Set();
      for (const k of Object.keys(odds)) {
        totalKeys++;
        if (nonStandard(k)) nonStd.add(k);
        for (const fam of FAM_NAMES) if (FAMILIES[fam](k)) seenFams.add(fam);
      }
      for (const fam of seenFams) famCount[fam]++;
    }
    return { listed: matches.length, sample: perMatch.length, families: famCount, nonStd: [...nonStd].slice(0, 15), total: totalKeys };
  } catch (e) { return { error: e.message }; }
}

console.log(`=== AUDIT COUVERTURE MARCHÉS (foot, ${SAMPLE} matchs / book) ===\n`);
const results = {};
for (const book of bookmakers) {
  if (!book.supports.prematch) { results[book.key] = { skipped: 'no prematch' }; continue; }
  process.stdout.write(`  ${book.key.padEnd(12)} `);
  const r = await auditBook(book);
  results[book.key] = r;
  if (r.error) console.log(`ERR ${r.error}`);
  else if (r.listed === 0) console.log('0 matchs listés');
  else console.log(`${r.listed} matchs listés, ${r.sample}/${SAMPLE} échantillonnés, ${r.total} clés au total`);
}

console.log(`\n=== MATRICE (chiffre = /${SAMPLE} matchs qui exposent la famille) ===\n`);
const books = Object.keys(results).filter((b) => results[b].families);
const HEADER = 'FAMILY'.padEnd(15) + books.map((b) => b.slice(0, 8).padStart(9)).join('');
console.log(HEADER);
console.log('-'.repeat(HEADER.length));
for (const fam of FAM_NAMES) {
  let row = fam.padEnd(15);
  for (const b of books) {
    const n = results[b].families[fam] ?? 0;
    row += (n ? String(n) : '·').padStart(9);
  }
  console.log(row);
}

console.log('\n=== CLÉS NON-STANDARD PAR BOOK ===');
for (const [b, r] of Object.entries(results)) {
  if (r.nonStd && r.nonStd.length) console.log(`  ${b}: ${r.nonStd.join(', ')}`);
}

process.exit(0);
