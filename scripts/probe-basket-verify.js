#!/usr/bin/env node
// PROBE BASKET VERIFY — dump complet cotes basket par book pour valider mapping.
// Pour chaque book (sauf casongo/apollo), liste basket matches + fetch odds de
// 2 samples riches (NBA/WNBA preferentiel). Compare cross-book pour reperer :
//  1) Marches manquants (parser skip un TI/betTypeId)
//  2) Cotes suspectes (odds >20 sur marches simples = probable bug)
//  3) Handicaps orphelins (home_-L sans away_+L)
//  4) Totaux orphelins (over sans under)
// Objectif : identifier precisement quels books/marches ont un mapping bogue.
import { bookmakers } from '../src/bookmakers/index.js';

const BOOKS = ['1xbet', '1win', 'congobet', 'yellowbet', 'apollo', 'betmomo', 'premierbet', 'betpawa', 'sportybet'];

function classify(key) {
  if (/^(?:[qhs][1-4]_)?match_[12X]$/.test(key)) return 'winner';
  if (/^(?:[qhs][1-4]_)?hcp_(home|away)_/.test(key)) return 'handicap';
  if (/^(?:[qhs][1-4]_)?match_(over|under)_/.test(key)) return 'total';
  if (/^(?:[qhs][1-4]_)?(over|under)_/.test(key)) return 'total_pfx';
  if (/^(?:[qhs][1-4]_)?tt_(home|away)_/.test(key)) return 'tt';
  if (/^(?:[qhs][1-4]_)?(odd|even)$/.test(key)) return 'oddeven';
  if (/^(?:[qhs][1-4]_)?dc_/.test(key)) return 'dc';
  if (/^q[1-4]_/.test(key)) return 'quarter';
  if (/^h[12]_/.test(key)) return 'half';
  return 'other';
}

function classifyPeriod(key) {
  const m = key.match(/^(q[1-4]|h[12])_/);
  return m ? m[1] : 'ft';
}

function extractLine(key) {
  const m = key.match(/(-?\d+(?:\.\d+)?)$/);
  return m ? parseFloat(m[1]) : null;
}

function auditKeys(odds) {
  const cats = {};
  const perPeriod = {};
  const suspect = [];
  const orphansHcp = {};
  const orphansTot = {};
  for (const [k, v] of Object.entries(odds || {})) {
    if (k === '_ids') continue;
    const cat = classify(k);
    const period = classifyPeriod(k);
    cats[cat] = (cats[cat] || 0) + 1;
    perPeriod[period] = (perPeriod[period] || 0) + 1;
    if (v > 20) suspect.push(`${k}=${v}`);
    if (cat === 'handicap') {
      const l = extractLine(k);
      const side = /hcp_home/.test(k) ? 'home' : 'away';
      const canonical = side === 'home' ? l : -l;
      const pfx = (k.match(/^([qh][1-4]?_)/) || [''])[0];
      const bucket = `${pfx}${canonical}`;
      if (!orphansHcp[bucket]) orphansHcp[bucket] = {};
      orphansHcp[bucket][side] = v;
    }
    if (cat === 'total' || cat === 'total_pfx') {
      const l = extractLine(k);
      const dir = /over/.test(k) ? 'over' : 'under';
      const pfx = (k.match(/^([qh][1-4]?_)/) || [''])[0];
      const bucket = `${pfx}${l}`;
      if (!orphansTot[bucket]) orphansTot[bucket] = {};
      orphansTot[bucket][dir] = v;
    }
  }
  const orphanHcpCount = Object.values(orphansHcp).filter((g) => !g.home || !g.away).length;
  const orphanTotCount = Object.values(orphansTot).filter((g) => !g.over || !g.under).length;
  return { cats, perPeriod, suspect, orphanHcpCount, orphanTotCount, orphansHcpFull: Object.entries(orphansHcp).filter(([, g]) => g.home && g.away).length, orphansTotFull: Object.entries(orphansTot).filter(([, g]) => g.over && g.under).length };
}

console.log('▶ PROBE BASKET VERIFY — dump keys/cotes par book\n');

