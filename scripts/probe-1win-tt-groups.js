// Dump les groups WS 1win pour match TT fourni par user (38655958 = Orest Hura vs Anton Shypilov)
// + un 2ème match pour vérifier régularité.
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';
import onewin from '../src/bookmakers/onewin/index.js';

async function dumpMatch(matchId) {
  console.log(`\n═══ Match ${matchId} ═══`);
  const map = await fetchOddsWS([matchId]);
  const groups = map.get(matchId) || map.get(String(matchId)) || map.get(Number(matchId));
  if (!groups) { console.log('  (aucun groupe)'); return; }
  const names = Object.keys(groups);
  console.log(`  ${names.length} groupes retournés :`);
  for (const gn of names) {
    const list = groups[gn] || [];
    const active = list.filter((o) => o?.status === 1 && Number(o.cf) > 1);
    const sample = active.slice(0, 3).map((o) => `outcome="${o.outcome}" name="${o.name}" cf=${o.cf}`).join(' | ');
    console.log(`    "${gn}" (${active.length}/${list.length} actif)`);
    if (sample) console.log(`      ex: ${sample}`);
  }
}

async function main() {
  console.log('▶ 1win TT groups dump — match user + échantillon\n');

  // Match user F12 : orest-hura-vs-anton-shypilov-38655958
  await dumpMatch(38655958);

  // Prendre 2 autres matchs TT en cours pour comparer
  const matches = await onewin.listMatches({ sport: 'table_tennis', live: false });
  console.log(`\nTotal listMatches TT : ${matches.length}`);
  const alt = matches.slice(0, 3);
  for (const m of alt) {
    console.log(`\n[${m.home} vs ${m.away}]`);
    await dumpMatch(m.id);
  }

  console.log('\n▶ Fin.');
  process.exit(0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
