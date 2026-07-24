// Vérifie un match donné sur chaque bookmaker : trouve les matchs candidats
// (par similarité de nom + horaire), lit les cotes, et affiche tout côte à côte.
// Usage : DEBUG_HOME="Dynamo Moscou" DEBUG_AWAY="Locomotive Moscou" node scripts/debug-match.js

import { bookmakers } from '../../src/bookmakers/index.js';
import { teamSim } from '../../src/core/text.js';
import { matchUrl } from '../../src/scanners/urls.js';

const HOME = process.env.DEBUG_HOME;
const AWAY = process.env.DEBUG_AWAY;
if (!HOME || !AWAY) {
  console.error('Usage: DEBUG_HOME=<team> DEBUG_AWAY=<team> node scripts/debug-match.js');
  process.exit(1);
}

function score(m) {
  const s1 = (teamSim(HOME, m.home) + teamSim(AWAY, m.away)) / 2;
  const s2 = (teamSim(HOME, m.away) + teamSim(AWAY, m.home)) / 2;
  return { direct: s1, swapped: s2, best: Math.max(s1, s2) };
}

async function probe(book) {
  const line = { book: book.key, error: null, candidates: [], odds: null };
  try {
    const matches = await book.listMatches({ live: false });
    const ranked = matches.map((m) => ({ m, sc: score(m) }))
      .filter((x) => x.sc.best >= 0.35)
      .sort((a, b) => b.sc.best - a.sc.best)
      .slice(0, 3);
    line.candidates = ranked.map(({ m, sc }) => ({
      id: String(m.id), home: m.home, away: m.away,
      league: m.league || '',
      start_iso: m.start ? new Date(m.start).toISOString() : null,
      similarity: { direct: sc.direct.toFixed(3), swapped: sc.swapped.toFixed(3) },
      url: matchUrl(book.key, m),
    }));
    if (ranked.length) {
      const top = ranked[0].m;
      try {
        const odds = book.getOdds ? await book.getOdds(top) : null;
        line.odds = odds || null;
      } catch (e) { line.odds = { error: e.message }; }
    }
  } catch (e) { line.error = e.message; }
  return line;
}

(async () => {
  const out = { query: { home: HOME, away: AWAY }, at: new Date().toISOString(), books: [] };
  for (const b of bookmakers) {
    process.stderr.write(`[debug] ${b.key}...\n`);
    out.books.push(await probe(b));
  }
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
