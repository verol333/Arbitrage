// Health-check complet : 8 books × prematch+live × foot
// Pour chaque : listMatches, sample getOdds sur 3 matchs, mesures temps + coverage markets
import { bookmakers } from '../src/bookmakers/index.js';

const HORIZON = 168;
const SAMPLE_MATCHES = 3;

function summarizeOdds(odds) {
  const keys = Object.keys(odds || {});
  const groups = { match: 0, dc: 0, btts: 0, total: 0, hcp: 0, ht: 0, h2: 0, corner: 0, tt: 0, other: 0 };
  for (const k of keys) {
    if (/^match_/.test(k)) groups.match++;
    else if (/^dc_/.test(k)) groups.dc++;
    else if (/^btts/.test(k)) groups.btts++;
    else if (/^(over|under)_/.test(k)) groups.total++;
    else if (/^hcp_/.test(k)) groups.hcp++;
    else if (/^ht_/.test(k)) groups.ht++;
    else if (/^h2_/.test(k)) groups.h2++;
    else if (/^cor_/.test(k)) groups.corner++;
    else if (/^tt_/.test(k)) groups.tt++;
    else groups.other++;
  }
  return { total: keys.length, groups, sample: keys.slice(0, 8) };
}

async function auditBook(book, live) {
  const mode = live ? 'live' : 'prematch';
  if (!book.supports[mode]) return { book: book.key, mode, skipped: 'unsupported' };
  const t0 = Date.now();
  let matches = [];
  try {
    matches = await book.listMatches({ live, sport: 'football', horizonHours: HORIZON });
  } catch (e) {
    return { book: book.key, mode, error: `listMatches: ${e.message}`, elapsed_list_ms: Date.now() - t0 };
  }
  const listMs = Date.now() - t0;
  const summary = { book: book.key, mode, list_matches: matches.length, elapsed_list_ms: listMs };
  if (!matches.length) return summary;

  // Sample first N matches (avoid over-load Scrape.do etc.)
  const sample = matches.slice(0, SAMPLE_MATCHES);
  const t1 = Date.now();
  const oddsResults = [];
  if (book.getOddsBatch) {
    try {
      const map = await book.getOddsBatch(sample, { live, sport: 'football' });
      for (const m of sample) oddsResults.push({ id: m.id, odds: map.get(m.id) || {} });
    } catch (e) {
      summary.batch_error = e.message;
      for (const m of sample) oddsResults.push({ id: m.id, odds: {} });
    }
  } else {
    for (const m of sample) {
      try {
        const odds = await book.getOdds(m, { live, sport: 'football' });
        oddsResults.push({ id: m.id, odds: odds || {} });
      } catch (e) {
        oddsResults.push({ id: m.id, odds: {}, error: e.message });
      }
    }
  }
  const oddsMs = Date.now() - t1;
  summary.elapsed_odds_ms = oddsMs;
  summary.sample_size = sample.length;
  summary.samples = oddsResults.map((r, i) => ({
    match: `${sample[i].home} vs ${sample[i].away}`,
    id: r.id,
    ...summarizeOdds(r.odds),
    error: r.error,
  }));
  summary.total_market_keys = oddsResults.reduce((a, r) => a + Object.keys(r.odds || {}).length, 0);
  summary.avg_markets_per_match = summary.total_market_keys / (sample.length || 1);
  return summary;
}

const modes = process.argv.slice(2);
const doPrematch = !modes.length || modes.includes('prematch');
const doLive = !modes.length || modes.includes('live');

console.log(`Audit ${bookmakers.length} books × [${[doPrematch && 'prematch', doLive && 'live'].filter(Boolean).join(', ')}]\n`);

const all = [];
for (const book of bookmakers) {
  if (doPrematch) {
    console.log(`--- ${book.key} PREMATCH ---`);
    const r = await auditBook(book, false);
    console.log(JSON.stringify(r, null, 2));
    all.push(r);
  }
  if (doLive) {
    console.log(`--- ${book.key} LIVE ---`);
    const r = await auditBook(book, true);
    console.log(JSON.stringify(r, null, 2));
    all.push(r);
  }
}

console.log('\n=== HEALTH MATRIX ===');
console.log('book                | mode     | list |  listMs | oddsMs | avgMarkets | status');
console.log('--------------------|----------|------|---------|--------|------------|--------');
for (const r of all) {
  const status = r.error ? '❌ ERR' : r.skipped ? '⏭  skip' : r.list_matches === 0 ? '⚠  empty' : r.avg_markets_per_match >= 3 ? '✅ OK' : '⚠  low';
  const avg = (r.avg_markets_per_match || 0).toFixed(1);
  console.log(`${(r.book||'').padEnd(20)}| ${(r.mode||'').padEnd(9)}| ${String(r.list_matches ?? '-').padStart(4)} | ${String(r.elapsed_list_ms ?? '-').padStart(7)} | ${String(r.elapsed_odds_ms ?? '-').padStart(6)} | ${String(avg).padStart(10)} | ${status}${r.error?' '+r.error.slice(0,50):''}`);
}

// Cross-book market intersection (which markets exist across N+ books)
console.log('\n=== MARKET COVERAGE ===');
const marketBooks = {};
for (const r of all) {
  if (!r.samples) continue;
  for (const s of r.samples) {
    for (const k of (s.sample || [])) {
      const family = k.replace(/[-+]?\d+(?:\.\d+)?$/, '<N>').replace(/_1\.5$|_2\.5$|_3\.5$/, '_<N>');
      marketBooks[family] = marketBooks[family] || new Set();
      marketBooks[family].add(r.book);
    }
  }
}
const sortedMarkets = Object.entries(marketBooks).map(([m, s]) => [m, [...s].sort()]).sort((a, b) => b[1].length - a[1].length);
for (const [m, bs] of sortedMarkets) console.log(`  ${m.padEnd(30)} ${bs.length} books  [${bs.join(', ')}]`);

process.exit(0);
