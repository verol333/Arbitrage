#!/usr/bin/env node
// SOLVEUR DICTIONNAIRE : arbitrage combinatoire sans regex.
// Chaque outcome est classifie via src/dictionary/resolvers.js (mapping explicite).
// Aucune deviner de semantique — un marche non-mappe est simplement ignore.
//
// Sortie : opps disjointes couvrant 100% de la grille (h,a) [0..14 buts]
// avec calcul de mises pour bankroll donnee.
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';
import { bpFetchEvent } from '../src/bookmakers/betpawa/api.js';
import { apolloGet } from '../src/bookmakers/apollo/api.js';
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { FEED, COUNTRY, viaWorker } from '../src/bookmakers/xbet/api.js';
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';
import { resolveOutcome } from '../src/dictionary/resolvers.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const BOOKS = (process.env.SOLVER_BOOKS || '1xbet,congobet,betpawa,1win').split(',').map(s => s.trim());
const TOP_MATCHES = parseInt(process.env.SOLVER_TOP_MATCHES || '5', 10);
const MIN_PROFIT = parseFloat(process.env.SOLVER_MIN_PROFIT || '0.005'); // 0.5% par defaut
const BANKROLL = parseFloat(process.env.SOLVER_BANKROLL || '100000');
const HORIZON_H = parseInt(process.env.SOLVER_HORIZON_HOURS || '72', 10);
const MATCH_BATCH = parseInt(process.env.SOLVER_MATCH_BATCH || '6', 10); // matchs en parallele
const GRID = 15; // 15x15 = 225 cellules (couvre tout le foot realiste)

const ALL_MASK = (1n << BigInt(GRID * GRID)) - 1n;
function cellBit(h, a) { return (h < GRID && a < GRID) ? 1n << BigInt(h * GRID + a) : 0n; }
function popcount(bi) { let n = 0n; while (bi > 0n) { n += bi & 1n; bi >>= 1n; } return Number(n); }

function buildMask(pred) {
  let m = 0n;
  for (let h = 0; h < GRID; h++) for (let a = 0; a < GRID; a++) if (pred(h, a)) m |= cellBit(h, a);
  return m;
}

