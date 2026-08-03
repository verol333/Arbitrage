#!/usr/bin/env node
// Dictionnaire complet 1WIN tennis :
// - Comprendre "Total" (games ou points?) via valeur des lignes
// - Comprendre "Nth set" (contextuel? mal cate?)
// - Distinguer tennis vs table tennis
// - Trouver tous les groups possibles sur 10 matchs

import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';
import { listPrematch } from '../src/bookmakers/onewin/list.js';

const matches = await listPrematch('tennis');
console.log(`${matches.length} matchs 1win sport=24 tennis\n`);

// Fetch WS pour 10 matchs
const sample = matches.slice(0, 10);
console.log(`Fetch WS pour ${sample.length} matchs...\n`);
const map = await fetchOddsWS(sample.map(m => m.id));
console.log(`${map.size}/${sample.length} matchs avec cotes\n`);

// Statistiques par nom de group
const groupStats = {}; // gname → { count, sampleValues, sampleOutcomes }

for (const m of sample) {
  const groups = map.get(m.id) || map.get(String(m.id));
  if (!groups) continue;
  for (const [gname, glist] of Object.entries(groups)) {
    if (!groupStats[gname]) groupStats[gname] = { count: 0, samples: [] };
    groupStats[gname].count++;
    if (groupStats[gname].samples.length < 3) {
      const outs = (glist || []).slice(0, 6).map(o => `${o.name || o.outcome || '?'}(${o.cf})`);
      groupStats[gname].samples.push({
        matchLabel: `${m.home} vs ${m.away} [${m.league}]`,
        outcomes: outs,
      });
    }
  }
}

console.log(`═══ ${Object.keys(groupStats).length} groupes distincts observes ═══\n`);
const sorted = Object.entries(groupStats).sort((a, b) => b[1].count - a[1].count);
for (const [gname, s] of sorted) {
  console.log(`\n━━ "${gname}" (${s.count}/${sample.length} matchs) ━━`);
  for (const sm of s.samples) {
    console.log(`  [${sm.matchLabel}]`);
    console.log(`    ${sm.outcomes.join(' | ')}`);
  }
}

// Analyse specifique : les valeurs "Total" sont-elles games ou points ?
console.log('\n\n═══ ANALYSE "Total" : games ou points ? ═══');
const totalValues = [];
for (const m of sample) {
  const groups = map.get(m.id);
  if (!groups?.['Total']) continue;
  for (const o of groups.Total) {
    const mm = (o.name || '').match(/(?:over|under)\s+([\d.]+)/i);
    if (mm) totalValues.push({ match: `${m.home} vs ${m.away}`, val: parseFloat(mm[1]) });
  }
}
totalValues.sort((a, b) => a.val - b.val);
console.log(`  ${totalValues.length} valeurs Total observees`);
console.log(`  Range : min=${totalValues[0]?.val} max=${totalValues[totalValues.length - 1]?.val}`);
console.log(`  Distribution :`);
const buckets = { '<25 (games)': 0, '25-50': 0, '50-100 (points ATP)': 0, '100-200 (points)': 0, '>200': 0 };
for (const t of totalValues) {
  if (t.val < 25) buckets['<25 (games)']++;
  else if (t.val < 50) buckets['25-50']++;
  else if (t.val < 100) buckets['50-100 (points ATP)']++;
  else if (t.val < 200) buckets['100-200 (points)']++;
  else buckets['>200']++;
}
for (const [k, v] of Object.entries(buckets)) console.log(`    ${k} : ${v}`);
console.log('  Exemples extremes :');
console.log(`    min val = ${totalValues[0]?.val} pour ${totalValues[0]?.match}`);
console.log(`    max val = ${totalValues[totalValues.length - 1]?.val} pour ${totalValues[totalValues.length - 1]?.match}`);

console.log('\n\n═══ ANALYSE "Nth set" : quelle numeration ? ═══');
// Extraire les "Xth set" et voir pattern
const setCounts = {};
for (const gname of Object.keys(groupStats)) {
  const m = gname.match(/^(\d)(st|nd|rd|th) set\./);
  if (m) {
    const n = m[1];
    if (!setCounts[n]) setCounts[n] = 0;
    setCounts[n] += groupStats[gname].count;
  }
}
for (const [n, c] of Object.entries(setCounts).sort()) {
  console.log(`  set N=${n}: ${c} occurrences totales`);
}
console.log('  Hypothese : si N va au-dela de 3 → best-of-5 (Grand Slam) ou tennis de table (best-of-5/7)');
console.log('  Si N va au-dela de 5 → probablement table tennis mal categorise');
