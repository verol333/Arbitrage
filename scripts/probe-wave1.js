// Sonde vague 1 bis : sur un MEME match partage par plusieurs books, liste tous
// les libelles de marches par book. But : savoir quelles familles coexistent
// reellement (condition de l'arbitrage) et avec quels identifiants de coupon.
import sportybet from '../src/bookmakers/sportybet/index.js';
import betmomo from '../src/bookmakers/betmomo/index.js';
import congobet from '../src/bookmakers/congobet/index.js';
import apollo from '../src/bookmakers/apollo/index.js';
import onewin from '../src/bookmakers/onewin/index.js';
import { dumpRawMarkets } from '../src/cartography/rawDump.js';
import { teamSim } from '../src/core/text.js';

const BOOKS = [sportybet, apollo, betmomo, congobet, onewin];
const TARGET = /clean sheet|odd\/even|pair|impair|corner/i;

const main = async () => {
  const lists = new Map();
  for (const b of BOOKS) {
    try { lists.set(b.key, await b.listMatches({ live: false, sport: 'football' }) || []); }
    catch (e) { console.log(`[${b.key}] list KO ${e.message}`); lists.set(b.key, []); }
  }
  // Cherche un match present chez sportybet ET au moins 2 autres books.
  const base = lists.get('sportybet') || [];
  let best = null;
  for (const m of base.slice(0, 60)) {
    const found = [{ book: 'sportybet', m }];
    for (const b of BOOKS) {
      if (b.key === 'sportybet') continue;
      const hit = (lists.get(b.key) || []).find((x) =>
        teamSim(x.home, m.home) > 0.72 && teamSim(x.away, m.away) > 0.72);
      if (hit) found.push({ book: b.key, m: hit });
    }
    if (found.length >= 3) { best = found; break; }
  }
  if (!best) { console.log('aucun match partage par 3 books'); return; }
  console.log(`MATCH PARTAGE : ${best[0].m.home} - ${best[0].m.away} chez ${best.map((f) => f.book).join(',')}\n`);

  for (const { book, m } of best) {
    const res = await dumpRawMarkets(book, m, { live: false });
    if (!res.ok) { console.log(`--- ${book} : KO ${res.reason}`); continue; }
    const all = res.markets.map((x) => x.market_name);
    const cibles = res.markets.filter((x) => TARGET.test(x.market_name));
    console.log(`--- ${book} (${m.id}) : ${all.length} marches, ${cibles.length} cibles`);
    for (const x of cibles) console.log(`      ${x.market_name}  ->  ${x.selections.map((s) => `${s.name}@${s.odds}`).join(' | ')}`);
  }
};
main().catch((e) => { console.error(e); process.exit(1); });
