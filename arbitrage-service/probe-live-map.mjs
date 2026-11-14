// Sonde de RAPPROCHEMENT en direct : mesure combien de matchs de la reference
// sont raccroches a chaque book, et liste les affiches MANQUEES avec leur
// meilleur score de similarite. Sert a identifier les vrais trous de mapping
// (alias manquants, abreviations, noms traduits) — lecture seule.
import { bookmakers } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';
import { teamSim } from '../src/core/text.js';

const SPORT = process.env.PROBE_SPORT || 'football';
const MAX_LINES = Number(process.env.PROBE_LINES || 18);
const DT = 30 * 60 * 1000;
const day = (a, b) => { const x = new Date(a), y = new Date(b); return x.getUTCFullYear() === y.getUTCFullYear() && x.getUTCMonth() === y.getUTCMonth() && x.getUTCDate() === y.getUTCDate(); };

const catalogs = new Map();
for (const book of bookmakers) {
  try {
    const list = await book.listMatches({ sport: SPORT, live: true, horizonHours: 72 });
    catalogs.set(book.key, list || []);
    console.log(book.key.padEnd(12), (list || []).length, 'matchs');
  } catch (e) { console.log(book.key.padEnd(12), 'LISTAGE KO', e.message); }
}

const books = [...catalogs.keys()].filter((b) => catalogs.get(b).length);
const base = books.reduce((a, b) => (catalogs.get(a).length >= catalogs.get(b).length ? a : b));
const baseList = catalogs.get(base).filter((m) => m.start);
const entries = alignCatalogs(catalogs, { minBooks: 2 });
const covered = new Map(); // book -> Set(ids raccroches)
for (const b of books) covered.set(b, new Set());
for (const e of entries) for (const [k, m] of Object.entries(e.matches)) covered.get(k).add(m.id);

console.log('\n=== RAPPROCHEMENT ' + SPORT.toUpperCase() + ' LIVE ===');
console.log('base ' + base + ': ' + baseList.length + ' affiches | alignees >=2 books: ' + entries.length);

for (const b of books) {
  if (b === base) continue;
  const list = catalogs.get(b).filter((m) => m.start);
  let ok = 0;
  const misses = [];
  for (const m of baseList) {
    const e = entries.find((en) => en.matches[base] && en.matches[base].id === m.id);
    if (e && e.matches[b]) { ok++; continue; }
    let best = null, bs = 0;
    for (const c of list) {
      if (Math.abs(c.start - m.start) > DT) continue;
      if (!day(c.start, m.start)) continue;
      const s = (teamSim(m.home, c.home) + teamSim(m.away, c.away)) / 2;
      if (s > bs) { bs = s; best = c; }
    }
    if (best && bs >= 0.45) misses.push({ m, best, bs });
  }
  console.log('\n' + b + ': ' + ok + '/' + baseList.length + ' raccroches | ' + misses.length + ' manques proches');
  misses.sort((a, z) => z.bs - a.bs).slice(0, MAX_LINES).forEach((x) => {
    console.log('   ' + x.bs.toFixed(2) + '  "' + x.m.home + '" vs "' + x.m.away + '"   <->   "' + x.best.home + '" vs "' + x.best.away + '"');
  });
}
