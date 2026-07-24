// Orchestrateur agnostique : liste les matchs de chaque bookmaker, apparie, lit
// les cotes, compare toutes les paires. Ne connaît AUCUN nom de bookmaker en dur.
import { bookmakers } from '../bookmakers/index.js';
import { alignCatalogs } from '../core/matching.js';
import { compareTwoBooks, compareTwoBooksTennis, dedupeOpportunities } from '../core/arbitrage.js';
import { config } from '../config.js';

export const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

// Chaque bookmaker peut planter indépendamment — try/catch par source.
async function listSafe(book, opts) {
  try {
    const matches = await book.listMatches(opts);
    return { book, matches: matches || [] };
  } catch (e) {
    log(`⚠️ ${book.key} listMatches: ${e.message || e}`);
    return { book, matches: [] };
  }
}

async function readOddsSafe(book, matches, opts) {
  const map = new Map();
  if (!matches.length) return map;
  try {
    if (book.getOddsBatch) {
      const batch = await book.getOddsBatch(matches, opts);
      for (const [id, odds] of batch) map.set(id, odds || {});
      return map;
    }
    const BATCH = 15;
    for (let i = 0; i < matches.length; i += BATCH) {
      const chunk = matches.slice(i, i + BATCH);
      const results = await Promise.all(chunk.map((m) => book.getOdds(m, opts).catch((e) => {
        log(`⚠️ ${book.key} getOdds(${m.id}): ${e.message || e}`);
        return {};
      })));
      chunk.forEach((m, k) => map.set(m.id, results[k] || {}));
    }
    return map;
  } catch (e) {
    log(`⚠️ ${book.key} getOdds batch: ${e.message || e}`);
    return map;
  }
}

// Lance un scan complet (prématch ou live) et retourne les opportunités trouvées.
export async function runScan({ live = false, horizonHours, minProfit, maxMatches, sport = 'football' } = {}) {
  const t0 = Date.now();
  const usable = bookmakers.filter((b) => live ? b.supports.live : b.supports.prematch);
  const listOpts = { live, horizonHours: horizonHours ?? config.scan.horizonHours, sport };
  const listed = await Promise.all(usable.map((b) => listSafe(b, listOpts)));

  const catalogs = new Map();
  for (const { book, matches } of listed) catalogs.set(book.key, matches);
  log(`📋 ${sport.toUpperCase()} ${live ? 'LIVE' : 'PRÉMATCH'} — ${[...catalogs].map(([k, v]) => `${k}:${v.length}`).join(' | ')}`);

  const horizonMs = live ? null : Date.now() + (horizonHours ?? config.scan.horizonHours) * 3600 * 1000;
  const entries = alignCatalogs(catalogs, { minBooks: 2, horizonMs });
  const cap = Math.min(maxMatches ?? config.scan.maxMatches, 500);
  const sorted = entries
    .map((e) => ({ e, start: e.ref.start || Infinity }))
    .sort((a, b) => a.start - b.start)
    .slice(0, cap)
    .map((s) => s.e);
  log(`🔗 ${sorted.length}/${entries.length} matchs exploitables (≥2 books)`);
  if (!sorted.length) return { opportunities: [], stats: { catalogs: [...catalogs].map(([k, v]) => ({ book: k, matches: v.length })), entries: 0, duration_ms: Date.now() - t0 } };

  const oddsByBook = new Map();
  const oddsJobs = usable.map(async (b) => {
    const inScope = sorted.map((e) => e.matches[b.key]).filter(Boolean);
    oddsByBook.set(b.key, await readOddsSafe(b, inScope, listOpts));
  });
  await Promise.all(oddsJobs);
  const covered = usable.map((b) => `${b.key}:${[...oddsByBook.get(b.key)].filter(([, o]) => Object.keys(o || {}).length).length}`);
  log(`💰 cotes lues — ${covered.join(' | ')}`);

  const scanId = `${live ? 'live' : 'scan'}_${Date.now()}`;
  const minP = minProfit ?? (live ? config.scan.minProfitLive : config.scan.minProfitPrematch);
  const compare = sport === 'tennis' ? compareTwoBooksTennis : compareTwoBooks;
  const all = [];
  for (const entry of sorted) {
    const { ref, matches } = entry;
    const oddsPerBook = {};
    for (const b of usable) {
      const m = matches[b.key];
      const o = m ? oddsByBook.get(b.key).get(m.id) : null;
      if (o && Object.keys(o).length) oddsPerBook[b.key] = o;
    }
    const keys = Object.keys(oddsPerBook);
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const arbs = compare(oddsPerBook[keys[i]], keys[i], oddsPerBook[keys[j]], keys[j]);
      for (const a of arbs) {
        if (a.profit_pct < minP) continue;
        all.push({
          ...a, scan_id: scanId, sport, is_live: live,
          match_label: `${ref.home} vs ${ref.away}`,
          team_home: ref.home, team_away: ref.away, league: ref.league,
          kickoff_iso: ref.start ? new Date(ref.start).toISOString() : null,
          ...idFields(matches),
          status: 'live',
        });
      }
    }
  }
  const deduped = dedupeOpportunities(all).sort((a, b) => b.profit_pct - a.profit_pct);
  log(`🎯 ${deduped.length} opportunités ≥ ${minP}% | ${Date.now() - t0}ms`);
  return {
    opportunities: deduped,
    stats: {
      catalogs: [...catalogs].map(([k, v]) => ({ book: k, matches: v.length })),
      entries: sorted.length,
      duration_ms: Date.now() - t0,
    },
  };
}

// IDs de match par bookmaker (utile pour l'écriture Base44).
function idFields(matches) {
  const idKeyMap = {
    '1xbet': 'onexbet_match_id', '1win': 'onewin_match_id', congobet: 'congobet_match_id',
    yellowbet: 'yellowbet_match_id', apollo: 'apollo_match_id', betmomo: 'betmomo_match_id',
    sportcash: 'sportcash_match_id', premierbet: 'premierbet_match_id',
  };
  const out = {};
  for (const [k, m] of Object.entries(matches)) {
    const target = idKeyMap[k];
    if (target && m?.id != null) out[target] = String(m.id);
  }
  return out;
}
