// Investigation "Palmeiras Sao Joao U20 vs Comercial Tiete U20" (fake arb user 2026-08-14).
// FIN Phase 1: vrai match = Osasco Sporting U20 vs Uniao Sao Joao EC U20 (Paulista U20).
// Aucun book n'expose "Palmeiras Sao Joao" ni "Comercial Tiete" → bug d'affichage
// côté UI ou backend rename.
// Phase 2 (script actuel) : fetch les vraies cotes pour ce match sur 1xBet+BetMomo,
// vérifier si match_1(Osasco) + dc_X2 = fake arb ou vrai (+56% impossible réaliste).
import xbet from '../src/bookmakers/xbet/index.js';
import betmomo from '../src/bookmakers/betmomo/index.js';
import sportybet from '../src/bookmakers/sportybet/index.js';
import betpawa from '../src/bookmakers/betpawa/index.js';
import yellowbet from '../src/bookmakers/yellowbet/index.js';

const NEEDLE = /osasco.*sport|uniao.*sao\s*joao/i;

function find(matches, book) {
  return matches.filter((m) => {
    const s = `${m.home} ${m.away}`.toLowerCase();
    return NEEDLE.test(s) && /u20|osasco/i.test(s);
  });
}

async function main() {
  console.log('▶ Verify cotes réelles Osasco U20 vs Uniao Sao Joao U20\n');
  const [xM, bmM, sbM, bpM, ybM] = await Promise.all([
    xbet.listMatches({ sport: 'football', live: false }).catch(() => []),
    betmomo.listMatches({ sport: 'football', live: false }).catch(() => []),
    sportybet.listMatches({ sport: 'football', live: false }).catch(() => []),
    betpawa.listMatches({ sport: 'football', live: false }).catch(() => []),
    yellowbet.listMatches({ sport: 'football', live: false }).catch(() => []),
  ]);
  const results = { xbet: xM, betmomo: bmM, sportybet: sbM, betpawa: bpM, yellowbet: ybM };
  const books = { xbet, betmomo, sportybet, betpawa, yellowbet };

  for (const [k, arr] of Object.entries(results)) {
    const hits = find(arr, k);
    console.log(`\n═══ [${k}] ${hits.length} matchs Osasco/Uniao Sao Joao ═══`);
    for (const m of hits.slice(0, 2)) {
      console.log(`   ${m.home} vs ${m.away}  |  ${m.league || '?'}  |  id=${m.id}  |  kick=${m.start ? new Date(m.start).toISOString() : '?'}`);
      try {
        const parsed = await books[k].getOdds(m, { sport: 'football' });
        const keys = ['match_1', 'match_X', 'match_2', 'dc_1X', 'dc_12', 'dc_X2'];
        for (const kk of keys) {
          const v = parsed[kk];
          if (v == null) continue;
          const meta = parsed._ids?.[kk] || {};
          const mn = meta.market_name_native || '?';
          const sn = meta.selection_name_native || '?';
          console.log(`      ${kk}\t= ${v}    native: "${mn}" / "${sn}"`);
        }
        // Sanity : sum implied probs
        if (parsed.match_1 && parsed.match_X && parsed.match_2) {
          const s = 1/parsed.match_1 + 1/parsed.match_X + 1/parsed.match_2;
          console.log(`      → sum probs 1X2: ${(s*100).toFixed(1)}% (marge=${((s-1)*100).toFixed(1)}%)`);
        }
        if (parsed.dc_1X && parsed.dc_12 && parsed.dc_X2) {
          const s = 1/parsed.dc_1X + 1/parsed.dc_12 + 1/parsed.dc_X2;
          console.log(`      → sum probs DC: ${(s*100).toFixed(1)}% (marge=${((s-1)*100).toFixed(1)}%)`);
        }
      } catch (e) { console.log(`      ⚠️ getOdds err: ${e.message}`); }
    }
  }

  console.log('\n═══ Analyse arb affichée : 1xBet match_1=3.65 + BetMomo dc_X2=6.20 ═══');
  console.log('   1/3.65 + 1/6.20 = 0.2740 + 0.1613 = 0.4353');
  console.log('   Si sum < 1 → arb, profit = (1/sum - 1)*100');
  console.log('   → sum=0.4353 → +129.7% profit. Or user report affiche +56.44%');
  console.log('   → Ces cotes SONT FAUSSES (impossible réaliste). Confirmons via fetch réel.');

  console.log('\n▶ Fin.');
  process.exit(0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