const results = {};
for (const bk of BOOKS) {
  const b = bookmakers.find((x) => x.key === bk);
  if (!b) { console.log(`❌ book "${bk}" absent`); continue; }
  console.log(`\n══════════════════ ${b.label} (${b.key}) ══════════════════\n`);
  let matches = [];
  try { matches = await b.listMatches({ live: false, horizonHours: 72, sport: 'basket' }); }
  catch (e) { console.log(`  ✗ listMatches ERR: ${e.message}`); results[bk] = { err: e.message }; continue; }
  console.log(`  📋 ${matches.length} matchs basket listes`);
  for (const m of matches.slice(0, 3)) console.log(`     [${m.league || '?'}] ${m.home} vs ${m.away}  id=${m.id}`);
  if (!matches.length) { results[bk] = { matches: 0 }; continue; }

  // Prendre 2 samples : 1er + celui qui a le plus de raw markets (si disponible)
  const withRaw = matches.map((m) => ({ m, cnt: (m.__raw?.markets?.length ?? 0) + (m.__raw?.marketGroups?.reduce((s, g) => s + (g.markets?.length || 0), 0) ?? 0) }));
  const samples = withRaw.sort((a, b) => b.cnt - a.cnt).slice(0, 2).map((s) => s.m);

  results[bk] = { matches: matches.length, samples: [] };
  for (const sample of samples) {
    console.log(`\n  ▶ ${sample.home} vs ${sample.away}  [${sample.league || '?'}]`);
    let odds = {};
    try { odds = await b.getOdds(sample, { live: false, noCache: true, sport: 'basket' }); }
    catch (e) { console.log(`    ✗ getOdds ERR: ${e.message}`); results[bk].samples.push({ err: e.message }); continue; }
    const totalKeys = Object.keys(odds).filter((k) => k !== '_ids').length;
    const audit = auditKeys(odds);
    console.log(`    💰 ${totalKeys} keys | ${Object.entries(audit.cats).map(([c, n]) => `${c}:${n}`).join(' ')}`);
    console.log(`    ⏱ par periode : ${Object.entries(audit.perPeriod).map(([p, n]) => `${p}:${n}`).join(' ')}`);
    console.log(`    🎯 hcp complets : ${audit.orphansHcpFull} | hcp orphans : ${audit.orphanHcpCount}`);
    console.log(`    🎯 tot complets : ${audit.orphansTotFull} | tot orphans : ${audit.orphanTotCount}`);
    if (audit.suspect.length) console.log(`    🚨 cotes >20 : ${audit.suspect.slice(0, 5).join(' | ')}`);
    // Sample de 3 keys par categorie
    const byCatKeys = {};
    for (const k of Object.keys(odds)) {
      if (k === '_ids') continue;
      const c = classify(k);
      if (!byCatKeys[c]) byCatKeys[c] = [];
      byCatKeys[c].push(k);
    }
    for (const [cat, keys] of Object.entries(byCatKeys)) {
      if (cat === 'other') continue;
      const sample3 = keys.slice(0, 3).map((k) => `${k}=${odds[k]}`).join(' ');
      console.log(`      ${cat.padEnd(10)} : ${sample3}`);
    }
    results[bk].samples.push({ id: sample.id, keys: totalKeys, cats: audit.cats, hcpFull: audit.orphansHcpFull, hcpOrphan: audit.orphanHcpCount, totFull: audit.orphansTotFull, totOrphan: audit.orphanTotCount, suspect: audit.suspect.length });
  }
}

// ═══════════════════════════ MATRICE FINALE ═══════════════════════════
console.log('\n\n═════════════════ MATRICE BASKET (sample 1 par book) ═════════════════\n');
console.log(`  ${'Book'.padEnd(12)} matchs  keys  winner  total   hcp   tt   dc  quarter half  hcpF/O  totF/O  suspect`);
for (const bk of BOOKS) {
  const r = results[bk] || {};
  if (r.err) { console.log(`  ${bk.padEnd(12)} ERR: ${r.err}`); continue; }
  const s = r.samples?.[0] || {};
  const c = s.cats || {};
  console.log(`  ${bk.padEnd(12)} ${String(r.matches ?? 0).padEnd(7)} ${String(s.keys ?? 0).padEnd(5)} ${String(c.winner ?? 0).padEnd(7)} ${String((c.total ?? 0) + (c.total_pfx ?? 0)).padEnd(7)} ${String(c.handicap ?? 0).padEnd(5)} ${String(c.tt ?? 0).padEnd(4)} ${String(c.dc ?? 0).padEnd(3)} ${String(c.quarter ?? 0).padEnd(7)} ${String(c.half ?? 0).padEnd(5)} ${(s.hcpFull ?? 0)}/${s.hcpOrphan ?? 0}`.padEnd(80) + `  ${(s.totFull ?? 0)}/${s.totOrphan ?? 0}  ${s.suspect ?? 0}`);
}
console.log('\n═══ FIN ═══');
process.exit(0);
