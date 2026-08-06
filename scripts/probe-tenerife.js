#!/usr/bin/env node
// PROBE ciblee : Tenerife vs Tamaraceite — 4 opps envoyees, toutes sur 1xbet BTTS Oui = 2.06
// Suspicion : cote 1xbet stale. Dump COMPLET cotes fresh sur 4 books :
// 1xbet, betpawa, yellowbet, premierbet — puis comparer aux cotes envoyees a l'app.

import { bookmakersByKey } from '../src/bookmakers/index.js';

const opps = [
  { market: 'BTTS', book: '1xbet', label: 'Oui', odd: 2.06, key: 'btts_yes' },
  { market: 'BTTS', book: 'betpawa', label: 'Non', odd: 2.09, key: 'btts_no' },
  { market: 'Total 2.5', book: '1xbet', label: '+2.5', odd: 1.76, key: 'match_over_2.5' },
  { market: 'Total 2.5', book: 'yellowbet', label: '-2.5', odd: 2.47, key: 'match_under_2.5' },
  { market: 'BTTS', book: 'yellowbet', label: 'Non', odd: 2.05, key: 'btts_no' },
  { market: 'BTTS', book: 'premierbet', label: 'Non', odd: 2.05, key: 'btts_no' },
];

const BOOKS = ['1xbet', 'betpawa', 'yellowbet', 'premierbet'];

console.log('▶▶▶ PROBE Tenerife vs Tamaraceite — refetch fresh + cross-check');

// 1) trouver le match sur chaque book via listMatches
for (const bk of BOOKS) {
  const b = bookmakersByKey[bk];
  if (!b) { console.log(`\n${bk}: pas de bookmaker`); continue; }
  console.log(`\n═══ ${bk.toUpperCase()} ═══`);
  let matches = [];
  try {
    matches = await b.listMatches({ live: false, horizonHours: 72, sport: 'football' });
  } catch (e) { console.log(`  ERR list: ${e.message}`); continue; }
  const found = matches.filter(m =>
    /tenerife/i.test(m.home || '') || /tenerife/i.test(m.away || '') ||
    /tamarac/i.test(m.home || '') || /tamarac/i.test(m.away || '')
  );
  console.log(`  ${found.length} match(s) potentiel(s) trouvé(s) dans ${matches.length} listés`);
  for (const m of found) {
    console.log(`  → id=${m.id} "${m.home}" vs "${m.away}" league="${m.league || '?'}" start=${m.start ? new Date(m.start).toISOString() : '?'}`);
    // fetch odds fresh
    let odds = {};
    try {
      odds = await b.getOdds({ id: m.id, home: m.home, away: m.away }, { live: false, noCache: true }) || {};
    } catch (e) { console.log(`    ERR odds: ${e.message}`); continue; }
    console.log(`    ${Object.keys(odds).length} clés refetch fresh :`);
    const keys = Object.keys(odds).sort();
    // afficher toutes cles BTTS et Total 2.5 et Total 3.5 (probables candidats)
    for (const k of keys) {
      if (/btts|over_2\.5|under_2\.5|over_3\.5|under_3\.5|match_[12X]/.test(k)) {
        console.log(`      ${k.padEnd(28)} = ${odds[k]}`);
      }
    }
    // Comparer avec opps envoyees a l'app pour ce book
    console.log('    ── COMPARE opps envoyees ──');
    for (const o of opps.filter(x => x.book === bk)) {
      const freshVal = odds[o.key];
      const status = freshVal == null ? '❌ ABSENTE' : (Math.abs(freshVal - o.odd) < 0.02 ? '✅ idem' : `🔴 DRIFT ${(freshVal - o.odd).toFixed(2)}`);
      console.log(`      [${o.market}] ${o.label} envoye=${o.odd}  refetch=${freshVal ?? '—'}  ${status}`);
    }
  }
}

console.log('\n═══ FIN PROBE ═══');
