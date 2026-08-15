// Valide TT pipeline sur 4 books : SportyBet, 1xBet, BetMomo, 1win.
import sportybet from '../src/bookmakers/sportybet/index.js';
import xbet from '../src/bookmakers/xbet/index.js';
import betmomo from '../src/bookmakers/betmomo/index.js';
import onewin from '../src/bookmakers/onewin/index.js';

const BOOKS = { sportybet, xbet, betmomo, onewin };

async function main() {
  console.log('▶ Verify Table Tennis pipeline sur 4 books\n');
  for (const [name, book] of Object.entries(BOOKS)) {
    console.log(`\n═══ [${name}] Table Tennis ═══`);
    try {
      const matches = await book.listMatches({ sport: 'table_tennis', live: false });
      console.log(`  listMatches: ${matches.length}`);
      if (!matches.length) { console.log('  ⚠️ 0 match — pipeline listMatches n\'a rien récupéré.'); continue; }

      const sample = matches.slice(0, 2);
      for (const m of sample) {
        console.log(`  ${m.home} vs ${m.away}  |  ${m.league || '?'}  |  id=${m.id}  |  kick=${m.start ? new Date(m.start).toISOString() : '?'}`);
        try {
          const parsed = await book.getOdds(m, { sport: 'table_tennis' });
          const keys = Object.keys(parsed).filter((k) => k !== '_ids');
          console.log(`    ${keys.length} clés parsées`);
          const priority = ['match_1', 'match_2', 's1_match_1', 's1_match_2', 's2_match_1', 's2_match_2'];
          for (const k of priority) {
            if (parsed[k] != null) {
              const meta = parsed._ids?.[k] || {};
              console.log(`    ${k}\t= ${parsed[k]}    native: "${meta.market_name_native || '?'}" / "${meta.selection_name_native || '?'}"`);
            }
          }
          if (parsed.match_1 && parsed.match_2) {
            const s = 1 / parsed.match_1 + 1 / parsed.match_2;
            console.log(`    → sum 1X2: ${(s*100).toFixed(1)}% marge=${((s-1)*100).toFixed(1)}%`);
          }
        } catch (e) { console.log(`    ⚠️ getOdds err: ${e.message}`); }
      }
    } catch (e) { console.log(`  ⚠️ listMatches err: ${e.message}`); }
  }
  console.log('\n▶ Fin.');
  process.exit(0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
