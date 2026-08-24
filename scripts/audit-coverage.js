#!/usr/bin/env node
// Audit couverture matchs vs cotes pour 5 books × 2 modes (prématch + live).
// Objectif : détecter les décalages listMatches vs getOdds — si on liste
// N matchs mais qu'on ne récupère les cotes que sur M<<N, il y a un bug
// (endpoint cassé, parser vide, format changé, etc.).
//
// Rapport par book × mode :
//   matches      : nombre listé par listMatches()
//   withOdds     : nombre pour lesquels getOdds() retourne >= 1 marché
//   pctCovered   : ratio withOdds/matches
//   avgMarkets   : moyenne de marchés par match ayant des cotes
//   sample       : 3 premiers matchs (pour visualiser noms/dates)
//   errors       : erreurs getOdds (timeout, 4xx, format inattendu)

import { bookmakersByKey } from '../src/bookmakers/index.js';

const BOOKS_TO_AUDIT = ['1xbet', '1win', 'congobet', 'betpawa', 'apollo'];
const SPORTS = ['football'];  // focus foot pour la vitesse (extensible)
const SAMPLE_ODDS_MAX = 30;   // limite requêtes getOdds par book (perf)
const CONCURRENCY = 5;

const results = {};

async function auditBookMode(bookKey, mode) {
  const book = bookmakersByKey[bookKey];
  if (!book) {
    return { error: `book "${bookKey}" not found in bookmakers/index.js` };
  }
  const isLive = mode === 'live';
  const modeSupported = isLive ? book.supports?.live : book.supports?.prematch;
  if (!modeSupported) {
    return { error: `mode ${mode} not supported by ${bookKey}` };
  }

  const t0 = Date.now();
  let matches;
  try {
    matches = await book.listMatches({ live: isLive, sport: 'football', horizonHours: 48 });
  } catch (e) {
    return { error: `listMatches threw: ${e.message}` };
  }
  const listMs = Date.now() - t0;
  const total = matches.length;
  if (!total) {
    return { total: 0, withOdds: 0, pctCovered: 0, avgMarkets: 0, listMs, oddsMs: 0, sample: [], errors: [] };
  }

  // Sample : max SAMPLE_ODDS_MAX pour ne pas exploser le temps
  const sample = matches.slice(0, SAMPLE_ODDS_MAX);
  const t1 = Date.now();
  let withOdds = 0;
  let totalMarkets = 0;
  const errors = [];

  // Concurrence contrôlée : batches de CONCURRENCY
  for (let i = 0; i < sample.length; i += CONCURRENCY) {
    const chunk = sample.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (m) => {
      try {
        const odds = await book.getOdds(m, { live: isLive, sport: 'football' });
        const numMarkets = odds ? Object.keys(odds).length : 0;
        if (numMarkets > 0) {
          withOdds++;
          totalMarkets += numMarkets;
        } else {
          errors.push({ id: m.id, home: m.home?.slice(0, 30), reason: 'no markets returned' });
        }
      } catch (e) {
        errors.push({ id: m.id, home: m.home?.slice(0, 30), reason: `err: ${e.message.slice(0, 80)}` });
      }
    }));
  }
  const oddsMs = Date.now() - t1;

  return {
    total,
    sampled: sample.length,
    withOdds,
    pctCovered: sample.length ? Math.round(100 * withOdds / sample.length) : 0,
    avgMarkets: withOdds ? Math.round(totalMarkets / withOdds) : 0,
    listMs,
    oddsMs,
    sample: matches.slice(0, 3).map(m => ({
      id: m.id,
      home: m.home?.slice(0, 30),
      away: m.away?.slice(0, 30),
      start: m.start ? new Date(m.start).toISOString() : null,
    })),
    errors: errors.slice(0, 5), // 5 premières erreurs
  };
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('  AUDIT COUVERTURE : listMatches vs getOdds par book × mode');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`Books  : ${BOOKS_TO_AUDIT.join(', ')}`);
console.log(`Sport  : football`);
console.log(`Sample : max ${SAMPLE_ODDS_MAX} matches par book/mode`);
console.log('');

