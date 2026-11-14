// Ecart d'heure reel entre l'heure deduite par PremierBet et le vrai coup d'envoi
// (mesure sur les paires raccrochees avec la reference 1xbet).
import { bookmakers } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';

const catalogs = new Map();
for (const book of bookmakers) {
  if (!['xbet', 'premierbet', '1xbet', 'betpawa'].includes(book.key)) continue;
  try { catalogs.set(book.key, (await book.listMatches({ sport: 'football', live: true, horizonHours: 72 })) || []); }
  catch (e) { console.log(book.key, 'KO', e.message); }
}
for (const [k, v] of catalogs) console.log(k, v.length, 'matchs');
const entries = alignCatalogs(catalogs, { minBooks: 2 });
const dt = [];
for (const e of entries) {
  const pb = e.matches['premierbet'];
  if (!pb) continue;
  for (const [k, m] of Object.entries(e.matches)) {
    if (k === 'premierbet' || !m || !m.start) continue;
    dt.push({ book: k, gap: Math.round((pb.start - m.start) / 60000), label: (pb.home || '') + ' - ' + (pb.away || '') });
  }
}
dt.sort((a, b) => a.gap - b.gap);
const gaps = dt.map((x) => x.gap);
const med = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
console.log('paires mesurees =', dt.length, '| ecart median =', med, 'min');
console.log('min/max =', gaps[0], '/', gaps[gaps.length - 1]);
const hist = {};
for (const g of gaps) hist[g] = (hist[g] || 0) + 1;
console.log('distribution =', JSON.stringify(hist));
for (const x of dt.slice(0, 10)) console.log('  ' + x.book + ' ' + x.gap + ' min  ' + x.label);
