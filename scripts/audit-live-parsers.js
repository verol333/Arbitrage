// Audit précis parseur live YB/BM/Congobet — dump raw markets vs parsed keys
// pour comparer avec les cotes réelles sur le site.
import { bookmakers } from '../src/bookmakers/index.js';
import { yellowbetFlatOdds } from '../src/bookmakers/yellowbet/parse.js';
import { betmomoFlatOdds } from '../src/bookmakers/betmomo/parse.js';

const [xbet, onewin, congobet, yellowbet, apollo, betmomo] = bookmakers;

// Focus : YB + BM + Congobet en LIVE, 1 match chacun
async function auditBook(book, parseFn, rawField) {
  console.log(`\n════════════════════ ${book.label.toUpperCase()} LIVE ════════════════════`);
  try {
    const live = await book.listMatches({ live: true, sport: 'football' });
    console.log(`Live matches count = ${live.length}`);
    if (!live.length) return;

    // Prendre les 2 premiers matches
    for (const m of live.slice(0, 2)) {
      console.log(`\n──── ${m.home} vs ${m.away}   score=${m.live?.score || 'null'}   min=${m.live?.minute || 'null'}`);
      let raw = m.__raw?.[rawField] || [];
      // BetMomo : il faut potentiellement fetch les markets via getOdds si list vide
      if (!raw.length && book.key === 'betmomo') {
        const parsed = await book.getOdds(m);
        console.log(`  raw vide, parsed via getOdds : ${Object.keys(parsed).length} keys`);
        for (const [k, v] of Object.entries(parsed).slice(0, 40)) console.log(`    ${k} = ${v}`);
        continue;
      }
      console.log(`  Raw markets bruts (${raw.length}) — tous les noms + outcomes :`);
      for (const mkt of raw.slice(0, 40)) {
        const outsList = book.key === 'yellowbet' ? (mkt.odds || []) :
                          book.key === 'betmomo' ? (mkt.outcomes || []) :
                          (mkt.eqs || mkt.eps || []);
        const outs = outsList.slice(0, 8).map((o) => {
          const label = o.n ?? o.name ?? o.et ?? o.id ?? '?';
          const price = o.p ?? o.price ?? o.value ?? o.cot ?? o.c ?? '?';
          const line = o.l ?? o.sp ?? o.hc ?? o.point ?? '';
          return `"${label}"=${price}${line !== '' ? ` (l=${line})` : ''}`;
        }).join(' | ');
        const mktName = mkt.n ?? mkt.name ?? mkt.dn ?? mkt.type ?? mkt.cs ?? '?';
        console.log(`    "${mktName}" [${outs}]`);
      }
      // Parse via le vrai parser
      const parsed = parseFn(raw);
      console.log(`\n  Parsed keys (${Object.keys(parsed).length}) — attribution finale :`);
      const sortedKeys = Object.entries(parsed).sort(([a], [b]) => a.localeCompare(b));
      for (const [k, v] of sortedKeys) console.log(`    ${k} = ${v}`);
    }
  } catch (e) { console.log(`  ERR ${e.message}`); }
}

// Congobet a un flow différent : list donne les matches, getOdds fetch les markets
async function auditCongobet() {
  console.log(`\n════════════════════ CONGOBET LIVE ════════════════════`);
  try {
    const live = await congobet.listMatches({ live: true, sport: 'football' });
    console.log(`Live matches count = ${live.length}`);
    for (const m of live.slice(0, 1)) {
      console.log(`\n──── ${m.home} vs ${m.away}   score=${m.live?.score || 'null'}   min=${m.live?.minute || 'null'}`);
      const odds = await congobet.getOdds(m);
      console.log(`  Parsed keys (${Object.keys(odds).length}) :`);
      const sortedKeys = Object.entries(odds).sort(([a], [b]) => a.localeCompare(b));
      for (const [k, v] of sortedKeys) console.log(`    ${k} = ${v}`);
    }
  } catch (e) { console.log(`  ERR ${e.message}`); }
}

await auditBook(yellowbet, yellowbetFlatOdds, 'bts');
await auditBook(betmomo, betmomoFlatOdds, 'markets');
await auditCongobet();
process.exit(0);
