#!/usr/bin/env node
// PROBE BASKET VALIDATE — pour chaque book, liste 5 matchs basket, invoque
// les PARSEURS PROD, contrôle margin (1/match_1 + 1/match_2) ∈ [0.95, 1.20].
// Détecte tout mismapping qui produirait faux surbètes en prod.
import { bookmakers } from '../src/bookmakers/index.js';

const banner = (t) => console.log(`\n═══════════ ${t} ═══════════`);
const pct = (n) => `${(n * 100).toFixed(1)}%`;

async function testBook(book) {
  banner(`${book.label} basket`);
  let matches = [];
  try {
    matches = await book.listMatches({ sport: 'basket', live: false, horizonHours: 72 });
  } catch (e) {
    return console.log(`  ❌ listMatches ERR: ${e.message}`);
  }
  console.log(`  📋 ${matches.length} matchs listés`);
  if (!matches.length) return;

  // Prend les 5 premiers en évitant duplicatas de nom
  const picks = matches.slice(0, 5);

  // Fetch odds — utilise getOddsBatch si dispo (1win WS)
  let oddsMap;
  try {
    if (book.getOddsBatch) {
      oddsMap = await book.getOddsBatch(picks, { sport: 'basket' });
    } else {
      oddsMap = new Map();
      for (const m of picks) {
        try {
          const o = await book.getOdds(m, { sport: 'basket' });
          oddsMap.set(m.id, o || {});
        } catch (e) { oddsMap.set(m.id, {}); }
      }
    }
  } catch (e) {
    return console.log(`  ❌ getOdds ERR: ${e.message}`);
  }

  let sane = 0, badMargin = 0, empty = 0;
  for (const m of picks) {
    const o = oddsMap.get(m.id) || oddsMap.get(String(m.id)) || {};
    const keys = Object.keys(o);
    if (!keys.length) { empty++; console.log(`  ▶ ${m.home} vs ${m.away} : 0 cotes`); continue; }
    const marginMatch = (o.match_1 && o.match_2) ? (1 / o.match_1 + 1 / o.match_2) : null;
    const lines = Object.keys(o).filter(k => /^match_over_/.test(k)).length;
    const hcps = Object.keys(o).filter(k => /^hcp_home_/.test(k)).length;
    const qCount = ['q1_', 'q2_', 'q3_', 'q4_'].filter(p => keys.some(k => k.startsWith(p))).length;
    const status = marginMatch ? (marginMatch >= 0.95 && marginMatch <= 1.20 ? '✅' : '⚠️FAKE') : '—';
    if (marginMatch && marginMatch >= 0.95 && marginMatch <= 1.20) sane++;
    else if (marginMatch) badMargin++;
    console.log(`  ▶ ${m.home} vs ${m.away} [${m.league}] : ${keys.length} keys | Winner=${o.match_1 || '?'}/${o.match_2 || '?'} margin=${marginMatch ? pct(marginMatch) : '—'} ${status} | totals=${lines} hcps=${hcps} periods=${qCount}`);
  }
  console.log(`  📊 ${book.label} : ✅${sane} ⚠️${badMargin} vide=${empty}`);
}

console.log('▶ PROBE BASKET VALIDATE — parsers prod × 5 matchs par book\n');
const target = new Set(['1xbet', 'betmomo', 'betpawa', 'sportybet', '1win']);
for (const book of bookmakers.filter(b => target.has(b.key))) {
  try { await testBook(book); }
  catch (e) { console.log(`❌ ${book.key} EXCEPTION: ${e.message}`); }
}
console.log('\n═══ FIN ═══');
process.exit(0);
