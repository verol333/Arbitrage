// Orchestrateur agnostique : liste les matchs de chaque bookmaker, apparie, lit
// les cotes, compare toutes les paires. Ne connaît AUCUN nom de bookmaker en dur.
import { bookmakers } from '../bookmakers/index.js';
import { alignCatalogs } from '../core/matching.js';
import { compareTwoBooks, compareTwoBooksTennis, compareTwoBooksBasket, compareTwoBooksHockey, compareTwoBooksVolley, dedupeOpportunities } from '../core/arbitrage.js';
import { config } from '../config.js';
import { matchUrl } from './urls.js';

export const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

// Fin de fenetre prematch Congo-Brazzaville (UTC+1 fixe, pas d'heure d'ete).
// Fenetre = 'aujourd'hui + demain complet' = cutoff a minuit Congo J+2.
// A 6h Congo : cutoff = ~42h de matchs a venir.
// A 20h Congo : cutoff = ~28h de matchs a venir.
// Sinon en fin de journee on n'aurait que 2-3h de matchs restants → 0 opps.
// L'utilisateur veut le max d'opportunites en pratique — cette fenetre
// donne 500-1000 matches exploitables au lieu de 28.
const CONGO_OFFSET_MS = 60 * 60 * 1000;
export function endOfCongoDay(nowMs) {
  const congoNow = new Date(nowMs + CONGO_OFFSET_MS);
  const nextMidnightCongoDayAfterTomorrow = Date.UTC(
    congoNow.getUTCFullYear(),
    congoNow.getUTCMonth(),
    congoNow.getUTCDate() + 2, // +2 = fin de journee de demain
  );
  return nextMidnightCongoDayAfterTomorrow - CONGO_OFFSET_MS;
}

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
  const tick = (label) => log(`  ⏱️ ${sport} ${label}: +${Date.now() - t0}ms`);
  const usable = bookmakers.filter((b) => live ? b.supports.live : b.supports.prematch);
  const listOpts = { live, horizonHours: horizonHours ?? config.scan.horizonHours, sport };
  const listed = await Promise.all(usable.map((b) => listSafe(b, listOpts)));
  tick('listMatches done');

  const catalogs = new Map();
  for (const { book, matches } of listed) catalogs.set(book.key, matches);
  log(`📋 ${sport.toUpperCase()} ${live ? 'LIVE' : 'PRÉMATCH'} — ${[...catalogs].map(([k, v]) => `${k}:${v.length}`).join(' | ')}`);

  // Jour civil Congo (UTC+1) : on ne remonte que les matchs qui se jouent
  // aujourd'hui — pas ceux de demain. Cutoff = minuit Congo prochain.
  const horizonMs = live ? null : endOfCongoDay(Date.now());
  // Diagnostic : distribution kickoff par bookmaker (past / today / demain / plus tard / null)
  if (!live) {
    const nowMs = Date.now();
    const tomorrowMs = horizonMs + 24 * 3600 * 1000;
    const dist = [...catalogs].map(([k, list]) => {
      const c = { past: 0, today: 0, tomorrow: 0, later: 0, nostart: 0 };
      for (const m of list) {
        if (!m.start) { c.nostart++; continue; }
        if (m.start < nowMs) { c.past++; continue; }
        if (m.start <= horizonMs) { c.today++; continue; }
        if (m.start <= tomorrowMs) { c.tomorrow++; continue; }
        c.later++;
      }
      return `${k}:today=${c.today}(past=${c.past}/tom=${c.tomorrow}/lat=${c.later}/nul=${c.nostart})`;
    });
    log(`📅 kickoff distribution — ${dist.join(' | ')}`);
  }
  const entries = alignCatalogs(catalogs, { minBooks: 2, horizonMs });
  // Diagnostic : combien de matchs chaque bookmaker retrouve dans entries
  // (permet d'identifier si un book est systematiquement isole car mauvais
  // matching noms d'equipes — ex Apollo souvent seul le 27/07).
  if (!live && entries.length) {
    const perBook = {};
    for (const b of usable) perBook[b.key] = 0;
    for (const e of entries) for (const k of Object.keys(e.matches)) perBook[k] = (perBook[k] || 0) + 1;
    log(`🔗 couverture matching — ${Object.entries(perBook).map(([k, n]) => `${k}:${n}`).join(' | ')}`);
  }
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
  tick('readOdds done');
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
  log(`🎯 ${deduped.length} opportunités candidates ≥ ${minP}% | ${Date.now() - t0}ms`);

  // Re-fetch juste-à-temps : on relit les cotes des 2 legs de chaque opp avant
  // de les envoyer. Élimine les surebets périmés (cotes ayant bougé pendant le
  // scan). En LIVE, on re-fetch aussi la liste des matchs de chaque book pour
  // avoir le score/minute FRAIS au moment de l'alerte (fix latence perçue).
  // En LIVE, le refresh live snapshot est parallélisé avec le re-fetch odds
  // pour minimiser la latence critique.
  const [freshLiveByBook, confirmed] = await Promise.all([
    live ? refreshLiveSnapshots(deduped, usable, listOpts) : Promise.resolve(null),
    confirmOpportunities(deduped, matchesByBookOpp(sorted, usable), usable, listOpts, minP, null),
  ]);
  // Appliquer les live snapshots frais aux opps confirmées (déjà validées côté odds)
  if (freshLiveByBook) applyFreshLive(confirmed, freshLiveByBook);
  tick('confirm+freshLive done');
  log(`✅ ${confirmed.length}/${deduped.length} opportunités confirmées après re-fetch | ${Date.now() - t0}ms`);

  return {
    opportunities: confirmed,
    stats: {
      catalogs: [...catalogs].map(([k, v]) => ({ book: k, matches: v.length })),
      entries: sorted.length,
      candidates: deduped.length,
      confirmed: confirmed.length,
      duration_ms: Date.now() - t0,
    },
  };
}

