// Orchestrateur agnostique : liste les matchs de chaque bookmaker, apparie, lit
// les cotes, compare toutes les paires. Ne connaît AUCUN nom de bookmaker en dur.
import { bookmakers } from '../bookmakers/index.js';
import { alignCatalogs } from '../core/matching.js';
import { compareTwoBooks, compareTennisTwoBooks, compareBasketTwoBooks, dedupeOpportunities } from '../core/arbitrage.js';
import { config } from '../config.js';
import { matchUrl } from './urls.js';

export const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

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
  const sport = opts?.sport || 'football';
  try {
    if (book.getOddsBatch) {
      const batch = await book.getOddsBatch(matches, opts);
      for (const [id, odds] of batch) map.set(id, sanitizeForSport(odds || {}, sport));
      return map;
    }
    // Batch size par book, calé sur la tolérance de leur API :
    //   xbet (CF workers custom, ~illimité)                    → 200
    //   betpawa, sportybet (direct HTTPS très tolérants)       → 150
    //   premierbet (guineegames direct)                        → 100
    //   yellowbet (Cloudflare stealth, 503 si > 15 parallèles) → 12
    //   congobet/betmomo (risque 503/429)                      → 40
    const BATCH = book.key === '1xbet' ? 200
                : /^(betpawa|sportybet)$/.test(book.key) ? 150
                : book.key === 'premierbet' ? 100
                : book.key === 'yellowbet' ? 12
                : 40;
    for (let i = 0; i < matches.length; i += BATCH) {
      const chunk = matches.slice(i, i + BATCH);
      const results = await Promise.all(chunk.map((m) => book.getOdds(m, opts).catch((e) => {
        log(`⚠️ ${book.key} getOdds(${m.id}): ${e.message || e}`);
        return {};
      })));
      chunk.forEach((m, k) => map.set(m.id, sanitizeForSport(results[k] || {}, sport)));
    }
    return map;
  } catch (e) {
    log(`⚠️ ${book.key} getOdds batch: ${e.message || e}`);
    return map;
  }
}

