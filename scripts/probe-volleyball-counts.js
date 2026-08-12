// Probe volleyball : compter le nombre RÉEL de matchs disponibles sur chaque book
// (horizon 72h), sans filtrage, pour identifier ceux qui sous-comptent.
// Usage GH Actions : workflow_dispatch dédié.
import { listPrematch as xbetList } from '../src/bookmakers/xbet/list.js';
import { listPrematch as onewinList } from '../src/bookmakers/onewin/list.js';
import { listPrematch as congoList } from '../src/bookmakers/congobet/list.js';
import { listPrematch as yellowList } from '../src/bookmakers/yellowbet/list.js';
import { listPrematch as apolloList } from '../src/bookmakers/apollo/list.js';
import { listPrematch as betmomoList } from '../src/bookmakers/betmomo/list.js';
import { listPrematch as pbList } from '../src/bookmakers/premierbet/list.js';
import { listPrematch as bpList } from '../src/bookmakers/betpawa/list.js';
import { listPrematch as sbList } from '../src/bookmakers/sportybet/list.js';

const HORIZON = 168; // 7 jours

async function run(name, fn) {
  const t0 = Date.now();
  try {
    const matches = await fn();
    const leagues = new Set(matches.map((m) => m.league).filter(Boolean));
    console.log(`[${name}] matchs=${matches.length} leagues=${leagues.size} (${Date.now()-t0}ms)`);
    // Sample 3 matchs
    matches.slice(0, 3).forEach((m) => {
      console.log(`  · [${m.league}] ${m.home} vs ${m.away} @ ${m.start ? new Date(m.start).toISOString() : '?'}`);
    });
    // List all leagues
    if (leagues.size <= 30) {
      console.log(`  ligues: ${[...leagues].join(' | ')}`);
    } else {
      console.log(`  ligues (${leagues.size}, top10): ${[...leagues].slice(0, 10).join(' | ')}`);
    }
  } catch (e) {
    console.log(`[${name}] ERR ${e.message}`);
  }
}

(async () => {
  console.log(`=== Probe volleyball horizon=${HORIZON}h ===\n`);
  await run('1xbet', () => xbetList(HORIZON, 'volleyball'));
  await run('1win', () => onewinList(HORIZON, 'volleyball'));
  await run('congobet', () => congoList(HORIZON, 'volleyball'));
  await run('yellowbet', () => yellowList(HORIZON, 'volleyball'));
  await run('apollo', () => apolloList(HORIZON, 'volleyball'));
  await run('betmomo', () => betmomoList(HORIZON, 'volleyball'));
  await run('premierbet', () => pbList(HORIZON, 'volleyball'));
  await run('betpawa', () => bpList(HORIZON, 'volleyball'));
  await run('sportybet', () => sbList(HORIZON, 'volleyball'));
  console.log('\n=== Fin ===');
  process.exit(0);
})();