// Construit une map (bookKey → matchId → match) restreinte aux entrées scannées
// pour ne re-fetcher que ce qui apparaît dans une opp.
function matchesByBookOpp(entries, usable) {
  const out = new Map();
  for (const b of usable) out.set(b.key, new Map());
  for (const e of entries) {
    for (const b of usable) {
      const m = e.matches[b.key];
      if (m) out.get(b.key).set(String(m.id), m);
    }
  }
  return out;
}

// Re-liste les matchs live des bookmakers concernés par au moins une opp,
// pour capturer un score/minute frais au moment où l'opp est confirmée.
// Retourne Map<bookKey, Map<matchId, liveMeta>>.
async function refreshLiveSnapshots(opps, usable, listOpts) {
  const booksInOpps = new Set();
  for (const o of opps) {
    if (o.leg_a_book) booksInOpps.add(o.leg_a_book);
    if (o.leg_b_book) booksInOpps.add(o.leg_b_book);
  }
  if (!booksInOpps.size) return new Map();
  const bookByKey = Object.fromEntries(usable.map((b) => [b.key, b]));
  const out = new Map();
  await Promise.all([...booksInOpps].map(async (bookKey) => {
    const b = bookByKey[bookKey];
    if (!b) return;
    try {
      const matches = await b.listMatches({ ...listOpts, live: true });
      const idx = new Map();
      for (const m of matches || []) if (m?.id != null && m.live) idx.set(String(m.id), m.live);
      out.set(bookKey, idx);
    } catch (e) {
      log(`⚠️ ${bookKey} refresh live snapshot: ${e.message || e}`);
    }
  }));
  return out;
}

// Applique en post-traitement les live snapshots frais aux opps confirmées.
// Séparé de confirmOpportunities pour permettre l'exécution en parallèle du
// refresh (odds fetch et live listMatches n'ont pas de dépendance mutuelle).
function applyFreshLive(confirmedOpps, freshLiveByBook) {
  for (const o of confirmedOpps) {
    const idA = String(o.verify?.leg_a_match?.id || '');
    const idB = String(o.verify?.leg_b_match?.id || '');
    const liveA = freshLiveByBook.get(o.leg_a_book)?.get(idA);
    const liveB = freshLiveByBook.get(o.leg_b_book)?.get(idB);
    const pick = liveA?.score ? liveA : (liveB?.score ? liveB : (liveA || liveB));
    if (!pick) continue;
    o.live_score_at_confirm = pick.score || null;
    o.live_minute_at_confirm = pick.minute ?? null;
    o.live_period_at_confirm = pick.period || null;
    o.live_score_source_at_confirm = liveA?.score ? o.leg_a_book : (liveB?.score ? o.leg_b_book : (liveA ? o.leg_a_book : o.leg_b_book));
  }
}