// ─── Extracteurs raw → [{market, selection, odds}] ─────────────────────────
function extract1xbet(raw) {
  const out = [];
  const MAP = {
    1:'Match Result', 8:'Double Chance', 17:'Over/Under', 19:'Both Teams To Score',
    2:'Handicap', 14:'Odd/Even', 15:'Team 1 Total', 62:'Team 2 Total',
    27:'Correct Score', 21:'Winning Margin', 20:'Exact Goals', 136:'Multigoals',
  };
  const TYPES = {1:'Home',2:'Draw',3:'Away',4:'1X',5:'12',6:'X2',7:'Home',8:'Away',9:'Over',10:'Under',180:'Yes',181:'No',182:'Even',183:'Odd'};
  for (const ge of raw?.Value?.GE || []) {
    const groupName = MAP[ge.G] || ge.GN || `G${ge.G}`;
    for (const sub of ge.E || []) {
      for (const it of (Array.isArray(sub) ? sub : [sub])) {
        if (it?.C == null) continue;
        const c = parseFloat(it.C);
        if (isNaN(c) || c <= 1) continue;
        let sel = it.N || TYPES[it.T] || `T${it.T}`;
        if (it.P != null && ge.G === 17 || ge.G === 15 || ge.G === 62) sel = `${sel} [${it.P}]`;
        if (it.P != null && ge.G === 2) sel = `${sel} (${it.P > 0 ? '+' : ''}${it.P})`;
        out.push({ market: groupName, selection: sel, odds: c });
      }
    }
  }
  // Subgames : correct score
  return out;
}
async function extract1xbetSubgames(raw) {
  const out = [];
  for (const sg of raw?.Value?.SG || []) {
    if (!/score exact|correct score/i.test((sg.PN || '').toLowerCase())) continue;
    if (!sg.I) continue;
    try {
      const sd = await viaWorker(`${FEED}/service-api/LineFeed/GetGameZip?id=${sg.I}&lng=fr&isSubGames=false&GroupEvents=true&countevents=250&grMode=4&country=${COUNTRY}&marketType=1&isNewBuilder=true`);
      for (const ge of sd?.Value?.GE || []) {
        for (const sub of ge.E || []) {
          for (const it of (Array.isArray(sub) ? sub : [sub])) {
            if (it?.C == null || !it.N) continue;
            const c = parseFloat(it.C);
            if (isNaN(c) || c <= 1) continue;
            if (!/^\d+\s*[:\-]\s*\d+$/.test(String(it.N).trim())) continue;
            out.push({ market: 'Correct Score', selection: String(it.N).trim(), odds: c });
          }
        }
      }
    } catch {}
  }
  return out;
}
function extract1win(raw) {
  const out = [];
  for (const [groupName, oddsList] of Object.entries(raw || {})) {
    for (const o of oddsList || []) {
      if (!o || o.status !== 1) continue;
      const c = Number(o.cf);
      if (isNaN(c) || c <= 1) continue;
      out.push({ market: groupName, selection: String(o.name || '?'), odds: c });
    }
  }
  return out;
}
function extractCongobet(raw) {
  const out = [];
  for (const bt of raw?.eventBetTypes || []) {
    for (const it of bt.eventBetTypeItems || []) {
      const c = parseFloat(it.odds);
      if (isNaN(c) || c <= 1) continue;
      out.push({ market: bt.name || '?', selection: String(it.shortName || it.name || '?'), odds: c });
    }
  }
  return out;
}
function extractBetpawa(raw) {
  const out = [];
  for (const mk of raw?.markets || []) {
    const marketName = mk.marketType?.name || mk.name || `m${mk.id}`;
    for (const row of mk.row || []) {
      const spec = row?.specifier || {};
      const suffix = spec.total ? ` [${spec.total}]` : (spec.hcp ? ` [${spec.hcp}]` : '');
      for (const p of row.prices || []) {
        const c = parseFloat(p.odds);
        if (isNaN(c) || c <= 1) continue;
        out.push({ market: `${marketName}${suffix}`, selection: String(p.name || p.displayName || '?'), odds: c });
      }
    }
  }
  return out;
}

async function fetchRaw(bookKey, matchId) {
  try {
    if (bookKey === 'betpawa') return await bpFetchEvent(matchId, 15_000);
    if (bookKey === 'congobet') return await congoJson(`${CONGO_API}events/${matchId}`);
    if (bookKey === '1xbet') return await viaWorker(`${FEED}/service-api/LineFeed/GetGameZip?id=${matchId}&lng=fr&isSubGames=true&GroupEvents=true&countevents=2000&grMode=4&country=${COUNTRY}&marketType=1&isNewBuilder=true`);
    if (bookKey === '1win') { const r = await fetchOddsWS([matchId], { timeoutMs: 20000, quietMs: 3000 }); return r.get(matchId) || r.get(String(matchId)) || {}; }
  } catch { return null; }
}

async function extractWithSubgames(book, raw) {
  const base = { '1xbet': extract1xbet, '1win': extract1win, congobet: extractCongobet, betpawa: extractBetpawa }[book](raw);
  if (book === '1xbet') { const sg = await extract1xbetSubgames(raw); base.push(...sg); }
  return base;
}

// ─── Solveur ────────────────────────────────────────────────────────────────
function areDisjoint(picks) {
  let cumul = 0n;
  for (const p of picks) { if ((cumul & p.mask) !== 0n) return false; cumul |= p.mask; }
  return true;
}

