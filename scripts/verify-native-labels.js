// Vérifie que les 3 champs natifs (market_name_native, selection_name_native,
// market_path_native) sont bien peuplés dans odds._ids[key] par les parseurs
// Apollo et Congobet, pour foot + TT.
import apollo from '../src/bookmakers/apollo/index.js';
import congobet from '../src/bookmakers/congobet/index.js';
import yellowbet from '../src/bookmakers/yellowbet/index.js';
import betmomo from '../src/bookmakers/betmomo/index.js';
import sportybet from '../src/bookmakers/sportybet/index.js';
import betpawa from '../src/bookmakers/betpawa/index.js';
import onewin from '../src/bookmakers/onewin/index.js';
import xbet from '../src/bookmakers/xbet/index.js';
import premierbet from '../src/bookmakers/premierbet/index.js';

async function check(book, sport, minKeys = 3) {
  console.log(`\n═══ ${book.key.toUpperCase()} ${sport.toUpperCase()} ═══`);
  let matches;
  try { matches = await book.listMatches({ sport, live: false }); }
  catch (e) { console.log(`  ⚠️  listMatches error: ${e.message}`); return; }
  console.log(`  listMatches: ${matches.length}`);
  if (!matches.length) return;
  const sample = matches.slice(0, 3);
  for (const m of sample) {
    let parsed;
    try { parsed = await book.getOdds(m, { sport }); }
    catch (e) { console.log(`  ⚠️  ${m.home} vs ${m.away} — getOdds error: ${e.message}`); continue; }
    const ids = parsed?._ids || {};
    const keys = Object.keys(ids);
    if (!keys.length) { console.log(`  ⚠️  ${m.home} vs ${m.away} — no _ids emitted`); continue; }
    // Pick up to N keys with labels
    const kk = keys.slice(0, 5);
    console.log(`\n  ${m.home} vs ${m.away} (${keys.length} keys)`);
    for (const k of kk) {
      const meta = ids[k];
      const mn = meta.market_name_native || '(null)';
      const sn = meta.selection_name_native || '(null)';
      const pn = meta.market_path_native || '(null)';
      console.log(`    ${k}=${parsed[k]}`);
      console.log(`      market_native="${mn}"  selection_native="${sn}"  path="${pn}"`);
    }
    // Also compute pct of keys with market_name_native populated
    const withLabels = keys.filter((k) => ids[k]?.market_name_native).length;
    const pct = Math.round((withLabels / keys.length) * 100);
    console.log(`    → ${withLabels}/${keys.length} keys ont market_name_native (${pct}%)`);
  }
}

console.log('▶ VERIFY libellés natifs (P2)\n');
await check(apollo, 'football');
await check(congobet, 'football');
await check(yellowbet, 'football');
await check(betmomo, 'football');
await check(sportybet, 'football');
await check(betpawa, 'football');
await check(onewin, 'football');
await check(xbet, 'football');
await check(premierbet, 'football');
await check(apollo, 'table_tennis');
await check(congobet, 'table_tennis');
console.log('\n▶ Fin.');
process.exit(0);