async function confirmOpportunities(opps, matchesIdxByBook, usable, listOpts, minProfit, freshLiveByBook = null) {
  if (!opps.length) return [];
  const bookByKey = Object.fromEntries(usable.map((b) => [b.key, b]));
  // Regroupe les IDs à re-fetcher par bookmaker (dédup pour partage entre opps).
  const idsByBook = new Map();
  const ensureId = (bookKey, id) => {
    if (!idsByBook.has(bookKey)) idsByBook.set(bookKey, new Set());
    idsByBook.get(bookKey).add(String(id));
  };
  for (const o of opps) {
    const idA = o.verify?.leg_a_match?.id;
    const idB = o.verify?.leg_b_match?.id;
    if (o.leg_a_book && idA) ensureId(o.leg_a_book, idA);
    if (o.leg_b_book && idB) ensureId(o.leg_b_book, idB);
  }
  // Re-fetch parallèle par book.
  const freshOdds = new Map();
  await Promise.all([...idsByBook.entries()].map(async ([bookKey, ids]) => {
    const b = bookByKey[bookKey];
    if (!b) return;
    const matches = [...ids].map((id) => matchesIdxByBook.get(bookKey)?.get(id)).filter(Boolean);
    if (!matches.length) return;
    const map = await readOddsSafe(b, matches, { ...listOpts, noCache: true });
    freshOdds.set(bookKey, map);
  }));
  const confirmedAt = new Date().toISOString();
  const confirmedAtMs = Date.now();
  const out = [];
  for (const o of opps) {
    const idA = String(o.verify?.leg_a_match?.id || '');
    const idB = String(o.verify?.leg_b_match?.id || '');
    const oddsA = freshOdds.get(o.leg_a_book)?.get(idA) || freshOdds.get(o.leg_a_book)?.get(Number(idA));
    const oddsB = freshOdds.get(o.leg_b_book)?.get(idB) || freshOdds.get(o.leg_b_book)?.get(Number(idB));
    const key = marketKeyFromOpp(o);
    if (!key || !oddsA || !oddsB) continue;
    const freshA = oddsA[key.a];
    const freshB = oddsB[key.b];
    if (!freshA || !freshB || freshA <= 1 || freshB <= 1 || freshA > 80 || freshB > 80) continue;
    const invSum = 1 / freshA + 1 / freshB;
    if (invSum >= 1) continue;
    const profit = (1 - invSum) * 100;
    if (profit < minProfit) continue;
    if (profit > config.scan.maxProfitSanity) continue;
    // Log SPECIAL pour les opps a haut profit (>10%) : quasi-certainement un
    // mapping bogue quelque part, on veut identifier le marche/bookmaker
    // fautif pour corriger le parseur (pas cacher via un plafond).
    if (profit > 10) {
      log(`  🔍 HIGH ${profit.toFixed(1)}% | ${o.market_family} | ${o.leg_a_book}:${o.leg_a_label}=${freshA} vs ${o.leg_b_book}:${o.leg_b_label}=${freshB} | ${o.team_home} vs ${o.team_away} | ids=${idA}/${idB}`);
    }
    // Cote fraîche → on met à jour l'opp avec la valeur re-lue et on ajoute les timestamps.
    const fetchedMs = o.verify?.odds_fetched_at ? Date.parse(o.verify.odds_fetched_at) : confirmedAtMs;
    const stakeA = (1 / freshA) / invSum * 100;
    const stakeB = (1 / freshB) / invSum * 100;
    // Live : capture score/minute au moment du re-fetch (state réel de l'alerte).
    let liveAtConfirm = null;
    if (freshLiveByBook) {
      const liveA = freshLiveByBook.get(o.leg_a_book)?.get(idA);
      const liveB = freshLiveByBook.get(o.leg_b_book)?.get(idB);
      const pick = liveA?.score ? liveA : (liveB?.score ? liveB : (liveA || liveB));
      if (pick) {
        liveAtConfirm = {
          score: pick.score || null,
          minute: pick.minute ?? null,
          period: pick.period || null,
          source: liveA?.score ? o.leg_a_book : (liveB?.score ? o.leg_b_book : (liveA ? o.leg_a_book : o.leg_b_book)),
        };
      }
    }
    out.push({
      ...o,
      leg_a_odd: Math.round(freshA * 100) / 100,
      leg_b_odd: Math.round(freshB * 100) / 100,
      inverse_sum: Math.round(invSum * 10000) / 10000,
      profit_pct: Math.round(profit * 100) / 100,
      stake_a_pct: Math.round(stakeA * 10) / 10,
      stake_b_pct: Math.round(stakeB * 10) / 10,
      ...(liveAtConfirm ? {
        live_score_at_confirm: liveAtConfirm.score,
        live_minute_at_confirm: liveAtConfirm.minute,
        live_period_at_confirm: liveAtConfirm.period,
        live_score_source_at_confirm: liveAtConfirm.source,
      } : {}),
      verify: {
        ...o.verify,
        odds_confirmed_at: confirmedAt,
        odds_age_seconds: Math.max(0, Math.round((confirmedAtMs - fetchedMs) / 1000)),
      },
    });
  }
  return out.sort((a, b) => b.profit_pct - a.profit_pct);
}

