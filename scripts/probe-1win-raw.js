#!/usr/bin/env node
// PROBE 1WIN RAW — dump les rawName groups exposes par 1win pour 2-3 matchs
// populaires (max markets). Cross-verifie avec ce que le parser handle pour
// identifier les groups EXPOSES mais NON PARSES (source de cles manquantes).
import { listPrematch } from '../src/bookmakers/onewin/list.js';
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';
import { winFlatOdds } from '../src/bookmakers/onewin/parse.js';

console.log('▶ PROBE 1WIN RAW\n');

const list = await listPrematch('football');
console.log(`Catalog football = ${list.length} matchs\n`);

// Trier par nom court (proxy inverse populaire — Premier League a longs noms)
// et prendre les 3 premiers avec noms suggerant PL/LaLiga/Bundesliga
const isPopular = (m) => /(city|united|arsenal|chelsea|liverpool|madrid|barcelona|bayern|inter|milan|juventus|napoli|paris|dortmund|atletico|marseille|lyon)/i.test(`${m.home} ${m.away}`);
const populars = list.filter(isPopular).slice(0, 3);
const sample = populars.length ? populars : list.slice(0, 3);

console.log(`Sample : ${sample.length} matchs\n`);
for (const m of sample) console.log(`  - ${m.home} vs ${m.away} (id=${m.id})`);
console.log('');

// Fetch odds pour ces matchs
const map = await fetchOddsWS(sample.map(m => m.id));
console.log(`WS returned ${map.size} matchs\n`);

for (const m of sample) {
  const groups = map.get(m.id) || map.get(String(m.id)) || map.get(Number(m.id));
  console.log(`══ ${m.home} vs ${m.away} (id=${m.id}) ══`);
  if (!groups) { console.log('  ❌ pas de groups (WS timeout ou match ferme)'); continue; }
  const rawNames = Object.keys(groups).sort();
  console.log(`  ${rawNames.length} raw groups exposes par 1win :`);
  for (const n of rawNames) {
    const list = groups[n] || [];
    const actives = list.filter(o => o?.status === 1 && Number(o.cf) > 1);
    console.log(`    "${n}" (${actives.length}/${list.length} actives)`);
  }
  // Parse
  const parsed = winFlatOdds(groups, { home: m.home, away: m.away });
  const keys = Object.keys(parsed).sort();
  console.log(`\n  → ${keys.length} cles produites par le parser :`);
  const g = {};
  for (const k of keys) {
    const p = k.split('_')[0];
    if (!g[p]) g[p] = [];
    g[p].push(k);
  }
  for (const [p, ks] of Object.entries(g).sort()) {
    console.log(`     ${p.padEnd(6)} (${ks.length}) : ${ks.slice(0, 6).join(', ')}${ks.length > 6 ? ' ...' : ''}`);
  }

  // Diff : groups EXPOSES mais 0 cles produites → parser gap
  console.log(`\n  ── AUDIT GAPS : raw groups NON PARSES (potential missing markets) ──`);
  const parsedKeysStr = keys.join(' ');
  const suspicious = [];
  for (const n of rawNames) {
    const nLow = n.toLowerCase().trim();
    // Groups qu'on sait deja parser (skip)
    const known = /^(full time result|result|match winner|double chance|both teams to score|draw no bet|total|handicap|asian handicap|1st half\.|2nd half\.|corners\.|odd\/even|total\. even\/odd|even\/odd|first (team to score|goal)|which team scores first|team to score first)/;
    // Groups TT (contient " total") deja gerés par regex sur nom
    const isTT = / total$/i.test(nLow) && nLow !== 'total';
    // BTTS mi-temps deja gerés par regex
    const isHTBTTS = /1st half.*both teams|both teams.*1st half|2nd half.*both teams|both teams.*2nd half/i.test(nLow);
    // DC 2nd half deja géré
    const isH2DC = /2nd half.*double chance/i.test(nLow);
    // Corners odd/even
    const isCorOE = /corners.*odd.*even|corners.*even.*odd/i.test(nLow);
    if (known.test(nLow) || isTT || isHTBTTS || isH2DC || isCorOE) continue;
    suspicious.push(n);
  }
  if (suspicious.length) {
    console.log(`    ${suspicious.length} groups POSSIBLEMENT non parses :`);
    for (const s of suspicious.slice(0, 20)) console.log(`      "${s}"`);
    if (suspicious.length > 20) console.log(`      ... (${suspicious.length - 20} autres)`);
  } else {
    console.log(`    ✅ tous les groups semblent couverts par le parser`);
  }
  console.log('');
}
process.exit(0);
