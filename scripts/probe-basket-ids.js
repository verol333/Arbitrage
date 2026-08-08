#!/usr/bin/env node
// PROBE BASKET VERIFY OPPS — vérifie que les opps envoyées au webhook sont RÉELLES.
// Pour chaque opp du dernier scan, fetch les cotes RAW sur les 2 books impliqués
// et compare avec la valeur envoyée. Détecte fake surbète ou parsing bug.
import { bookmakers } from '../src/bookmakers/index.js';

const banner = (t) => console.log(`\n═══════════ ${t} ═══════════`);
const pct = (n) => `${(n * 100).toFixed(1)}%`;

// Opps observées dans dernier scan (cycle 2 21:47)
const OPPS = [
  { match: 'Brazil (Women) vs Paraguay (Women)', period: 'q1', bookA: '1xbet', oddA: 1.83, bookB: '1win', oddB: 7.7, sideA: 'match_1', sideB: 'match_2' },
  { match: 'Olimpia Kings vs Deportivo Amambay', period: 'q1', bookA: '1xbet', oddA: 1.81, bookB: 'betmomo', oddB: 4.3, sideA: 'match_1', sideB: 'match_2' },
  { match: 'Gold Coast Rollers vs Ipswich Force', period: 'q1', bookA: '1xbet', oddA: 1.83, bookB: 'sportybet', oddB: 3.5, sideA: 'match_1', sideB: 'match_2' },
  { match: 'Norths Bears vs Central Coast', period: 'q1', bookA: '1xbet', oddA: 1.81, bookB: 'sportybet', oddB: 3.2, sideA: 'match_1', sideB: 'match_2' },
  { match: 'Gold Coast Rollers vs Ipswich Force', period: 'q2', bookA: '1xbet', oddA: 1.83, bookB: 'sportybet', oddB: 3.1, sideA: 'match_1', sideB: 'match_2' },
];

function norm(s) {
  return String(s || '').toLowerCase().replace(/\(w\)|\(women\)|\bw\b/g, '').replace(/[^a-z0-9]/g, '');
}

async function findMatch(book, matchLabel) {
  const parts = matchLabel.split(' vs ');
  if (parts.length !== 2) return null;
  const [homeStr, awayStr] = parts.map(s => norm(s));
  try {
    const matches = await book.listMatches({ sport: 'basket', live: false, horizonHours: 72 });
    for (const m of matches) {
      const h = norm(m.home), a = norm(m.away);
      if ((h.includes(homeStr.slice(0, 8)) || homeStr.includes(h.slice(0, 8))) &&
          (a.includes(awayStr.slice(0, 8)) || awayStr.includes(a.slice(0, 8)))) return m;
      // Try inverted (home/away swapped)
      if ((a.includes(homeStr.slice(0, 8)) || homeStr.includes(a.slice(0, 8))) &&
          (h.includes(awayStr.slice(0, 8)) || awayStr.includes(h.slice(0, 8)))) return { ...m, __inverted: true };
    }
  } catch (e) { console.log(`   ⚠️ ${book.key} list err: ${e.message}`); }
  return null;
}

async function verifyOpp(opp) {
  banner(`${opp.match} [${opp.period.toUpperCase()} Vainqueur]`);
  console.log(`  ORIGINAL: ${opp.bookA}@${opp.oddA} (${opp.sideA}) vs ${opp.bookB}@${opp.oddB} (${opp.sideB})`);
  console.log(`  Margin claimed: ${pct(1 / opp.oddA + 1 / opp.oddB)}`);

  const bookA = bookmakers.find(b => b.key === opp.bookA);
  const bookB = bookmakers.find(b => b.key === opp.bookB);
  if (!bookA || !bookB) return console.log(`   ❌ book not found`);

  const [mA, mB] = await Promise.all([findMatch(bookA, opp.match), findMatch(bookB, opp.match)]);
  console.log(`  ${opp.bookA}: ${mA ? `id=${mA.id} home="${mA.home}" away="${mA.away}"${mA.__inverted ? ' ⚠️INVERTED' : ''}` : '❌ NOT FOUND'}`);
  console.log(`  ${opp.bookB}: ${mB ? `id=${mB.id} home="${mB.home}" away="${mB.away}"${mB.__inverted ? ' ⚠️INVERTED' : ''}` : '❌ NOT FOUND'}`);
  if (!mA || !mB) return;

  // Fetch fresh odds
  const [oA, oB] = await Promise.all([
    bookA.getOdds(mA, { sport: 'basket', noCache: true }).catch(e => ({ err: e.message })),
    bookB.getOdds(mB, { sport: 'basket', noCache: true }).catch(e => ({ err: e.message })),
  ]);

  const keyA = `${opp.period}_${opp.sideA}`;
  const keyB = `${opp.period}_${opp.sideB}`;
  const freshA = oA[keyA];
  const freshB = oB[keyB];

  console.log(`  ${opp.bookA} fresh ${keyA}=${freshA} (original ${opp.oddA})`);
  console.log(`  ${opp.bookB} fresh ${keyB}=${freshB} (original ${opp.oddB})`);
  // Dump les 4 outcomes possibles pour debug (winner + hcp match)
  console.log(`  ${opp.bookA} match_1=${oA.match_1} match_2=${oA.match_2} q1_match_1=${oA.q1_match_1} q1_match_2=${oA.q1_match_2} q2_match_1=${oA.q2_match_1} q2_match_2=${oA.q2_match_2}`);
  console.log(`  ${opp.bookB} match_1=${oB.match_1} match_2=${oB.match_2} q1_match_1=${oB.q1_match_1} q1_match_2=${oB.q1_match_2} q2_match_1=${oB.q2_match_1} q2_match_2=${oB.q2_match_2}`);

  if (freshA && freshB) {
    const margin = 1 / freshA + 1 / freshB;
    const verdict = margin < 1 ? `✅ VRAIE ARB ${pct(1 - margin)}` : `❌ NON-ARB (margin ${pct(margin)})`;
    console.log(`  → ${verdict}`);
  } else {
    console.log(`  → ⚠️ CANNOT VERIFY (fresh key missing)`);
  }
}

console.log('▶ PROBE BASKET VERIFY OPPS — re-fetch cotes réelles\n');
for (const opp of OPPS) {
  try { await verifyOpp(opp); }
  catch (e) { console.log(`❌ EXCEPTION: ${e.message}`); }
}
console.log('\n═══ FIN ═══');
process.exit(0);