function findCoverageSets(items, minProfit) {
  const arr = items.slice().sort((a, b) => popcount(b.mask) - popcount(a.mask));
  const N = arr.length;
  const opps = [];
  const push = (picks, sumInv) => {
    if (!areDisjoint(picks)) return;
    if (new Set(picks.map(p => p.book)).size < 2) return;
    opps.push({ picks, profit: 1 - sumInv, sumInv, size: picks.length });
  };
  for (let i = 0; i < N; i++) {
    const inv1 = 1 / arr[i].odds; if (inv1 >= 1 - minProfit) continue;
    for (let j = i + 1; j < N; j++) {
      const inv2 = inv1 + 1 / arr[j].odds; if (inv2 >= 1 - minProfit) continue;
      const m2 = arr[i].mask | arr[j].mask;
      if (m2 === ALL_MASK) push([arr[i], arr[j]], inv2);
      for (let k = j + 1; k < N; k++) {
        const inv3 = inv2 + 1 / arr[k].odds; if (inv3 >= 1 - minProfit) continue;
        const m3 = m2 | arr[k].mask;
        if (m3 === ALL_MASK) push([arr[i], arr[j], arr[k]], inv3);
        for (let l = k + 1; l < N; l++) {
          const inv4 = inv3 + 1 / arr[l].odds; if (inv4 >= 1 - minProfit) continue;
          const m4 = m3 | arr[l].mask;
          if (m4 === ALL_MASK) push([arr[i], arr[j], arr[k], arr[l]], inv4);
        }
      }
    }
  }
  return opps;
}

function computeStakes(picks, bankroll) {
  const sumInv = picks.reduce((s, p) => s + 1 / p.odds, 0);
  const stakes = picks.map(p => (bankroll / p.odds) / sumInv);
  const total = stakes.reduce((a, b) => a + b, 0);
  return { stakes, total, retour: bankroll / sumInv, gainNet: bankroll / sumInv - total };
}

// ─── Main ───────────────────────────────────────────────────────────────────
console.log(`SOLVEUR DICTIONNAIRE — ${BOOKS.join(',')} — top ${TOP_MATCHES} — profit>=${(MIN_PROFIT*100).toFixed(2)}%`);
const t0 = Date.now();

const catalogs = new Map();
for (const key of BOOKS) {
  const book = bookmakersByKey[key];
  if (!book) continue;
  try {
    const matches = await book.listMatches({ live: false, sport: 'football', horizonHours: HORIZON_H });
    catalogs.set(key, matches);
    console.log(`[${key}] ${matches.length} matchs`);
  } catch (e) { console.log(`[${key}] KO ${e.message}`); }
}

const entries = alignCatalogs(catalogs, { minBooks: 3, horizonMs: Date.now() + HORIZON_H*3600*1000 });

// Filtre ligues top-tier (matchs top-scrutees rarement mispricees).
// Blacklist elargi : major leagues + Champions/Europa League + top American.
const TOP_LEAGUES = /premier league|bundesliga|la ?liga|serie a|ligue 1|champions league|europa league|world cup|europa conference|copa libertadores|copa america|nations league|mls$|major league soccer|primeira liga|eredivisie|super lig|liga mx|argentine primera|brasil.*serie a|scottish premiership|belgian pro|super league.*swiss/i;

const EXCLUDE_TOP = process.env.SOLVER_EXCLUDE_TOP_LEAGUES !== '0';
const filtered = EXCLUDE_TOP ? entries.filter(e => {
  const league = String(e.ref.league || '').toLowerCase();
  return !TOP_LEAGUES.test(league);
}) : entries;
console.log(`${entries.length} matchs alignes >=3 books, ${filtered.length} apres filtre ligues top`);

// Tri : plus de books = matching plus fiable. On garde les matchs avec le max de books.
filtered.sort((a, b) => Object.keys(b.matches).length - Object.keys(a.matches).length);
const top = filtered.slice(0, TOP_MATCHES);

const allOpps = [];
const stats = { totalOutcomes: 0, resolved: 0, unresolved: 0, byBook: {} };

