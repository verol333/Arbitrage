#!/usr/bin/env node
// PROBE HOCKEY VERIFY — check mapping + coupon _ids per book
// Pour chaque book hockey actif : liste matchs, fetch odds d'un sample,
// dump toutes les cles odds + verifie presence _ids (donnees coupon).
//
// Objectif :
//   1) Confirmer qu'on liste bien des matchs hockey par book
//   2) Confirmer qu'on recupere les cotes (mapping OK)
//   3) Confirmer qu'on a les _ids pour generer un code coupon
//   4) Dresser une matrice book x marches supportes
import { bookmakers } from '../src/bookmakers/index.js';

const BOOKS_HOCKEY = ['1xbet', 'onewin', 'congobet', 'apollo', 'betmomo', 'premierbet', 'sportybet'];
// Note : YellowBet + BetPawa exclus (hockey absent catalogue)
// 'onewin' internal key. Le book expose la key '1win' mais le module fichier est onewin.

function classify(key) {
  if (/^match_[12X]$/.test(key)) return 'winner';
  if (/^hcp_(home|away)_/.test(key)) return 'handicap';
  if (/^match_(over|under)_/.test(key)) return 'total';
  if (/^tt_(home|away)_(over|under)_/.test(key)) return 'tt';
  if (/^(odd|even)$/.test(key)) return 'oddeven';
  if (/^dc_/.test(key)) return 'dc';
  if (/^btts_/.test(key)) return 'btts';
  if (/^dnb_/.test(key)) return 'dnb';
  if (/^p[1-3]_/.test(key)) return 'period';
  if (/^h[12]_/.test(key)) return 'half';
  if (/^q[1-4]_/.test(key)) return 'quarter';
  return 'other';
}

function summarizeOdds(odds) {
  const cats = {};
  let hasIds = false;
  const idsPerKey = {};
  for (const [k, v] of Object.entries(odds || {})) {
    if (k === '_ids') { hasIds = true; continue; }
    const cat = classify(k);
    if (!cats[cat]) cats[cat] = [];
    cats[cat].push(k);
  }
  if (odds?._ids) {
    for (const [k, ids] of Object.entries(odds._ids)) {
      idsPerKey[k] = Object.keys(ids || {});
    }
  }
  return { cats, hasIds, idsPerKey };
}

console.log('▶ PROBE HOCKEY VERIFY — mapping + coupon _ids per book\n');

// Aggregate result table
const results = {}; // bookKey -> { matches, sample, summary }

for (const bk of BOOKS_HOCKEY) {
  const b = bookmakers.find((x) => x.key === bk);
  if (!b) { console.log(`❌ book "${bk}" absent registre`); continue; }
  console.log(`\n══════════════════ ${b.label} (${b.key}) ══════════════════\n`);
  let matches = [];
  try {
    matches = await b.listMatches({ live: false, horizonHours: 168, sport: 'hockey' });
  } catch (e) {
    console.log(`  ✗ listMatches erreur : ${e.message}`);
    results[bk] = { error: e.message };
    continue;
  }
  console.log(`  📋 ${matches.length} matchs listes`);
  for (const m of matches.slice(0, 5)) {
    console.log(`     [${m.league || '?'}] ${m.home} vs ${m.away}  id=${m.id}`);
  }
  if (!matches.length) {
    results[bk] = { matches: 0, sample: null };
    console.log(`  (aucun match, skip odds probe)`);
    continue;
  }
  // Prendre le 1er match comme sample
  const sample = matches[0];
  console.log(`\n  ▶ Sample : ${sample.home} vs ${sample.away}`);
  let odds = {};
  try {
    odds = await b.getOdds(sample, { live: false, noCache: true, sport: 'hockey' });
  } catch (e) {
    console.log(`  ✗ getOdds erreur : ${e.message}`);
    results[bk] = { matches: matches.length, sample: sample.id, error: e.message };
    continue;
  }
  const totalKeys = Object.keys(odds || {}).filter(k => k !== '_ids').length;
  console.log(`  💰 ${totalKeys} cles odds extraites, _ids=${odds?._ids ? 'PRESENT' : 'ABSENT'}`);
  const { cats, hasIds, idsPerKey } = summarizeOdds(odds);
  const catsSummary = Object.entries(cats)
    .map(([c, ks]) => `${c}:${ks.length}`).join(' | ');
  console.log(`  📊 ${catsSummary || '(aucun marche mappe)'}`);
  // Sample d'un marche par categorie
  for (const [cat, ks] of Object.entries(cats)) {
    if (cat === 'other') continue;
    const sample1 = ks.slice(0, 3).map(k => `${k}=${odds[k]}`).join(' ');
    console.log(`     ${cat.padEnd(10)} : ${sample1}`);
  }
  // Sample _ids
  if (hasIds) {
    const firstKey = Object.keys(idsPerKey)[0];
    if (firstKey) {
      console.log(`  🎫 _ids sample ${firstKey} → fields=${idsPerKey[firstKey].join(',')}`);
    }
  } else {
    console.log(`  ⚠️ _ids ABSENT — coupon code generation impossible`);
  }
  results[bk] = { matches: matches.length, sample: sample.id, totalKeys, cats: Object.fromEntries(Object.entries(cats).map(([c, ks]) => [c, ks.length])), hasIds };
}

// ═══════════════════════════ MATRICE ═══════════════════════════
console.log('\n\n══════════════════ MATRICE MAPPING HOCKEY ══════════════════\n');
const CATS = ['winner', 'total', 'handicap', 'tt', 'oddeven', 'dc', 'dnb', 'btts', 'period'];
console.log(`  ${'Book'.padEnd(14)} matchs  keys  ids  ${CATS.map(c => c.padEnd(9)).join('')}`);
for (const bk of BOOKS_HOCKEY) {
  const r = results[bk] || {};
  if (r.error) { console.log(`  ${bk.padEnd(14)} ERR: ${r.error}`); continue; }
  const line = CATS.map(c => String(r.cats?.[c] ?? 0).padEnd(9)).join('');
  const idsMark = r.hasIds ? '✓' : '✗';
  console.log(`  ${bk.padEnd(14)} ${String(r.matches ?? 0).padEnd(7)} ${String(r.totalKeys ?? 0).padEnd(5)} ${idsMark.padEnd(4)} ${line}`);
}
console.log('\n═══ FIN VERIFY HOCKEY ═══');
process.exit(0);
