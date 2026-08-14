// Valide le pipeline SportyBet Table Tennis : list + parse.
import sportybet from '../src/bookmakers/sportybet/index.js';

async function main() {
  console.log('▶ Verify SportyBet Table Tennis pipeline\n');
  const matches = await sportybet.listMatches({ sport: 'table_tennis', live: false });
  console.log(`listMatches TT : ${matches.length}`);
  if (!matches.length) { console.log('⚠️ Aucun match — pipeline ne récupère rien.'); process.exit(1); }

  console.log('\nEchantillon 5 matchs :');
  for (const m of matches.slice(0, 5)) {
    console.log(`  ${m.home} vs ${m.away}  |  ${m.league || '?'}  |  id=${m.id}  |  kick=${m.start ? new Date(m.start).toISOString() : '?'}`);
  }

  console.log('\n═══ Parse odds pour les 3 premiers ═══');
  for (const m of matches.slice(0, 3)) {
    console.log(`\n▶ ${m.home} vs ${m.away}`);
    try {
      const parsed = await sportybet.getOdds(m, { sport: 'table_tennis' });
      const keys = Object.keys(parsed).filter((k) => k !== '_ids');
      console.log(`   ${keys.length} clés parsées`);
      const sample = ['match_1', 'match_2', 's1_match_1', 's1_match_2', 's2_match_1', 's2_match_2', 'total_sets_2', 'total_sets_3'];
      for (const k of sample) {
        if (parsed[k] != null) {
          const meta = parsed._ids?.[k] || {};
          console.log(`   ${k}\t= ${parsed[k]}    native: "${meta.market_name_native || '?'}" / "${meta.selection_name_native || '?'}"`);
        }
      }
      // Cotes hcp/total distincts
      const hcpKeys = keys.filter((k) => /^hcp_/.test(k)).slice(0, 3);
      const overKeys = keys.filter((k) => /^match_over_/.test(k)).slice(0, 3);
      for (const k of [...hcpKeys, ...overKeys]) {
        const meta = parsed._ids?.[k] || {};
        console.log(`   ${k}\t= ${parsed[k]}    native: "${meta.market_name_native || '?'}" / "${meta.selection_name_native || '?'}"`);
      }
      // Sanity : sum probs 1X2 = 2way donc ~1.05-1.20
      if (parsed.match_1 && parsed.match_2) {
        const s = 1 / parsed.match_1 + 1 / parsed.match_2;
        console.log(`   → sum probs match: ${(s*100).toFixed(1)}% (marge=${((s-1)*100).toFixed(1)}%)`);
      }
    } catch (e) { console.log(`   ⚠️ err: ${e.message}`); }
  }

  console.log('\n▶ Fin.');
  process.exit(0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
