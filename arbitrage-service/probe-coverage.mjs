// Sonde de COUVERTURE : pour chaque sport et chaque bookmaker, liste les
// familles de marches reellement lues sur les premiers matchs du catalogue.
import { bookmakers } from '../src/bookmakers/index.js';

const SPORTS = (process.env.PROBE_SPORTS || 'football,tennis,basket,hockey,volleyball,table_tennis').split(',');
const LIVE = String(process.env.PROBE_LIVE || 'false') === 'true';
const PER_BOOK = Number(process.env.PROBE_MATCHES || 3);

const family = (k) => k.replace(/_-?\d+(?:\.\d+)?$/, '').replace(/_(over|under)$/, '_ou');

for (const sport of SPORTS) {
  console.log('\n=== ' + sport.toUpperCase() + (LIVE ? ' LIVE' : ' PREMATCH') + ' ===');
  for (const book of bookmakers) {
    let list = [];
    try { list = await book.listMatches({ sport, live: LIVE, horizonHours: 72 }); }
    catch (e) { console.log('  ' + book.key + ': LISTAGE KO (' + e.message + ')'); continue; }
    if (!list.length) { console.log('  ' + book.key + ': 0 match'); continue; }
    const sample = list.slice(0, PER_BOOK);
    const fams = new Set();
    let read = 0;
    for (const m of sample) {
      try {
        const odds = book.getOddsBatch
          ? ((await book.getOddsBatch(sample, { sport, live: LIVE })).get(m.id) || {})
          : (await book.getOdds(m, { sport, live: LIVE })) || {};
        const keys = Object.keys(odds).filter((k) => k !== '_ids');
        if (keys.length) read++;
        keys.forEach((k) => fams.add(family(k)));
        if (book.getOddsBatch) break;
      } catch (e) { /* la sonde mesure, elle ne juge pas */ }
    }
    console.log('  ' + book.key + ': ' + list.length + ' matchs | cotes lues ' + read + '/' + sample.length + ' | ' + fams.size + ' familles');
    if (fams.size) console.log('     ' + [...fams].sort().join(' '));
  }
}
