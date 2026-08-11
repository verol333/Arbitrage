#!/usr/bin/env node
// AUDIT Casongo : listing counts + tenter parsing d'un match (odds probablement 401).
import cs from '../src/bookmakers/casongo/index.js';
import { casongoGet } from '../src/bookmakers/casongo/api.js';
import { casongoFlatOdds } from '../src/bookmakers/casongo/parse.js';

const SPORTS = ['football','tennis','basket','hockey'];

function sanity2(o, k1, k2) {
  const a=o[k1], b=o[k2];
  if (!a||!b) return '-';
  return `${a.toFixed(2)}+${b.toFixed(2)}→inv=${(1/a+1/b).toFixed(3)}`;
}

console.log('▶ AUDIT Casongo\n');

for (const sport of SPORTS) {
  console.log(`\n═══════════════════ ${sport.toUpperCase()} ═══════════════════`);
  let matches;
  try { matches = await cs.listMatches({ sport, horizonHours: 48 }); }
  catch (e) { console.log(`  listMatches err=${e.message}`); continue; }
  console.log(`  Matchs listes : ${matches.length}`);
  if (!matches.length) { console.log('  ⚠ 0 matchs (sport probablement non supporte YB : foot only)'); continue; }
  console.log(`  Samples : ${matches.slice(0,3).map(m=>`${m.home} vs ${m.away}`).join(' | ')}`);

  // Tenter fetch odds sur 1 match
  const s = matches[0];
  console.log(`\n  ── Test getOdds : ${s.home} vs ${s.away} (id=${s.id}) ──`);
  try {
    const parsed = await cs.getOdds(s, { sport });
    const keys = Object.keys(parsed).filter(k => k !== '_ids');
    console.log(`    ► parseur emit ${keys.length} keys plates`);
    if (parsed.match_1 && parsed.match_2) console.log(`      match_1/2: ${sanity2(parsed, 'match_1', 'match_2')}`);
    if (parsed.match_X) console.log(`      match_X  : ${parsed.match_X}`);
    if (keys.length === 0) console.log(`    (0 keys = probablement 401 GetMatchById cote Velisports, known limitation)`);
  } catch (e) { console.log(`    ⚠ getOdds err=${e.message}`); }
}

console.log('\n═══ FIN AUDIT Casongo ═══');
process.exit(0);
