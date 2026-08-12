// Re-probe volleyball par book après fixes (SportyBet whitelist + Congobet ligues).
// Doit maintenant : SportyBet=5, Congobet=5 avec noms lisibles.
import xbet from '../src/bookmakers/xbet/index.js';
import onewin from '../src/bookmakers/onewin/index.js';
import congobet from '../src/bookmakers/congobet/index.js';
import yellowbet from '../src/bookmakers/yellowbet/index.js';
import apollo from '../src/bookmakers/apollo/index.js';
import betmomo from '../src/bookmakers/betmomo/index.js';
import premierbet from '../src/bookmakers/premierbet/index.js';
import betpawa from '../src/bookmakers/betpawa/index.js';
import sportybet from '../src/bookmakers/sportybet/index.js';

const HORIZON = 168;

async function run(book) {
  const t0 = Date.now();
  try {
    const matches = await book.listMatches({ horizonHours: HORIZON, sport: 'volleyball' });
    const arr = Array.isArray(matches) ? matches : [];
    const leagues = new Map();
    for (const m of arr) leagues.set(m.league || '?', (leagues.get(m.league || '?') || 0) + 1);
    console.log(`\n[${book.key}] matchs=${arr.length} leagues=${leagues.size} (${Date.now()-t0}ms)`);
    arr.slice(0, 3).forEach((m) => {
      const start = m.start ? new Date(m.start).toISOString().slice(0, 16) : '?';
      console.log(`  · [${m.league || '?'}] ${m.home} vs ${m.away} @ ${start}`);
    });
    const sorted = [...leagues.entries()].sort((a,b) => b[1]-a[1]);
    const top = sorted.slice(0, 15);
    console.log(`  ligues (top ${top.length}/${leagues.size}): ${top.map(([n,c]) => `${n}(${c})`).join(' | ')}`);
  } catch (e) {
    console.log(`[${book.key}] ERR ${e.message}`);
  }
}

(async () => {
  console.log(`=== VALIDATION FIXES volleyball horizon=${HORIZON}h ===`);
  const books = [xbet, onewin, congobet, yellowbet, apollo, betmomo, premierbet, betpawa, sportybet];
  for (const b of books) await run(b);
  console.log('\n=== Fin ===');
  process.exit(0);
})();
