#!/usr/bin/env node
// Dump BRUT de tous les marches disponibles sur un match, book par book.
// Bypass nos parseurs — on veut voir les marches qu'on n'exploite PAS encore.
// Objectif : identifier les nouveaux marches (exact scores, corners exacts,
// buteurs, cartons par joueur, intervalles, etc.) qui peuvent creer des
// coverage sets combinatoires >= 50% de profit.
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';

// Books avec fonction fetchEvent que je vais appeler directement (raw JSON).
import { bpFetchEvent } from '../src/bookmakers/betpawa/api.js';
import { fetchMatchBts as ybFetchBts, evapi as yellowbetGet } from '../src/bookmakers/yellowbet/api.js';
import { sbFetchEvent } from '../src/bookmakers/sportybet/api.js';
import { apolloGet } from '../src/bookmakers/apollo/api.js';
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';

const BOOKS = ['1xbet', '1win', 'congobet', 'betpawa', 'yellowbet', 'sportybet', 'apollo'];
// TOP_MATCHES_COUNT : on recupere automatiquement les N matchs les plus populaires
// (i.e. presents sur le max de books) plutot que de hardcoder des matchs precis
// (risque d'etre perimes). Chaque match populaire aura probablement une longue
// liste de marches exotiques → jackpot pour combinatoire.
const TOP_MATCHES_COUNT = 3;

// ─── Extracteurs par book (adaptes a leur structure JSON) ─────────────────
// Chaque extracteur retourne : [{ market, selection, odds, line? }]
// market = famille (ex: "Total Buts", "Correct Score")
// selection = valeur (ex: "Over 2.5", "1-0")
function extract_xbet(raw) {
  const out = [];
  const groups = raw?.Value?.GE || [];
  for (const g of groups) {
    const marketId = g.G || g.T || '';
    const marketName = g.N || `bet-type-${marketId}`;
    for (const sub of g.E || []) {
      const items = Array.isArray(sub) ? sub : [sub];
      for (const it of items) {
        const c = parseFloat(it.C);
        if (isNaN(c) || c <= 1) continue;
        const sel = it.N || `T${it.T}${it.P != null ? `_P${it.P}` : ''}`;
        out.push({ market: String(marketName), selection: String(sel), odds: c, line: it.P ?? null });
      }
    }
  }
  return out;
}

function extract_congobet(raw) {
  const out = [];
  const bts = raw?.eventBetTypes || [];
  for (const bt of bts) {
    const marketName = bt.name || '?';
    for (const it of bt.items || []) {
      const c = parseFloat(it.odds);
      if (isNaN(c) || c <= 1) continue;
      out.push({ market: String(marketName), selection: String(it.shortName || it.name || '?'), odds: c });
    }
  }
  return out;
}

function extract_sportybet(raw) {
  const out = [];
  const markets = raw?.data?.markets || raw?.markets || [];
  for (const m of markets) {
    const marketName = m.name || `market-${m.id}`;
    const spec = m.specifier ? ` [${m.specifier}]` : '';
    for (const o of m.outcomes || []) {
      const c = parseFloat(o.odds);
      if (isNaN(c) || c <= 1) continue;
      out.push({ market: String(marketName), selection: `${o.desc || o.name || '?'}${spec}`, odds: c });
    }
  }
  return out;
}

function extract_apollo(raw) {
  const out = [];
  const offers = raw?.Offers || raw?.BasicOffer ? [raw.BasicOffer, ...(raw.Offers || [])].filter(Boolean) : [];
  const allOffers = raw?.Offers || [];
  for (const o of allOffers) {
    const marketName = o.Description || `bettype-${o.BetTypeKey}`;
    const sbv = o.Sbv ? ` [${o.Sbv}]` : '';
    for (const od of o.Odds || []) {
      const c = parseFloat(od.Odd);
      if (isNaN(c) || c <= 1) continue;
      out.push({ market: String(marketName), selection: `${od.Name || od.Type || '?'}${sbv}`, odds: c });
    }
  }
  return out;
}

function extract_yellowbet(raw) {
  const out = [];
  const bts = Array.isArray(raw) ? raw : (raw?.data?.bts || raw?.bts || []);
  for (const bt of bts) {
    const marketName = bt.n || `bet-${bt.id || '?'}`;
    const items = bt.odds || bt.o || [];
    for (const o of items) {
      const c = parseFloat(o.p);
      if (isNaN(c) || c <= 1) continue;
      const line = o.l != null ? ` [${o.l}]` : '';
      out.push({ market: String(marketName), selection: `${o.n || o.id || '?'}${line}`, odds: c });
    }
  }
  return out;
}

function extract_betpawa(raw) {
  const out = [];
  const markets = raw?.markets || [];
  for (const m of markets) {
    const marketName = m.name || m.marketTypeName || `market-${m.id}`;
    for (const p of m.prices || []) {
      const c = parseFloat(p.price);
      if (isNaN(c) || c <= 1) continue;
      out.push({ market: String(marketName), selection: String(p.name || '?'), odds: c });
    }
  }
  return out;
}

const EXTRACTORS = {
  '1xbet': extract_xbet,
  'congobet': extract_congobet,
  'sportybet': extract_sportybet,
  'apollo': extract_apollo,
  'yellowbet': extract_yellowbet,
  'betpawa': extract_betpawa,
};

function extractOdds(raw, bookKey) {
  const fn = EXTRACTORS[bookKey];
  if (!fn) return [];
  try { return fn(raw); } catch (e) { return []; }
}