for (const bookKey of BOOKS_TO_AUDIT) {
  results[bookKey] = {};
  for (const mode of ['prematch', 'live']) {
    process.stdout.write(`[${bookKey}:${mode}] running... `);
    const r = await auditBookMode(bookKey, mode);
    results[bookKey][mode] = r;
    if (r.error) {
      console.log(`❌ ${r.error}`);
    } else {
      const flag = r.total === 0 ? '⚪ VIDE'
                 : r.pctCovered < 50 ? '🔴 BAS'
                 : r.pctCovered < 80 ? '🟡 MOYEN'
                 : '🟢 OK';
      console.log(`${flag} ${r.withOdds}/${r.sampled} avec cotes (${r.pctCovered}%), ${r.total} listés total, ~${r.avgMarkets} marchés/match, listing=${r.listMs}ms cotes=${r.oddsMs}ms`);
    }
  }
}

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  RAPPORT DÉTAILLÉ');
console.log('═══════════════════════════════════════════════════════════════');

for (const bookKey of BOOKS_TO_AUDIT) {
  console.log(`\n▓▓ ${bookKey.toUpperCase()} ▓▓`);
  for (const mode of ['prematch', 'live']) {
    const r = results[bookKey][mode];
    console.log(`  ── ${mode} ──`);
    if (r.error) {
      console.log(`     ❌ ${r.error}`);
      continue;
    }
    console.log(`     Total listés    : ${r.total}`);
    console.log(`     Sample testé    : ${r.sampled}`);
    console.log(`     Avec cotes      : ${r.withOdds} (${r.pctCovered}%)`);
    console.log(`     Marchés moyens  : ${r.avgMarkets}`);
    console.log(`     Latence listing : ${r.listMs}ms`);
    console.log(`     Latence cotes   : ${r.oddsMs}ms`);
    if (r.sample.length) {
      console.log(`     Sample matchs   :`);
      for (const m of r.sample) {
        console.log(`       [${m.id}] ${m.home} vs ${m.away} @ ${m.start || 'no start'}`);
      }
    }
    if (r.errors.length) {
      console.log(`     Erreurs (top 5) :`);
      for (const e of r.errors) {
        console.log(`       [${e.id}] ${e.home} → ${e.reason}`);
      }
    }
  }
}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  DIAGNOSTIC AUTOMATIQUE');
console.log('═══════════════════════════════════════════════════════════════');

const problems = [];
for (const bookKey of BOOKS_TO_AUDIT) {
  for (const mode of ['prematch', 'live']) {
    const r = results[bookKey][mode];
    if (r.error) {
      problems.push({ bookKey, mode, severity: 'ERROR', msg: r.error });
      continue;
    }
    if (r.total === 0) {
      problems.push({ bookKey, mode, severity: 'EMPTY', msg: `aucun match listé` });
      continue;
    }
    if (r.pctCovered === 0) {
      problems.push({ bookKey, mode, severity: 'CRITICAL', msg: `0% des matchs ont des cotes récupérées (${r.total} listés, 0 avec cotes)` });
    } else if (r.pctCovered < 50) {
      problems.push({ bookKey, mode, severity: 'HIGH', msg: `seulement ${r.pctCovered}% des matchs ont des cotes (${r.withOdds}/${r.sampled})` });
    } else if (r.pctCovered < 80) {
      problems.push({ bookKey, mode, severity: 'MEDIUM', msg: `${r.pctCovered}% de couverture (attendu >=80%)` });
    }
  }
}

if (problems.length === 0) {
  console.log('✅ Aucun problème détecté — couverture correcte sur tous les books/modes');
} else {
  console.log(`⚠️  ${problems.length} problème(s) détecté(s) :`);
  for (const p of problems) {
    const icon = p.severity === 'CRITICAL' ? '🔴' : p.severity === 'HIGH' ? '🟠' : p.severity === 'MEDIUM' ? '🟡' : p.severity === 'EMPTY' ? '⚪' : '❌';
    console.log(`  ${icon} [${p.severity}] ${p.bookKey}:${p.mode} → ${p.msg}`);
  }
}

console.log('');
console.log('Fin audit.');
process.exit(0);
