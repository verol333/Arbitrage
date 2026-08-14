// Investigation "Palmeiras Sao Joao U20 vs Comercial Tiete U20" (fake arb user 2026-08-14).
// UI a affiché 1xBet match_1=3.65 + BetMomo dc_X2=6.20 → +56% (coupon HZ4VM).
// Etape 1 (déjà fait) : le match n'existe pas chez 1xBet ni BetMomo (Palmeiras SJ =
// Serie B U20 brésilienne, ces books ne l'ont pas).
// Etape 2 (script actuel) : scanner TOUS les books pour trouver qui a réellement
// ce match, et voir si Sociedade Esportiva Palmeiras (Serie A) est ce qui a
// été apparié faussement.
import xbet from '../src/bookmakers/xbet/index.js';
import betmomo from '../src/bookmakers/betmomo/index.js';
import yellowbet from '../src/bookmakers/yellowbet/index.js';
import betpawa from '../src/bookmakers/betpawa/index.js';
import sportybet from '../src/bookmakers/sportybet/index.js';
import onewin from '../src/bookmakers/onewin/index.js';
import congobet from '../src/bookmakers/congobet/index.js';
import apollo from '../src/bookmakers/apollo/index.js';
import premierbet from '../src/bookmakers/premierbet/index.js';
import { orientation } from '../src/core/matching.js';
import { teamSim } from '../src/core/text.js';

const BOOKS = { xbet, betmomo, yellowbet, betpawa, sportybet, onewin, congobet, apollo, premierbet };

function findPalm(matches, bookKey) {
  const hits = matches.filter((m) => /palmeiras/i.test(`${m.home} ${m.away}`));
  return hits.map((h) => ({
    book: bookKey, id: h.id, home: h.home, away: h.away,
    league: h.league || '', start: h.start || h.kickoff || null,
  }));
}

async function main() {
  console.log('▶ Cross-book Palmeiras SJ U20 vs Comercial Tiete U20 investigation\n');
  const catalogs = {};
  const errs = {};
  const proms = Object.entries(BOOKS).map(async ([k, b]) => {
    try {
      catalogs[k] = await b.listMatches({ sport: 'football', live: false });
    } catch (e) {
      errs[k] = e.message;
      catalogs[k] = [];
    }
  });
  await Promise.all(proms);

  console.log('Catalogue totals + errors:');
  for (const [k, arr] of Object.entries(catalogs)) {
    console.log(`  ${k}\t${arr.length}${errs[k] ? '  ERR:' + errs[k] : ''}`);
  }
  console.log('');

  // 1. Chercher Palmeiras dans chaque book
  console.log('═══ Toutes les entrées "palmeiras" par book ═══');
  const allPalm = [];
  for (const [k, arr] of Object.entries(catalogs)) {
    const hits = findPalm(arr, k);
    console.log(`\n[${k}] ${hits.length} matchs palmeiras :`);
    for (const h of hits) {
      const startStr = h.start ? new Date(h.start).toISOString() : '?';
      console.log(`   ${h.home} vs ${h.away}  |  ${h.league}  |  kick=${startStr}`);
    }
    allPalm.push(...hits);
  }

  // 2. Match spécifique "Sao Joao" OU "Comercial"
  console.log('\n═══ Matchs contenant "Sao Joao" OU "Comercial Tiete" (fuzzy) ═══');
  for (const [k, arr] of Object.entries(catalogs)) {
    const hits = arr.filter((m) => {
      const s = `${m.home} ${m.away}`.toLowerCase();
      return /sao\s*joao|s[aã]o.*jo[aã]o/i.test(s) || /comercial.*tiet/i.test(s);
    });
    if (hits.length) {
      console.log(`\n[${k}] ${hits.length} matchs :`);
      for (const m of hits) console.log(`   ${m.home} vs ${m.away}  |  ${m.league}  |  kick=${m.start ? new Date(m.start).toISOString() : '?'}`);
    }
  }

  // 3. Simuler le matching : ref = "Palmeiras Sao Joao U20 vs Comercial Tiete U20"
  //    contre les candidats "SE Palmeiras vs ???" de chaque book pour voir si
  //    modifiersMatch les rejette (test unitaire).
  console.log('\n═══ Simulation matching : ref vs candidats SE Palmeiras ═══');
  const ref = { home: 'Palmeiras Sao Joao U20', away: 'Comercial Tiete U20' };
  console.log(`ref: ${ref.home} vs ${ref.away}`);
  for (const h of allPalm) {
    const shH = teamSim(ref.home, h.home);
    const shA = teamSim(ref.away, h.away);
    const ori = orientation(ref.home, ref.away, h.home, h.away);
    console.log(`  [${h.book}] ${h.home} vs ${h.away}`);
    console.log(`    teamSim home=${shH.toFixed(3)} away=${shA.toFixed(3)}  orient=${ori}`);
  }

  console.log('\n▶ Fin.');
  process.exit(0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
