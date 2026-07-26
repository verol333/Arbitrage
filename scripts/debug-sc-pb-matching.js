// Debug precis : pourquoi les matches Sportcash + PremierBet ne s'alignent pas
// avec 1xBet ? Pour chaque match SC/PB, on tente de trouver le meilleur candidat
// 1xBet et on affiche pourquoi ça passe ou échoue.
import { bookmakers } from '../src/bookmakers/index.js';
import { teamSim } from '../src/core/text.js';
import { orientation } from '../src/core/matching.js';

const [xbet, , , , , , sportcash, premierbet] = bookmakers;
console.log(`Loading catalogs...`);
const [xbetMatches, scMatches, pbMatches] = await Promise.all([
  xbet.listMatches({ sport: 'football' }),
  sportcash.listMatches({ sport: 'football', horizonHours: 72 }),
  premierbet.listMatches({ sport: 'football', horizonHours: 168 }),
]);
console.log(`1xBet=${xbetMatches.length} Sportcash=${scMatches.length} PremierBet=${pbMatches.length}\n`);

function fmt(ms) { return ms ? new Date(ms).toISOString().slice(11, 16) : '???'; }

function debugMatch(refBook, ref, candBook, cands) {
  const ranked = cands.map((c) => {
    const dt = (ref.start && c.start) ? Math.abs(ref.start - c.start) : null;
    const sh = teamSim(ref.home, c.home);
    const sa = teamSim(ref.away, c.away);
    const avg = (sh + sa) / 2;
    const ori = orientation(ref.home, ref.away, c.home, c.away);
    return { c, dt, sh, sa, avg, ori };
  }).sort((a, b) => (b.avg - a.avg) || ((a.dt || 1e9) - (b.dt || 1e9)));
  console.log(`\n[${refBook}] ${ref.home} vs ${ref.away} (${fmt(ref.start)})`);
  const top3 = ranked.slice(0, 3);
  for (const r of top3) {
    const dtMin = r.dt !== null ? (r.dt / 60000).toFixed(0) + 'min' : 'no-time';
    const okDt = r.dt === null || r.dt <= 30 * 60 * 1000;
    const okSim = r.sh >= 0.60 && r.sa >= 0.60 && r.avg >= 0.70;
    const okTight = r.dt !== null && r.dt <= 3 * 60 * 1000 && r.sh >= 0.40 && r.sa >= 0.40 && r.avg >= 0.55;
    const decision = (okDt && (okSim || okTight) && r.ori === 'same') ? '✅' : '❌';
    console.log(`  ${decision} [${candBook}] ${r.c.home} vs ${r.c.away} (${fmt(r.c.start)}) dt=${dtMin} sh=${r.sh.toFixed(2)} sa=${r.sa.toFixed(2)} avg=${r.avg.toFixed(2)} ori=${r.ori}`);
    if (decision === '❌') {
      const reasons = [];
      if (!okDt) reasons.push(`dt>30min`);
      if (!okSim && !okTight) reasons.push(r.dt !== null && r.dt <= 3 * 60 * 1000 ? `tight-sim<0.55` : `sim<0.70`);
      if (r.ori !== 'same') reasons.push(`orientation=${r.ori}`);
      console.log(`     → rejected: ${reasons.join(', ')}`);
    }
  }
}

console.log('\n════════════════════ SPORTCASH (10) → 1xBet ════════════════════');
for (const m of scMatches) debugMatch('sportcash', m, '1xbet', xbetMatches);

console.log('\n\n════════════════════ PREMIERBET (19) → 1xBet ════════════════════');
for (const m of pbMatches.slice(0, 10)) debugMatch('premierbet', m, '1xbet', xbetMatches);

process.exit(0);
