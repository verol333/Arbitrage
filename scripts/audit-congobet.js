#!/usr/bin/env node
// AUDIT Congobet : dump betTypeIds present par sport, compare aux mappes.
import cb from '../src/bookmakers/congobet/index.js';
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { getOdds } from '../src/bookmakers/congobet/odds.js';
import { readFileSync } from 'fs';

const SPORTS = ['football','tennis','basket','hockey'];

// Extraire dynamiquement les betTypeIds connus par grep sur odds.js
const oddsSrc = readFileSync('src/bookmakers/congobet/odds.js', 'utf8');
const KNOWN = new Set(
  (oddsSrc.match(/id === (\d{4,5})/g) || []).map(m => parseInt(m.replace('id === ', ''), 10))
);
console.log(`▶ AUDIT Congobet — ${KNOWN.size} betTypeIds connus\n`);

function sanity2(o, k1, k2) {
  const a=o[k1], b=o[k2];
  if (!a||!b) return '-';
  return `${a.toFixed(2)}+${b.toFixed(2)}→inv=${(1/a+1/b).toFixed(3)}`;
}

for (const sport of SPORTS) {
  console.log(`\n═══════════════════ ${sport.toUpperCase()} ═══════════════════`);
  let matches;
  try { matches = await cb.listMatches({ sport, horizonHours: 48 }); }
  catch (e) { console.log(`  listMatches err=${e.message}`); continue; }
  console.log(`  Matchs listes : ${matches.length}`);
  if (!matches.length) { console.log('  ⚠ 0 matchs'); continue; }
  console.log(`  Samples : ${matches.slice(0,3).map(m=>`${m.home} vs ${m.away}`).join(' | ')}`);

  for (const s of matches.slice(0, 2)) {
    console.log(`\n  ── ${s.home} vs ${s.away} (id=${s.id}) ──`);
    const raw = await congoJson(`${CONGO_API}events/${s.id}?l=fr`);
    if (!raw) { console.log('    ⚠ fetch event null'); continue; }
    const bts = raw.eventBetTypes || [];
    console.log(`    ${bts.length} eventBetTypes raw`);
    const seen = new Map();
    for (const bt of bts) {
      const raw = Number(bt.betTypeId);
      const norm = raw >= 20000 ? raw - 10000 : raw;
      if (!seen.has(norm)) seen.set(norm, { name: bt.name || bt.betTypeName || '?', items: (bt.eventBetTypeItems || []).length });
    }
    const known_p = [...seen.keys()].filter(k => KNOWN.has(k));
    const unknown_p = [...seen.keys()].filter(k => !KNOWN.has(k));
    console.log(`    betTypeIds MAPPES : ${known_p.length}`);
    console.log(`    betTypeIds INCONNUS : ${unknown_p.length}`);
    for (const k of unknown_p.slice(0, 20)) {
      const info = seen.get(k);
      console.log(`      NEW id=${k} nItems=${info.items} name="${info.name}"`);
    }
    const parsed = await getOdds({ id: s.id }, { sport });
    if (parsed) {
      const keys = Object.keys(parsed).filter(k => k !== '_ids');
      console.log(`    ► parseur emit ${keys.length} keys plates`);
      if (parsed.match_1 && parsed.match_2) console.log(`      match_1/2: ${sanity2(parsed, 'match_1', 'match_2')}`);
      if (parsed.match_X) console.log(`      match_X  : ${parsed.match_X}`);
      const hcpLines = [...new Set(keys.filter(k=>k.startsWith('hcp_home_')).map(k=>k.replace('hcp_home_','')))].slice(0,3);
      for (const l of hcpLines) {
        const h = parsed[`hcp_home_${l}`], a = parsed[`hcp_away_${-Number(l)}`];
        if (h && a) console.log(`      hcp L=${l}: ${sanity2(parsed, `hcp_home_${l}`, `hcp_away_${-Number(l)}`)}`);
      }
    }
  }
}

console.log('\n═══ FIN AUDIT Congobet ═══');
process.exit(0);
