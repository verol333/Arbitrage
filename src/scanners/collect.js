// Orchestrateur agnostique : liste les matchs de chaque bookmaker, apparie, lit
// les cotes, compare toutes les paires. Ne connaît AUCUN nom de bookmaker en dur.
import { bookmakers } from '../bookmakers/index.js';
import { alignCatalogs } from '../core/matching.js';
import { compareTwoBooks, compareTwoBooksTennis, compareTwoBooksBasket, compareTwoBooksHockey, compareTwoBooksVolley, dedupeOpportunities } from '../core/arbitrage.js';
import { config } from '../config.js';
import { matchUrl } from './urls.js';

export const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

function pickComparator(sport) {
  switch (sport) {
    case 'tennis': return compareTwoBooksTennis;
    case 'basketball': return compareTwoBooksBasket;
    case 'hockey': return compareTwoBooksHockey;
    case 'volleyball': return compareTwoBooksVolley;
    default: return compareTwoBooks;
  }
}

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
  // Tri chronologique simple : matchs les plus proches en premier.
  // (Un tri par couverture excluait les matchs 1win/sportcash du top.)
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
  const oddsFetchedAt = new Date().toISOString();
  const compare = pickComparator(sport);
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
    const debugMatches = buildDebugMatches(matches);
    const liveSnapshot = live ? consolidateLive(matches) : null;
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const arbs = compare(oddsPerBook[keys[i]], keys[i], oddsPerBook[keys[j]], keys[j]);
      for (const a of arbs) {
        if (a.profit_pct < minP) continue;
        const legAlive = matches[a.leg_a_book]?.live || null;
        const legBlive = matches[a.leg_b_book]?.live || null;
        all.push({
          ...a, scan_id: scanId, sport, is_live: live,
          match_label: `${ref.home} vs ${ref.away}`,
          team_home: ref.home, team_away: ref.away, league: ref.league,
          kickoff_iso: ref.start ? new Date(ref.start).toISOString() : null,
          ...idFields(matches),
          status: 'live',
          ...(live ? {
            live_score: liveSnapshot?.score || null,
            live_minute: liveSnapshot?.minute ?? null,
            live_period: liveSnapshot?.period || null,
            live_score_source: liveSnapshot?.source || null,
            leg_a_live: legAlive,
            leg_b_live: legBlive,
          } : {}),
          verify: {
            odds_fetched_at: oddsFetchedAt,
            leg_a_match: debugMatches[a.leg_a_book],
            leg_b_match: debugMatches[a.leg_b_book],
          },
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

function buildDebugMatches(matches) {
  const out = {};
  for (const [k, m] of Object.entries(matches)) {
    if (!m) continue;
    out[k] = {
      id: String(m.id),
      home: m.home,
      away: m.away,
      league: m.league || '',
      start_iso: m.start ? new Date(m.start).toISOString() : null,
      url: matchUrl(k, m),
      live: m.live || null,
    };
  }
  return out;
}

// Retourne un snapshot live consolidé pour l'opportunité : on prend le premier
// bookmaker qui expose un score, avec fallback minute/période s'ils manquent.
function consolidateLive(matches) {
  const scored = [], minuted = [], periodly = [];
  for (const [k, m] of Object.entries(matches)) {
    const l = m?.live;
    if (!l) continue;
    if (l.score) scored.push({ book: k, ...l });
    if (l.minute != null) minuted.push({ book: k, ...l });
    if (l.period) periodly.push({ book: k, ...l });
  }
  const s = scored[0], m = minuted[0], p = periodly[0];
  return {
    score: s?.score || null,
    minute: m?.minute ?? null,
    period: p?.period || null,
    source: s?.book || m?.book || p?.book || null,
  };
}

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