// Process 1 match : fetch tous books en //, classif, cherche opps
async function processMatch(entry, idx) {
  const label = `[${idx+1}/${top.length}] ${entry.ref.home} vs ${entry.ref.away}`;
  const bookMatches = Object.entries(entry.matches).filter(([b]) => BOOKS.includes(b));
  const rawResults = await Promise.all(bookMatches.map(async ([book, m]) => {
    try { return { book, raw: await fetchRaw(book, m.id) }; } catch (e) { return { book, raw: null }; }
  }));
  const items = [];
  let localTot = 0, localRes = 0, localUnr = 0;
  const localByBook = {};
  for (const { book, raw } of rawResults) {
    if (!raw) continue;
    const outcomes = await extractWithSubgames(book, raw);
    for (const o of outcomes) {
      localTot++;
      if (o.odds >= 40) { localUnr++; continue; }
      const r = resolveOutcome({ book, market: o.market, selection: o.selection, homeTeam: entry.ref.home, awayTeam: entry.ref.away });
      if (!r) { localUnr++; continue; }
      const mask = buildMask(r.pred);
      if (mask === 0n || mask === ALL_MASK) { localUnr++; continue; }
      items.push({ book, market: o.market, selection: o.selection, odds: o.odds, resolved: r, mask });
      localRes++;
      localByBook[book] = (localByBook[book] || 0) + 1;
    }
  }
  // Dedup : garde meilleure cote par (book, family, selection)
  const uniq = new Map();
  for (const it of items) {
    const key = `${it.book}|${it.resolved.family}|${it.resolved.selection}`;
    if (!uniq.has(key) || it.odds > uniq.get(key).odds) uniq.set(key, it);
  }
  const pool = [...uniq.values()];
  const opps = findCoverageSets(pool, MIN_PROFIT);
  const oppList = opps.map(o => ({ ...o, match: `${entry.ref.home} vs ${entry.ref.away}` }));
  console.log(`${label}  outc=${localTot} res=${localRes} pool=${pool.length} opps=${opps.length}`);
  return { oppList, localTot, localRes, localUnr, localByBook };
}

// Traite les matchs par batch de MATCH_BATCH en parallele
for (let b = 0; b < top.length; b += MATCH_BATCH) {
  const batch = top.slice(b, b + MATCH_BATCH).map((e, k) => processMatch(e, b + k));
  const results = await Promise.all(batch);
  for (const r of results) {
    allOpps.push(...r.oppList);
    stats.totalOutcomes += r.localTot;
    stats.resolved += r.localRes;
    stats.unresolved += r.localUnr;
    for (const [bk, n] of Object.entries(r.localByBook)) stats.byBook[bk] = (stats.byBook[bk] || 0) + n;
  }
}

allOpps.sort((a, b) => b.profit - a.profit);

console.log(`\n═════════════ RESULTATS (${allOpps.length}) ═════════════`);
for (const [i, o] of allOpps.slice(0, 20).entries()) {
  const { stakes, total, retour, gainNet } = computeStakes(o.picks, BANKROLL);
  console.log(`\n#${i+1} PROFIT ${(o.profit*100).toFixed(2)}% (${o.size} sel) — ${o.match}`);
  console.log(`   Bankroll ${BANKROLL.toLocaleString('fr')} XOF → mise ${total.toFixed(0)} → retour ${retour.toFixed(0)} → gain +${gainNet.toFixed(0)} XOF`);
  for (let k = 0; k < o.picks.length; k++) {
    const p = o.picks[k];
    console.log(`   • [${p.book.padEnd(9)}] ${String(p.market).slice(0,45).padEnd(45)} → ${String(p.selection).slice(0,25).padEnd(25)} @ ${p.odds.toFixed(2)}  mise ${stakes[k].toFixed(0)}  [${p.resolved.family}/${p.resolved.selection}]`);
  }
}

console.log(`\n═════════════ STATS ═════════════`);
console.log(`Outcomes total : ${stats.totalOutcomes}`);
console.log(`Resolus       : ${stats.resolved} (${(stats.resolved/stats.totalOutcomes*100).toFixed(1)}%)`);
console.log(`Non-resolus   : ${stats.unresolved}`);
console.log(`Par book      : ${JSON.stringify(stats.byBook)}`);

mkdirSync('output', { recursive: true });
writeFileSync('output/dictionary-scan.json', JSON.stringify({
  generated_at: new Date().toISOString(), stats,
  opportunities: allOpps.slice(0, 50).map(o => ({
    match: o.match, profit: o.profit, size: o.size,
    picks: o.picks.map(p => ({ book: p.book, market: p.market, selection: p.selection, odds: p.odds, family: p.resolved.family, resolved_selection: p.resolved.selection })),
  })),
}, null, 2));
console.log(`\nDuree ${((Date.now()-t0)/1000).toFixed(1)}s — output/dictionary-scan.json`);
process.exit(0);