// Fonction generique pour recuperer les cotes brutes d'un match.
async function rawMarketsFor(bookKey, matchId) {
  try {
    if (bookKey === 'betpawa') {
      const j = await bpFetchEvent(matchId, 15_000, { fresh: false });
      return { raw: j, keys: Object.keys(j || {}) };
    }
    if (bookKey === 'yellowbet') {
      const bts = await ybFetchBts(matchId);
      return { raw: bts, keys: Array.isArray(bts) ? [`Array(${bts.length})`] : Object.keys(bts || {}) };
    }
    if (bookKey === 'sportybet') {
      const j = await sbFetchEvent(matchId, { live: false });
      return { raw: j, keys: Object.keys(j || {}) };
    }
    if (bookKey === 'apollo') {
      const j = await apolloGet(`/sport/offer/v3/match/offers?MatchId=${matchId}`);
      return { raw: j, keys: Object.keys(j || {}) };
    }
    if (bookKey === 'congobet') {
      const j = await congoJson(`${CONGO_API}events/${matchId}`);
      return { raw: j, keys: Object.keys(j || {}) };
    }
    if (bookKey === '1xbet') {
      // 1xbet : GetGameZip endpoint donne tous les marches
      const url = `https://1xbet.cg/service-api/LineFeed/GetGameZip?id=${matchId}&lng=fr&isSubGames=true&GroupEvents=true&countevents=250&partner=192&grMode=4&topGroups=&marketType=1&country=93`;
      const { viaWorker } = await import('../src/bookmakers/xbet/odds.js').catch(() => ({}));
      // fallback fetch direct via CF workers (comme fait par le connecteur)
      const { fetchJson } = await import('../src/net/fetcher.js');
      const j = await fetchJson(url, { timeoutMs: 20_000, headers: { accept: 'application/json' } });
      return { raw: j, keys: Object.keys(j || {}) };
    }
    if (bookKey === '1win') {
      // 1win : WebSocket. Complexe. Skip pour ce POC.
      return { raw: null, keys: [], skipped: '1win = WebSocket, requiert setup separe' };
    }
  } catch (e) {
    return { raw: null, keys: [], err: e.message };
  }
  return { raw: null, keys: [], err: 'book non gere' };
}

// ─── Main ──────────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════');
console.log('  DUMP BRUT DES MARCHES — decouverte marches non exploites');
console.log(`  Books  : ${BOOKS.join(', ')}`);
console.log(`  Auto-select : top ${TOP_MATCHES_COUNT} matchs les plus populaires`);
console.log('═══════════════════════════════════════════════════════════════\n');

// 1. Liste les matchs par book pour trouver les IDs des cibles
const catalogs = new Map();
for (const key of BOOKS) {
  const book = bookmakersByKey[key];
  if (!book) { console.log(`[${key}] non trouve dans registre`); continue; }
  try {
    const matches = await book.listMatches({ live: false, sport: 'football', horizonHours: 30 });
    catalogs.set(key, matches);
    console.log(`[${key}] listMatches OK — ${matches.length} matchs`);
  } catch (e) {
    console.log(`[${key}] listMatches KO : ${e.message}`);
  }
}
console.log('');

// 2. Alignement auto : trouve les TOP_MATCHES_COUNT matchs presents sur le max de books
const entries = alignCatalogs(catalogs, { minBooks: 4, horizonMs: Date.now() + 48 * 3600 * 1000 });
// Trie par (nb books couverts, kickoff proche)
entries.sort((a, b) => {
  const na = Object.keys(a.matches).length;
  const nb = Object.keys(b.matches).length;
  if (nb !== na) return nb - na;
  return (a.ref.start || 0) - (b.ref.start || 0);
});
const topEntries = entries.slice(0, TOP_MATCHES_COUNT);
console.log(`\n${topEntries.length} matchs top populaires selectionnes :`);
for (const e of topEntries) console.log(`  ${e.ref.home} vs ${e.ref.away} — ${Object.keys(e.matches).length} books — ${e.ref.start ? new Date(e.ref.start).toISOString() : 'no start'}`);

for (const entry of topEntries) {
  const target = { home: entry.ref.home, away: entry.ref.away };
  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║  ${target.home} vs ${target.away}`);
  console.log(`╚══════════════════════════════════════════════════════════════╝`);
  for (const key of BOOKS) {
    const m = entry.matches[key];
    if (!m) { console.log(`\n[${key}] match NON TROUVE (alignCatalogs pas de correspondance)`); continue; }
    console.log(`\n[${key}] matchId=${m.id} (${m.home} vs ${m.away})`);
    const { raw, keys, err, skipped } = await rawMarketsFor(key, m.id);
    if (err) { console.log(`  ❌ ${err}`); continue; }
    if (skipped) { console.log(`  ⏭️ ${skipped}`); continue; }
    if (!raw) { console.log(`  ⚠️ raw vide`); continue; }
    console.log(`  Top-level keys : ${keys.slice(0, 10).join(', ')}${keys.length > 10 ? '...' : ''}`);
    const odds = extractOdds(raw, key);
    console.log(`  📊 ${odds.length} outcomes extraits`);
    // Grouper par famille de marche
    const byFam = new Map();
    for (const o of odds) {
      if (!byFam.has(o.market)) byFam.set(o.market, []);
      byFam.get(o.market).push(o);
    }
    const fams = [...byFam.entries()].sort((a, b) => b[1].length - a[1].length);
    console.log(`  🎯 ${fams.length} marches distincts :`);
    for (const [fam, arr] of fams.slice(0, 30)) {
      const sample = arr.slice(0, 4).map(o => `${o.selection}@${o.odds.toFixed(2)}`).join(' | ');
      console.log(`     ${fam.slice(0, 45).padEnd(45)} × ${String(arr.length).padStart(3)} : ${sample.slice(0, 100)}`);
    }
  }
}

console.log(`\n═══ Fin dump brut ═══`);
process.exit(0);
