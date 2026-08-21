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
// Cherche ces matchs (grands matchs Champions League / MLS ce soir)
const TARGET_MATCHES = [
  { home: 'Celtic', away: 'LASK' },
  { home: 'Slovan Bratislava', away: 'NK Celje' },
  { home: 'Hapoel Be', away: 'Sabah' },   // Beer Sheva vs Sabah FK
  { home: 'NEC', away: 'Bodo' },
];

// ─── Extraction generique d'odds dans un JSON ────────────────────────────
// On scanne recursivement l'objet, on collecte toutes les paires
// { potential_market_name, potential_outcome_name, odds_value }.
function extractOdds(obj, path = '') {
  const results = [];
  if (obj == null || typeof obj !== 'object') return results;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) results.push(...extractOdds(obj[i], `${path}[${i}]`));
    return results;
  }
  // Heuristique : si l'objet ressemble a { name/label + odds/coefficient/value }
  const name = obj.Name || obj.name || obj.label || obj.T || obj.title || obj.n || null;
  const oddsVal = obj.coefficient || obj.Coefficient || obj.C || obj.odds || obj.value || obj.Value || obj.k || obj.p || obj.price;
  if (typeof oddsVal === 'number' && oddsVal >= 1.01 && oddsVal <= 500 && name) {
    results.push({ name: String(name).slice(0, 60), odds: oddsVal, path });
  } else if (typeof oddsVal === 'string' && /^\d+(\.\d+)?$/.test(oddsVal)) {
    const v = parseFloat(oddsVal);
    if (v >= 1.01 && v <= 500 && name) results.push({ name: String(name).slice(0, 60), odds: v, path });
  }
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'object') results.push(...extractOdds(v, `${path}.${k}`));
  }
  return results;
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
console.log(`  Cibles : ${TARGET_MATCHES.map(m => `${m.home} vs ${m.away}`).join(' | ')}`);
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

// 2. Pour chaque match cible, trouve l'ID sur chaque book
function findMatchId(matches, home, away) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const h = norm(home);
  const a = norm(away);
  return matches.find((m) => {
    const mh = norm(m.home);
    const ma = norm(m.away);
    return (mh.includes(h) || h.includes(mh)) && (ma.includes(a) || a.includes(ma));
  });
}

for (const target of TARGET_MATCHES) {
  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║  ${target.home} vs ${target.away}`);
  console.log(`╚══════════════════════════════════════════════════════════════╝`);
  for (const key of BOOKS) {
    const matches = catalogs.get(key);
    if (!matches) { console.log(`\n[${key}] pas de catalogue`); continue; }
    const m = findMatchId(matches, target.home, target.away);
    if (!m) { console.log(`\n[${key}] match NON TROUVE`); continue; }
    console.log(`\n[${key}] matchId=${m.id} (${m.home} vs ${m.away})`);
    const { raw, keys, err, skipped } = await rawMarketsFor(key, m.id);
    if (err) { console.log(`  ❌ ${err}`); continue; }
    if (skipped) { console.log(`  ⏭️ ${skipped}`); continue; }
    if (!raw) { console.log(`  ⚠️ raw vide`); continue; }
    console.log(`  Top-level keys : ${keys.slice(0, 12).join(', ')}${keys.length > 12 ? '...' : ''}`);
    const odds = extractOdds(raw);
    // Dedupliquer par (name, odds) car certains books repetent
    const uniq = new Map();
    for (const o of odds) {
      const k = `${o.name}|${o.odds}`;
      if (!uniq.has(k)) uniq.set(k, o);
    }
    const all = [...uniq.values()];
    console.log(`  📊 ${all.length} outcomes uniques trouves (${odds.length} bruts)`);
    // Grouper par "premier mot" du name (heuristique : famille de marche)
    const byFam = new Map();
    for (const o of all) {
      const fam = String(o.name).split(/[\s:]+/)[0].slice(0, 20);
      if (!byFam.has(fam)) byFam.set(fam, []);
      byFam.get(fam).push(o);
    }
    const fams = [...byFam.entries()].sort((a, b) => b[1].length - a[1].length);
    console.log(`  🎯 Familles marches (top 25) :`);
    for (const [fam, arr] of fams.slice(0, 25)) {
      const sample = arr.slice(0, 3).map(o => `${o.name}@${o.odds.toFixed(2)}`).join(' | ');
      console.log(`     ${fam.padEnd(22)} × ${String(arr.length).padStart(4)} : ${sample}`);
    }
  }
}

console.log(`\n═══ Fin dump brut ═══`);
process.exit(0);
