// Cartographie des marchés disponibles chez chaque bookmaker.
// Pour N matchs par book : lit la réponse NATIVE, liste TOUS les marchés,
// les canonicalise, puis croise les books pour dire lesquels sont
// réellement corrélables (donc arbitrables) et lesquels sont nouveaux.
//
//   node scripts/market-cartography.js [--sport=football] [--live] [--matches=3]

import fs from 'node:fs';
import path from 'node:path';
import betpawa from '../src/bookmakers/betpawa/index.js';
import sportybet from '../src/bookmakers/sportybet/index.js';
import betmomo from '../src/bookmakers/betmomo/index.js';
import yellowbet from '../src/bookmakers/yellowbet/index.js';
import congobet from '../src/bookmakers/congobet/index.js';
import apollo from '../src/bookmakers/apollo/index.js';
import onewin from '../src/bookmakers/onewin/index.js';
import { dumpRawMarkets } from '../src/cartography/rawDump.js';
import { signature } from '../src/cartography/canon.js';
import { isNewFamily } from '../src/cartography/supported.js';

const BOOKS = [betpawa, sportybet, betmomo, yellowbet, congobet, apollo, onewin];

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=')[1] : d;
};
const SPORT = arg('sport', process.env.CARTO_SPORT || 'football');
const LIVE = process.argv.includes('--live') || process.env.CARTO_LIVE === 'true';
const PER_BOOK = Number(arg('matches', process.env.CARTO_MATCHES || 5));

async function scanBook(book) {
  const out = { book: book.key, label: book.label, matches: 0, markets: 0, errors: [], sigs: new Map() };
  let list = [];
  try {
    list = await book.listMatches({ live: LIVE, sport: SPORT }) || [];
  } catch (e) {
    out.errors.push(`list: ${e.message}`);
    return out;
  }
  const picked = list.slice(0, PER_BOOK);
  for (const m of picked) {
    const res = await dumpRawMarkets(book.key, m, { live: LIVE });
    if (!res.ok) { out.errors.push(`${m.id}: ${res.reason}`); continue; }
    out.matches += 1;
    out.markets += res.markets.length;
    for (const mk of res.markets) {
      const s = signature({ marketName: mk.market_name, selections: mk.selections, home: m.home, away: m.away });
      if (!s.exploitable) continue;
      const prev = out.sigs.get(s.sig) || { sig: s.sig, family: s.family, count: 0, sample: mk.market_name, selections: mk.selections.slice(0, 4).map((x) => x.name) };
      prev.count += 1;
      out.sigs.set(s.sig, prev);
    }
  }
  return out;
}

const main = async () => {
  const t0 = Date.now();
  const results = [];
  for (const b of BOOKS) {
    const r = await scanBook(b);
    results.push(r);
    console.log(`[${r.book}] matchs=${r.matches} marches_bruts=${r.markets} signatures=${r.sigs.size}${r.errors.length ? ' err=' + r.errors.slice(0, 2).join(' / ') : ''}`);
  }

  // Croisement inter-books : une signature n'est arbitrable que si ≥2 books la proposent.
  const cross = new Map();
  for (const r of results) {
    for (const [sig, info] of r.sigs) {
      const e = cross.get(sig) || { sig, family: info.family, books: [], sample: info.sample, selections: info.selections };
      e.books.push(r.book);
      cross.set(sig, e);
    }
  }
  const linkable = [...cross.values()].filter((e) => e.books.length >= 2);
  const nouveaux = linkable.filter((e) => isNewFamily(e.family)).sort((a, b) => b.books.length - a.books.length);

  console.log('\\n=== MARCHÉS CORRÉLABLES NOUVEAUX (≥2 books, non exploités) ===');
  for (const e of nouveaux.slice(0, 80)) {
    console.log(`${e.sig.padEnd(46)} ${String(e.books.length).padStart(2)} books : ${e.books.join(',')}  ex="${e.sample}"`);
  }

  console.log('\\n=== PAR BOOKMAKER ===');
  for (const r of results) {
    const mine = nouveaux.filter((e) => e.books.includes(r.book)).length;
    console.log(`${r.book.padEnd(11)} signatures=${String(r.sigs.size).padStart(4)}  nouveaux_correlables=${mine}`);
  }

  const report = {
    generated_at: new Date().toISOString(),
    sport: SPORT, live: LIVE, matches_per_book: PER_BOOK,
    duration_sec: Math.round((Date.now() - t0) / 1000),
    books: results.map((r) => ({ book: r.book, matches: r.matches, raw_markets: r.markets, signatures: [...r.sigs.values()], errors: r.errors })),
    linkable: linkable.map((e) => ({ ...e, nouveau: isNewFamily(e.family) })),
  };
  fs.mkdirSync('reports', { recursive: true });
  const file = path.join('reports', `cartography-${SPORT}${LIVE ? '-live' : ''}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`\\nRapport écrit : ${file} (${report.duration_sec}s)`);
};

main().catch((e) => { console.error(e); process.exit(1); });