// Reconstruit la paire de clés d'odds (leg_a, leg_b) à partir des libellés
// stockés dans l'opp. On peut re-fetch la vraie cote sur chaque leg avec ça.
function marketKeyFromOpp(o) {
  const fam = String(o.market_family || '');
  const aLbl = String(o.leg_a_label || '');
  const bLbl = String(o.leg_b_label || '');
  // Match Winner 2-way
  if (/^Match Winner$/.test(fam)) return { a: 'match_1', b: 'match_2' };
  // 1X2 + DC combinations
  if (/1X2 — 1 \+ X2/.test(fam)) return { a: 'match_1', b: 'dc_X2' };
  if (/1X2 — 2 \+ 1X/.test(fam)) return { a: 'match_2', b: 'dc_1X' };
  if (/1X2 — X \+ 12/.test(fam)) return { a: 'match_X', b: 'dc_12' };
  // Draw No Bet
  if (fam === 'Draw No Bet') return { a: 'dnb_1', b: 'dnb_2' };
  if (fam === '1MT Draw No Bet') return { a: 'ht_dnb_1', b: 'ht_dnb_2' };
  if (fam === '2MT Draw No Bet') return { a: 'h2_dnb_1', b: 'h2_dnb_2' };
  // Handicap sets (tennis / volley) — VÉRIFIÉ EN PREMIER pour éviter que le
  // regex Handicap générique (qui inclut "sets" en option) capture ces opps
  // et retourne la mauvaise clé (hcp_home_X vs set_hcp_home_X).
  const setHcp = fam.match(/^Handicap sets\s*([+-]?\d+(?:\.\d+)?)$/);
  if (setHcp) {
    const l = parseFloat(setHcp[1]);
    return { a: `set_hcp_home_${l}`, b: `set_hcp_away_${-l}` };
  }
  // Handicap match plein-temps (foot Asiatique, basket points, hockey Puck Line, tennis jeux)
  // Accepte les variantes explicites : "Handicap Asiatique +2.5", "Handicap +2.5",
  // "Handicap jeux +2.5", "Handicap points +2.5", "Puck Line -1.5".
  const hcpMatch = fam.match(/^(?:Handicap(?:\s+Asiatique|\s+jeux|\s+points)?|Puck Line)\s*([+-]?\d+(?:\.\d+)?)$/i);
  if (hcpMatch) {
    const l = parseFloat(hcpMatch[1]);
    return { a: `hcp_home_${l}`, b: `hcp_away_${-l}` };
  }
  // Handicap Asiatique par mi-temps/période/quart
  const htHcp = fam.match(/^(1MT|2MT|P1|P2|P3) Handicap(?:\s+Asiatique)?\s*([+-]?\d+(?:\.\d+)?)$/);
  if (htHcp) {
    const pfxMap = { '1MT': 'ht_', '2MT': 'h2_', 'P1': 'p1_', 'P2': 'p2_', 'P3': 'p3_' };
    const l = parseFloat(htHcp[2]);
    const pfx = pfxMap[htHcp[1]];
    return { a: `${pfx}hcp_home_${l}`, b: `${pfx}hcp_away_${-l}` };
  }
  // Total match (buts/points/jeux) — line embedded in family
  // Accepte : "Total Buts Match 2.5", "Total match 2.5", "Total buts 2.5", etc.
  const totMatch = fam.match(/^Total (?:Buts Match|match|jeux|points|buts|sets)?\s*(\d+(?:\.\d+)?)$/i);
  if (totMatch) {
    const l = parseFloat(totMatch[1]);
    // Distinguish set totals for tennis
    if (/Total sets/i.test(fam)) return { a: `set_over_${l}`, b: `set_under_${l}` };
    return { a: `match_over_${l}`, b: `match_under_${l}` };
  }
  // Half/period/quarter totals — accepte "1MT Total Buts 1.5", "1MT Total 1.5", etc.
  const partTot = fam.match(/^(1MT|2MT|P1|P2|P3|Q1|Q2|Q3|Q4|Set 1|Set 2|Set 3|Set 4|Set 5|Corners 1MT)\s*(?:Total(?:\s+Buts)?\s*)?(\d+(?:\.\d+)?)$/);
  if (partTot) {
    const pfxMap = { '1MT': 'ht_', '2MT': 'h2_', 'P1': 'p1_', 'P2': 'p2_', 'P3': 'p3_', 'Q1': 'q1_', 'Q2': 'q2_', 'Q3': 'q3_', 'Q4': 'q4_', 'Set 1': 's1_', 'Set 2': 's2_', 'Set 3': 's3_', 'Set 4': 's4_', 'Set 5': 's5_', 'Corners 1MT': 'cor_ht_' };
    const l = parseFloat(partTot[2]);
    const pfx = pfxMap[partTot[1]];
    return { a: `${pfx}over_${l}`, b: `${pfx}under_${l}` };
  }
  // Corners total plein temps
  const corTot = fam.match(/^Corners Total\s*(\d+(?:\.\d+)?)$/);
  if (corTot) {
    const l = parseFloat(corTot[1]);
    return { a: `cor_over_${l}`, b: `cor_under_${l}` };
  }
  // Corners handicap
  const corHcp = fam.match(/^Corners Handicap\s*([+-]?\d+(?:\.\d+)?)$/);
  if (corHcp) {
    const l = parseFloat(corHcp[1]);
    return { a: `cor_hcp_home_${l}`, b: `cor_hcp_away_${-l}` };
  }
  // BTTS
  if (fam === 'BTTS') return { a: 'btts_yes', b: 'btts_no' };
  if (fam === '1MT BTTS') return { a: 'ht_btts_yes', b: 'ht_btts_no' };
  if (fam === '2MT BTTS') return { a: 'h2_btts_yes', b: 'h2_btts_no' };
  // Odd/Even
  if (/Pair\/Impair/.test(fam)) {
    if (fam.startsWith('1MT')) return { a: 'ht_odd', b: 'ht_even' };
    if (fam.startsWith('2MT')) return { a: 'h2_odd', b: 'h2_even' };
    if (fam.startsWith('Corners')) return { a: 'cor_odd', b: 'cor_even' };
    return { a: 'odd', b: 'even' };
  }
  // Team totals (dom./ext.)
  const ttMatch = fam.match(/^Total (Dom\.|Ext\.|J1|J2|Éq\.1|Éq\.2)\s*(\d+(?:\.\d+)?)$/);
  if (ttMatch) {
    const side = /Dom|J1|Éq\.1/.test(ttMatch[1]) ? 'home' : 'away';
    const l = parseFloat(ttMatch[2]);
    return { a: `tt_${side}_over_${l}`, b: `tt_${side}_under_${l}` };
  }
  // Per-half/quarter/period/set winner (basket/hockey/volley/tennis)
  const partWin = fam.match(/^(1MT|2MT|P1|P2|P3|Q1|Q2|Q3|Q4|Set 1|Set 2|Set 3|Set 4|Set 5) Winner$/);
  if (partWin) {
    const pfxMap = { '1MT': 'ht_', '2MT': 'h2_', 'P1': 'p1_', 'P2': 'p2_', 'P3': 'p3_', 'Q1': 'q1_', 'Q2': 'q2_', 'Q3': 'q3_', 'Q4': 'q4_', 'Set 1': 's1_', 'Set 2': 's2_', 'Set 3': 's3_', 'Set 4': 's4_', 'Set 5': 's5_' };
    const pfx = pfxMap[partWin[1]];
    return { a: `${pfx}match_1`, b: `${pfx}match_2` };
  }
  return null;
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