// Football : retire les clés per-set (s1_/set_) qui polluent le foot.
// Tennis : garde les cles per-set (s1_/s2_/set_) car ce sont des marches valides.
// Basket : garde les préfixes qN_ (quarters) et hN_ (halves), retire per-set foot/tennis.
function sanitizeForSport(odds, sport = 'football') {
  if (!odds || typeof odds !== 'object') return {};
  if (sport === 'tennis') return odds;
  if (sport === 'basket') {
    // Basket : purge s1_..s5_ et set_ (tennis-only), garde q1_..q4_ / h1_ / h2_.
    const out = {};
    for (const [k, v] of Object.entries(odds)) {
      if (/^s[1-5]_/.test(k)) continue;
      if (/^set_/.test(k)) continue;
      // Retire les clés foot spécifiques : btts_, dc_, dnb_, fts_, cor_, ht_, h2_ (half foot),
      // half_most_. Attention : basket utilise h1_/h2_ (halves basket), pas ht_/h2_.
      if (/^btts_|^dc_|^dnb_|^fts_|^cor_|^ht_|^half_most_/.test(k)) continue;
      // h2_ basket (2nd half) vs h2_ foot (2nd half foot) — même préfixe mais
      // le foot utilise ht_/h2_ pour halves, basket utilise h1_/h2_.
      // On considère h1_ = basket-only (foot n'a pas h1_), h2_ = ambigu →
      // on garde h2_ pour basket (le foot ne devrait pas produire h2_ avec ces IDs).
      out[k] = v;
    }
    return out;
  }
  const out = {};
  for (const [k, v] of Object.entries(odds)) {
    if (/^s[1-5]_/.test(k)) continue;
    if (/^set_/.test(k)) continue;
    if (/^q[1-4]_/.test(k)) continue; // Purge quarters basket depuis parsers foot.
    if (/^h1_/.test(k)) continue;      // Purge h1_ (basket-only).
    out[k] = v;
  }
  return out;
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

  const horizonMs = live ? null : Date.now() + (horizonHours ?? config.scan.horizonHours) * 3600 * 1000;
  const alignT0 = Date.now();
  const entries = alignCatalogs(catalogs, { minBooks: 2, horizonMs });
  log(`  ⏱️ ${sport} alignCatalogs done: +${Date.now() - alignT0}ms (${entries.length} entrées)`);
  // Aucun plafond artificiel : le user a explicitement demandé de ne jamais limiter.
  // Le tri chronologique traite d'abord les matchs proches (kickoff imminent).
  const cap = maxMatches ?? config.scan.maxMatches ?? Infinity;
  // Tri chronologique simple : matchs les plus proches en premier.
  // (Un tri par couverture excluait les matchs 1win du top.)
  const sorted = entries
    .map((e) => ({ e, start: e.ref.start || Infinity }))
    .sort((a, b) => a.start - b.start)
    .slice(0, cap)
    .map((s) => s.e);
  log(`🔗 ${sorted.length}/${entries.length} matchs exploitables (≥2 books)`);
  if (!sorted.length) return { opportunities: [], stats: { catalogs: [...catalogs].map(([k, v]) => ({ book: k, matches: v.length })), entries: 0, duration_ms: Date.now() - t0 } };

  const oddsByBook = new Map();
  const oddsTimings = {};
  const oddsJobs = usable.map(async (b) => {
    const inScope = sorted.map((e) => e.matches[b.key]).filter(Boolean);
    const bookT0 = Date.now();
    oddsByBook.set(b.key, await readOddsSafe(b, inScope, listOpts));
    oddsTimings[b.key] = { n: inScope.length, ms: Date.now() - bookT0 };
  });
  await Promise.all(oddsJobs);
  tick('readOdds done');
  const timingLine = Object.entries(oddsTimings)
    .sort((a, b) => b[1].ms - a[1].ms)
    .map(([k, v]) => `${k}:${v.ms}ms/${v.n}`)
    .join(' | ');
  log(`⏱️ readOdds par book (trié par lenteur) — ${timingLine}`);
  const covered = usable.map((b) => `${b.key}:${[...oddsByBook.get(b.key)].filter(([, o]) => Object.keys(o || {}).length).length}`);
  log(`💰 cotes lues — ${covered.join(' | ')}`);

  const scanId = `${live ? 'live' : 'scan'}_${Date.now()}`;
  const minP = minProfit ?? (live ? config.scan.minProfitLive : config.scan.minProfitPrematch);
  const oddsFetchedAt = new Date().toISOString();
  // Dispatch comparateur selon sport : tennis a ses propres marches et labels
  // (Handicap Jeux vs Handicap Asiatique, Total Jeux vs Total Buts, s1_/s2_/...).
  // Basket : marchés Points (incl OT) avec quarters qN_ et halves hN_.
  const compare = sport === 'tennis' ? compareTennisTwoBooks
                : sport === 'basket' ? compareBasketTwoBooks
                : compareTwoBooks;
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
      // Passe les match objects → tennis peut detecter inversion J1/J2 entre books
      // et flipper les cotes pour eviter fake arbs 40%+.
      const arbs = compare(oddsPerBook[keys[i]], keys[i], oddsPerBook[keys[j]], keys[j], matches[keys[i]], matches[keys[j]]);
      for (const a of arbs) {
        if (a.profit_pct < minP) continue;
        const legAlive = matches[a.leg_a_book]?.live || null;
        const legBlive = matches[a.leg_b_book]?.live || null;
        // Coupon data pour backend SaveCoupon : IDs natifs par book + eventId
        // (match.id) + price + read_at. Format figé avec Mon : clés natives
        // (aucune normalisation), 3 champs communs {book, price, read_at}.
        // Voir docs/coupon-codes-research.md pour matrice books generables.
        // YellowBet/BetMomo : coupon_data reste null (403 CF sur SaveCoupon
        // impossible a bypass depuis Deno) → pas de bouton "Generer" cote UI.
        const legAcoupon = buildCoupon(a.leg_a_book, a.leg_a_ids, matches[a.leg_a_book]?.id, a.leg_a_odd, oddsFetchedAt, live, matches[a.leg_a_book]);
        const legBcoupon = buildCoupon(a.leg_b_book, a.leg_b_ids, matches[a.leg_b_book]?.id, a.leg_b_odd, oddsFetchedAt, live, matches[a.leg_b_book]);
        // Nettoyer les IDs internes (transportes via pushArb) avant envoi
        delete a.leg_a_ids; delete a.leg_b_ids;
        all.push({
          ...a, scan_id: scanId, sport, is_live: live,
          match_label: shortMatchLabel(ref.home, ref.away),
          team_home: shortTeam(ref.home), team_away: shortTeam(ref.away),
          team_home_full: ref.home, team_away_full: ref.away,
          league: ref.league,
          kickoff_iso: ref.start ? new Date(ref.start).toISOString() : null,
          ...idFields(matches),
          status: 'live',
          leg_a_coupon: legAcoupon,
          leg_b_coupon: legBcoupon,
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

  // Distribution book × candidates : pour comprendre pourquoi certains books
  // (Sportcash, Apollo, PremierBet) n'apparaissent jamais dans les opps envoyées.
  // Compte pour chaque book combien de fois il apparaît comme leg_a OU leg_b.
  const bookInScope = {};
  const bookCandidates = {};
  for (const b of usable) {
    bookInScope[b.key] = sorted.filter((e) => e.matches[b.key] && oddsByBook.get(b.key).get(e.matches[b.key].id) && Object.keys(oddsByBook.get(b.key).get(e.matches[b.key].id) || {}).length).length;
    bookCandidates[b.key] = 0;
  }
  for (const o of deduped) {
    bookCandidates[o.leg_a_book] = (bookCandidates[o.leg_a_book] || 0) + 1;
    bookCandidates[o.leg_b_book] = (bookCandidates[o.leg_b_book] || 0) + 1;
  }
  const distribCand = usable.map((b) => `${b.key}:${bookCandidates[b.key]}(scope:${bookInScope[b.key]})`).join(' | ');
  log(`📊 distribution candidates par book — ${distribCand}`);

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

  // Distribution book × confirmed
  const bookConfirmed = {};
  for (const b of usable) bookConfirmed[b.key] = 0;
  for (const o of confirmed) {
    bookConfirmed[o.leg_a_book] = (bookConfirmed[o.leg_a_book] || 0) + 1;
    bookConfirmed[o.leg_b_book] = (bookConfirmed[o.leg_b_book] || 0) + 1;
  }
  log(`📊 distribution confirmed par book — ${usable.map((b) => `${b.key}:${bookConfirmed[b.key]}`).join(' | ')}`);

  // Coupon fill rate par book — combien de legs ont coupon != null / total legs
  // du book dans les opps confirmées. Cible : 100% pour books enrichis (all
  // sauf yellowbet/betmomo qui restent null car CF).
  const couponStats = {};
  const familyMiss = {};
  for (const b of usable) couponStats[b.key] = { total: 0, filled: 0 };
  for (const o of confirmed) {
    for (const [side, book, coupon] of [
      ['a', o.leg_a_book, o.leg_a_coupon],
      ['b', o.leg_b_book, o.leg_b_coupon],
    ]) {
      if (!book) continue;
      couponStats[book] = couponStats[book] || { total: 0, filled: 0 };
      couponStats[book].total++;
      if (coupon) couponStats[book].filled++;
      else {
        const key = `${book}|${o.market_family}`;
        familyMiss[key] = (familyMiss[key] || 0) + 1;
      }
    }
  }
  log(`🎫 coupon fill rate — ${Object.entries(couponStats).filter(([, s]) => s.total > 0).map(([b, s]) => `${b}:${s.filled}/${s.total}`).join(' | ')}`);
  // Top families qui echouent (au dela des books sans support coupon)
  const topMiss = Object.entries(familyMiss).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (topMiss.length) log(`   ❌ top marches sans coupon : ${topMiss.map(([k, n]) => `${k}(${n})`).join(' | ')}`);

  // Log les 5 premières opps envoyées (sample) : profit, marché, books, matches
  if (confirmed.length) {
    log(`📤 Sample opps envoyees :`);
    for (const o of confirmed.slice(0, Math.min(5, confirmed.length))) {
      log(`   ${o.profit_pct}% "${o.match_label}" [${o.market_family}] ${o.leg_a_book}@${o.leg_a_odd} vs ${o.leg_b_book}@${o.leg_b_odd}`);
    }
  }

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
  const rejectReasons = { noKey: 0, noOddsA: 0, noOddsB: 0, missingFresh: 0, badRange: 0, noArb: 0, lowProfit: 0, capMax: 0, unstableDrift: 0 };
  // Seuil de drift entre cote candidate (readOdds cache) et cote fresh (confirm noCache).
  // Si une cote a bougé de plus de ce seuil, l'opp est instable → rejet.
  // Detecte : parseurs qui retournent des spikes, caches proxies qui donnent des
  // reponses obsoletes, marches qui bougent trop vite (arb ephemere non exploitable).
  const DRIFT_MAX = 0.10;
  const driftSamples = [];
  const rejectByBook = {};
  const trackReject = (o, reason) => {
    rejectReasons[reason] = (rejectReasons[reason] || 0) + 1;
    for (const b of [o.leg_a_book, o.leg_b_book]) {
      if (!rejectByBook[b]) rejectByBook[b] = {};
      rejectByBook[b][reason] = (rejectByBook[b][reason] || 0) + 1;
    }
  };
  const out = [];
  for (const o of opps) {
    const idA = String(o.verify?.leg_a_match?.id || '');
    const idB = String(o.verify?.leg_b_match?.id || '');
    const oddsA = freshOdds.get(o.leg_a_book)?.get(idA) || freshOdds.get(o.leg_a_book)?.get(Number(idA));
    const oddsB = freshOdds.get(o.leg_b_book)?.get(idB) || freshOdds.get(o.leg_b_book)?.get(Number(idB));
    const key = marketKeyFromOpp(o);
    if (!key) { trackReject(o, 'noKey'); continue; }
    if (!oddsA) { trackReject(o, 'noOddsA'); continue; }
    if (!oddsB) { trackReject(o, 'noOddsB'); continue; }
    const freshA = oddsA[key.a];
    const freshB = oddsB[key.b];
    if (freshA == null || freshB == null) { trackReject(o, 'missingFresh'); continue; }
    if (freshA <= 1 || freshB <= 1 || freshA > 80 || freshB > 80) { trackReject(o, 'badRange'); continue; }
    // Drift check : rejette si cote a bouge de >DRIFT_MAX entre candidate et fresh.
    // Cote candidate = o.leg_a_odd / o.leg_b_odd (lues depuis readOdds cache).
    // Cote fresh = freshA / freshB (refetch noCache=true).
    const candA = Number(o.leg_a_odd) || null;
    const candB = Number(o.leg_b_odd) || null;
    const driftA = candA ? Math.abs(freshA - candA) : 0;
    const driftB = candB ? Math.abs(freshB - candB) : 0;
    driftSamples.push({ book_a: o.leg_a_book, book_b: o.leg_b_book, driftA, driftB });
    if (driftA > DRIFT_MAX || driftB > DRIFT_MAX) { trackReject(o, 'unstableDrift'); continue; }
    const invSum = 1 / freshA + 1 / freshB;
    if (invSum >= 1) { trackReject(o, 'noArb'); continue; }
    const profit = (1 - invSum) * 100;
    if (profit < minProfit) { trackReject(o, 'lowProfit'); continue; }
    // Pas de cap max côté confirmation : les vraies grosses arbs (10-50%)
    // doivent passer. Les fantômes doivent être éliminés en amont via un
    // parsing correct, pas par un seuil arbitraire.
    if (profit > config.scan.maxProfitSanity) { trackReject(o, 'capMax'); continue; }
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
    // Refresh coupon.price + coupon.read_at avec les valeurs fresh du confirm.
    // Rebuild opportuniste : si l'opp arrivee sans coupon (init parse rate ou
    // ancien code), on re-tente de le construire depuis les fresh _ids obtenus
    // au re-fetch — ca sauve les opps qui auraient sinon eu leg_a_coupon:null.
    // Sinon on refresh juste price/read_at (les _ids sont stables entre init
    // et confirm pour un meme match).
    const legAfreshRounded = Math.round(freshA * 100) / 100;
    const legBfreshRounded = Math.round(freshB * 100) / 100;
    const legAcouponRefreshed = o.leg_a_coupon
      ? { ...o.leg_a_coupon, price: legAfreshRounded, read_at: confirmedAt }
      : buildCoupon(o.leg_a_book, oddsA?._ids?.[key.a], o.verify?.leg_a_match?.id, legAfreshRounded, confirmedAt, !!freshLiveByBook, matchesIdxByBook.get(o.leg_a_book)?.get(idA));
    const legBcouponRefreshed = o.leg_b_coupon
      ? { ...o.leg_b_coupon, price: legBfreshRounded, read_at: confirmedAt }
      : buildCoupon(o.leg_b_book, oddsB?._ids?.[key.b], o.verify?.leg_b_match?.id, legBfreshRounded, confirmedAt, !!freshLiveByBook, matchesIdxByBook.get(o.leg_b_book)?.get(idB));
    out.push({
      ...o,
      leg_a_odd: legAfreshRounded,
      leg_b_odd: legBfreshRounded,
      leg_a_coupon: legAcouponRefreshed,
      leg_b_coupon: legBcouponRefreshed,
      inverse_sum: Math.round(invSum * 10000) / 10000,
      profit_pct: Math.round(profit * 100) / 100,
      stake_a_pct: Math.round(stakeA * 10) / 10,
      stake_b_pct: Math.round(stakeB * 10) / 10,
      odds_confirmed_at: confirmedAt,
      leg_a_drift: Math.round(driftA * 100) / 100,
      leg_b_drift: Math.round(driftB * 100) / 100,
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
  // Log distribution des rejets pour comprendre pourquoi des candidates ne passent pas
  const totalRej = Object.values(rejectReasons).reduce((a, b) => a + b, 0);
  if (totalRej > 0) {
    const reasonsSummary = Object.entries(rejectReasons).filter(([, n]) => n > 0).map(([k, n]) => `${k}:${n}`).join(' ');
    log(`  ❌ rejets confirm (${totalRej}): ${reasonsSummary}`);
    // Pour chaque book qui a >2 rejets, détail
    for (const [book, reasons] of Object.entries(rejectByBook)) {
      const total = Object.values(reasons).reduce((a, b) => a + b, 0);
      if (total >= 2) {
        const details = Object.entries(reasons).map(([k, n]) => `${k}:${n}`).join(' ');
        log(`     - ${book} (${total} rejets): ${details}`);
      }
    }
  }
  // Synthese drift : max / moyenne par book, aide a detecter parseurs instables ou caches obsoletes.
  if (driftSamples.length) {
    const perBook = {}; // book => {maxA, sumA, nA, maxB, sumB, nB}
    for (const s of driftSamples) {
      if (!perBook[s.book_a]) perBook[s.book_a] = { max: 0, sum: 0, n: 0 };
      if (!perBook[s.book_b]) perBook[s.book_b] = { max: 0, sum: 0, n: 0 };
      perBook[s.book_a].max = Math.max(perBook[s.book_a].max, s.driftA);
      perBook[s.book_a].sum += s.driftA; perBook[s.book_a].n++;
      perBook[s.book_b].max = Math.max(perBook[s.book_b].max, s.driftB);
      perBook[s.book_b].sum += s.driftB; perBook[s.book_b].n++;
    }
    const parts = Object.entries(perBook).map(([b, s]) => `${b}:max=${s.max.toFixed(2)}/avg=${(s.sum / s.n).toFixed(3)}(n=${s.n})`);
    log(`  📈 drift candidate→fresh par book : ${parts.join(' | ')}`);
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
  // Handicap Asiatique plein-temps
  const hcpMatch = fam.match(/^Handicap(?:\s+Asiatique)?\s*([+-]?\d+(?:\.\d+)?)$/i);
  if (hcpMatch) {
    const l = parseFloat(hcpMatch[1]);
    return { a: `hcp_home_${l}`, b: `hcp_away_${-l}` };
  }
  // Handicap Asiatique 1MT / 2MT
  const htHcp = fam.match(/^(1MT|2MT) Handicap(?:\s+Asiatique)?\s*([+-]?\d+(?:\.\d+)?)$/);
  if (htHcp) {
    const pfx = htHcp[1] === '1MT' ? 'ht_' : 'h2_';
    const l = parseFloat(htHcp[2]);
    return { a: `${pfx}hcp_home_${l}`, b: `${pfx}hcp_away_${-l}` };
  }
  // Total match — accepte "Total Buts Match 2.5", "Total buts 2.5", etc.
  const totMatch = fam.match(/^Total (?:Buts Match|match|buts)?\s*(\d+(?:\.\d+)?)$/i);
  if (totMatch) {
    const l = parseFloat(totMatch[1]);
    return { a: `match_over_${l}`, b: `match_under_${l}` };
  }
  // 1MT / 2MT / Corners 1MT totals
  const partTot = fam.match(/^(1MT|2MT|Corners 1MT)\s*(?:Total(?:\s+Buts)?\s*)?(\d+(?:\.\d+)?)$/);
  if (partTot) {
    const pfxMap = { '1MT': 'ht_', '2MT': 'h2_', 'Corners 1MT': 'cor_ht_' };
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
  // Team totals (Dom. / Ext.)
  const ttMatch = fam.match(/^Total (Dom\.|Ext\.)\s*(\d+(?:\.\d+)?)$/);
  if (ttMatch) {
    const side = ttMatch[1] === 'Dom.' ? 'home' : 'away';
    const l = parseFloat(ttMatch[2]);
    return { a: `tt_${side}_over_${l}`, b: `tt_${side}_under_${l}` };
  }
  // 1MT / 2MT Team totals
  const partTt = fam.match(/^(1MT|2MT) Total (Dom\.|Ext\.)\s*(\d+(?:\.\d+)?)$/);
  if (partTt) {
    const pfx = partTt[1] === '1MT' ? 'ht_' : 'h2_';
    const side = partTt[2] === 'Dom.' ? 'home' : 'away';
    const l = parseFloat(partTt[3]);
    return { a: `${pfx}tt_${side}_over_${l}`, b: `${pfx}tt_${side}_under_${l}` };
  }
  // 1MT/2MT 1X2+DC : arbitrage.js emet "1MT 1X2 — Domicile/Extérieur/Nul" quand
  // un book expose ht_match_* et l'autre ht_dc_*. Sans ce mapping, tous les
  // candidates Sportcash mi-temps 1X2 rejetes en noKey.
  const partDc = fam.match(/^(1MT|2MT) 1X2 — (Domicile|Extérieur|Nul)$/);
  if (partDc) {
    const pfx = partDc[1] === '1MT' ? 'ht_' : 'h2_';
    const sk = partDc[2] === 'Domicile' ? ['match_1', 'dc_X2']
             : partDc[2] === 'Extérieur' ? ['match_2', 'dc_1X']
             : ['match_X', 'dc_12'];
    return { a: `${pfx}${sk[0]}`, b: `${pfx}${sk[1]}` };
  }

  // ─── TENNIS market families ─────────────────────────────────────────────
  if (fam === 'Vainqueur du Match') return { a: 'match_1', b: 'match_2' };
  // Vainqueur 1er/2e/... Set (nouveau format ordinal FR)
  const ORD_TO_N = { '1er': '1', '2e': '2', '3e': '3', '4e': '4', '5e': '5' };
  const vainSetOrd = fam.match(/^Vainqueur (1er|2e|3e|4e|5e) Set$/);
  if (vainSetOrd) {
    const n = ORD_TO_N[vainSetOrd[1]];
    return { a: `s${n}_match_1`, b: `s${n}_match_2` };
  }
  // Handicap Jeux (match complet)
  const hcpJeux = fam.match(/^Handicap Jeux\s*([+-]?\d+(?:\.\d+)?)$/);
  if (hcpJeux) {
    const l = parseFloat(hcpJeux[1]);
    return { a: `hcp_home_${l}`, b: `hcp_away_${-l}` };
  }
  // Handicap 1er/2e/... Set (jeux implicite au sein du set)
  const hcpSetOrd = fam.match(/^Handicap (1er|2e|3e|4e|5e) Set\s*([+-]?\d+(?:\.\d+)?)$/);
  if (hcpSetOrd) {
    const n = ORD_TO_N[hcpSetOrd[1]];
    const l = parseFloat(hcpSetOrd[2]);
    return { a: `s${n}_hcp_home_${l}`, b: `s${n}_hcp_away_${-l}` };
  }
  // Total Jeux Match
  const totJeux = fam.match(/^Total Jeux Match\s*(\d+(?:\.\d+)?)$/);
  if (totJeux) {
    const l = parseFloat(totJeux[1]);
    return { a: `match_over_${l}`, b: `match_under_${l}` };
  }
  // Total Jeux 1er/2e/... Set (jeux au sein du set)
  const totJeuxSetOrd = fam.match(/^Total Jeux (1er|2e|3e|4e|5e) Set\s*(\d+(?:\.\d+)?)$/);
  if (totJeuxSetOrd) {
    const n = ORD_TO_N[totJeuxSetOrd[1]];
    const l = parseFloat(totJeuxSetOrd[2]);
    return { a: `s${n}_over_${l}`, b: `s${n}_under_${l}` };
  }
  // Total Jeux Joueur (J1/J2)
  const totJeuxJ = fam.match(/^Total Jeux (J1|J2)\s*(\d+(?:\.\d+)?)$/);
  if (totJeuxJ) {
    const side = totJeuxJ[1] === 'J1' ? 'home' : 'away';
    const l = parseFloat(totJeuxJ[2]);
    return { a: `tt_${side}_over_${l}`, b: `tt_${side}_under_${l}` };
  }
  // Total Sets
  const totSets = fam.match(/^Total Sets\s*(\d+(?:\.\d+)?)$/);
  if (totSets) {
    const l = parseFloat(totSets[1]);
    return { a: `total_sets_over_${l}`, b: `total_sets_under_${l}` };
  }
  // Handicap Sets
  const hcpSets = fam.match(/^Handicap Sets\s*([+-]?\d+(?:\.\d+)?)$/);
  if (hcpSets) {
    const l = parseFloat(hcpSets[1]);
    return { a: `hcp_sets_home_${l}`, b: `hcp_sets_away_${-l}` };
  }

  // ─── BASKET market families ─────────────────────────────────────────────
  if (fam === 'Vainqueur du Match') return { a: 'match_1', b: 'match_2' };
  // Handicap Points ±X (basket FT).
  const hcpPtsMatch = fam.match(/^Handicap Points\s*([+-]?\d+(?:\.\d+)?)$/);
  if (hcpPtsMatch) {
    const l = parseFloat(hcpPtsMatch[1]);
    return { a: `hcp_home_${l}`, b: `hcp_away_${-l}` };
  }
  // Total Points Match X (basket FT).
  const totPtsMatch = fam.match(/^Total Points Match\s*(\d+(?:\.\d+)?)$/);
  if (totPtsMatch) {
    const l = parseFloat(totPtsMatch[1]);
    return { a: `match_over_${l}`, b: `match_under_${l}` };
  }
  // Total Points Dom./Ext. X (basket FT).
  const ttPts = fam.match(/^Total Points (Dom\.|Ext\.)\s*(\d+(?:\.\d+)?)$/);
  if (ttPts) {
    const side = ttPts[1] === 'Dom.' ? 'home' : 'away';
    const l = parseFloat(ttPts[2]);
    return { a: `tt_${side}_over_${l}`, b: `tt_${side}_under_${l}` };
  }
  // Pair/Impair Points (basket FT).
  if (fam === 'Pair/Impair Points') return { a: 'odd', b: 'even' };

  // Basket par période (Q1..Q4, 1MT/2MT).
  const LBL_TO_PFX = { Q1: 'q1_', Q2: 'q2_', Q3: 'q3_', Q4: 'q4_', '1MT': 'h1_', '2MT': 'h2_' };
  // "Q1 Vainqueur" / "1MT Vainqueur"
  const perVain = fam.match(/^(Q[1-4]|1MT|2MT) Vainqueur$/);
  if (perVain) {
    const pfx = LBL_TO_PFX[perVain[1]];
    return { a: `${pfx}match_1`, b: `${pfx}match_2` };
  }
  // "Q1 Total Points X" / "1MT Total Points X"
  const perTot = fam.match(/^(Q[1-4]|1MT|2MT) Total Points\s*(\d+(?:\.\d+)?)$/);
  if (perTot) {
    const pfx = LBL_TO_PFX[perTot[1]];
    const l = parseFloat(perTot[2]);
    return { a: `${pfx}over_${l}`, b: `${pfx}under_${l}` };
  }
  // "Q1 Handicap ±X" / "1MT Handicap ±X"
  const perHcp = fam.match(/^(Q[1-4]|1MT|2MT) Handicap\s*([+-]?\d+(?:\.\d+)?)$/);
  if (perHcp) {
    const pfx = LBL_TO_PFX[perHcp[1]];
    const l = parseFloat(perHcp[2]);
    return { a: `${pfx}hcp_home_${l}`, b: `${pfx}hcp_away_${-l}` };
  }
  // "Q1 Pair/Impair" / "1MT Pair/Impair"
  const perOE = fam.match(/^(Q[1-4]|1MT|2MT) Pair\/Impair$/);
  if (perOE) {
    const pfx = LBL_TO_PFX[perOE[1]];
    return { a: `${pfx}odd`, b: `${pfx}even` };
  }
  // "1MT Total Points Dom. X" / "2MT Total Points Ext. X"
  const perTt = fam.match(/^(1MT|2MT) Total Points (Dom\.|Ext\.)\s*(\d+(?:\.\d+)?)$/);
  if (perTt) {
    const pfx = LBL_TO_PFX[perTt[1]];
    const side = perTt[2] === 'Dom.' ? 'home' : 'away';
    const l = parseFloat(perTt[3]);
    return { a: `${pfx}tt_${side}_over_${l}`, b: `${pfx}tt_${side}_under_${l}` };
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

// Raccourcit un nom d'équipe long en gardant lisibilité (pas d'abbrev brutale).
// Stratégie :
//   ≤22 chars       → garde tel quel
//   >22 chars       → supprime mots de bruit (FC, CF, Club, Athletic Club, Football Club, U19, U21)
//   toujours >22    → garde les 2 premiers mots
//   dernier recours → tronque à 22 avec ellipse discrete
export function shortTeam(name) {
  const s = String(name || '').trim();
  if (s.length <= 22) return s;
  let cleaned = s
    .replace(/\b(?:Football Club|Athletic Club|Sporting Club|Sports? Club|FC|CF|SC|AC|CA|CD|BK|SK|IF|IK)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= 22) return cleaned;
  const words = cleaned.split(/\s+/);
  if (words.length >= 2) {
    const two = `${words[0]} ${words[1]}`;
    if (two.length <= 22) return two;
    return words[0].slice(0, 22);
  }
  return cleaned.slice(0, 21) + '…';
}

export function shortMatchLabel(home, away) {
  return `${shortTeam(home)} vs ${shortTeam(away)}`;
}

// Construit l'objet leg_a_coupon / leg_b_coupon envoye au backend pour
// generation SaveCoupon. Format figé avec Mon (docs/coupon-codes-research.md) :
//
//   { book, ...idsNatifsBook, price, read_at }
//
// - book       : String, clé de routage backend (dispatcher SaveCoupon).
// - ...ids     : IDs bruts par book (spec native, aucune normalisation) :
//     • congobet   : { eventBetTypeItemId, totalOdds }
//     • sportybet  : { eventId, marketId, outcomeId, specifier? }
//     • betpawa    : { priceId } (Number)
//     • 1win       : { oddId, matchId }
//     • 1xbet      : { gameId, betType, param, kind }
//     • yellowbet, betmomo : null (403 CF impossible a bypass depuis Deno)
// - price      : Number, prix utilise a la detection (permet drift detection).
// - read_at    : ISO 8601 UTC ms (approx. moment de lecture des cotes).
//
// L'eventId (match.id du book) est ajoute pour les books ou le SaveCoupon en
// a besoin (SportyBet, 1win). Les autres l'ont deja dans les ids natifs.
function buildCoupon(book, ids, matchId, price, readAt, live, match) {
  // Pas d'ids extraits par le parseur → coupon non generable pour cette cote
  // (le parseur du book n'a pas encore ete enrichi ou marche non supporte).
  if (!ids) return null;
  const coupon = { book, price, read_at: readAt };
  // Injecter eventId pour SportyBet (natif : "sr:match:X")
  if (book === 'sportybet' && matchId != null) coupon.eventId = String(matchId);
  // Injecter matchId pour 1win (natif : Number)
  if (book === '1win' && matchId != null) coupon.matchId = Number(matchId);
  // Injecter gameId + kind pour 1xbet (natif : Number/String + 3=prematch/1=live)
  if (book === '1xbet') {
    if (matchId != null) coupon.gameId = String(matchId);
    coupon.kind = live ? 1 : 3;
  }
  // YellowBet : eventId + contexte match complet (homeName/awayName/gameTime/
  // isLive) requis par le body /placebetsport selections[].
  if (book === 'yellowbet') {
    if (matchId != null) coupon.eventId = Number(matchId);
    if (match?.home) coupon.homeName = match.home;
    if (match?.away) coupon.awayName = match.away;
    if (match?.start) coupon.gameTime = new Date(match.start).toISOString();
    coupon.isLive = !!live;
  }
  // BetMomo : eventId + siteId (211 pour BetMomo) requis par
  // /image-creator/share-booking/. Le parseur fournit deja marketType/
  // groupId/eventType/gameId/base — le backend construit le body avec ca.
  if (book === 'betmomo') {
    if (matchId != null) coupon.eventId = Number(matchId);
    coupon.siteId = 211;
  }
  // Merger les IDs natifs du parseur en dernier (peuvent overrider les defaults)
  return { ...coupon, ...ids };
}

function idFields(matches) {
  const idKeyMap = {
    '1xbet': 'onexbet_match_id', '1win': 'onewin_match_id', congobet: 'congobet_match_id',
    yellowbet: 'yellowbet_match_id', apollo: 'apollo_match_id', betmomo: 'betmomo_match_id',
    premierbet: 'premierbet_match_id',
  };
  const out = {};
  for (const [k, m] of Object.entries(matches)) {
    const target = idKeyMap[k];
    if (target && m?.id != null) out[target] = String(m.id);
  }
  return out;
}
