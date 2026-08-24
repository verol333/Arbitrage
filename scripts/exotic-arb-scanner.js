#!/usr/bin/env node
// SCANNER MARCHES INHABITUELS - 2-way cross-book pur, sans dictionnaire.
// Pour chaque marché (nom brut) et sélection identique cross-book,
// on cherche des paires "Yes chez A + No chez B" ou "Over X chez A + Under X chez B"
// qui donnent un arb.
// Cible : penalties, cartons, corners, joueurs, overtime, etc.
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';
import { bpFetchEvent } from '../src/bookmakers/betpawa/api.js';
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { FEED, COUNTRY, viaWorker } from '../src/bookmakers/xbet/api.js';
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const BOOKS = ['1xbet', '1win', 'congobet', 'betpawa'];
const TOP_MATCHES = parseInt(process.env.TOP_MATCHES || '4', 10);

// Extracteurs (identiques dictionary-solver)
function ext_1xbet(raw) {
  const out = [];
  const MAP = { 1:'Match Result', 8:'Double Chance', 17:'Over/Under', 19:'BTTS',
    2:'Handicap', 14:'Odd/Even', 15:'Team 1 Total', 62:'Team 2 Total',
    27:'Correct Score', 21:'Winning Margin', 20:'Exact Goals', 136:'Multigoals' };
  const TYPES = {1:'Home',2:'Draw',3:'Away',4:'1X',5:'12',6:'X2',7:'Home',8:'Away',9:'Over',10:'Under',180:'Yes',181:'No',182:'Even',183:'Odd'};
  for (const ge of raw?.Value?.GE || []) {
    const groupName = MAP[ge.G] || ge.GN || `G${ge.G}`;
    for (const sub of ge.E || []) {
      for (const it of (Array.isArray(sub) ? sub : [sub])) {
        if (it?.C == null) continue;
        const c = parseFloat(it.C); if (isNaN(c) || c <= 1) continue;
        let sel = it.N || TYPES[it.T] || `T${it.T}`;
        if (it.P != null) sel = `${sel} [${it.P}]`;
        out.push({ market: groupName, selection: sel, odds: c });
      }
    }
  }
  return out;
}
function ext_1win(raw) {
  const out = [];
  for (const [gn, ol] of Object.entries(raw || {}))
    for (const o of ol || []) {
      if (!o || o.status !== 1) continue;
      const c = Number(o.cf); if (isNaN(c) || c <= 1) continue;
      out.push({ market: gn, selection: String(o.name || '?'), odds: c });
    }
  return out;
}
function ext_congobet(raw) {
  const out = [];
  for (const bt of raw?.eventBetTypes || [])
    for (const it of bt.eventBetTypeItems || []) {
      const c = parseFloat(it.odds); if (isNaN(c) || c <= 1) continue;
      out.push({ market: bt.name || '?', selection: String(it.shortName || it.name || '?'), odds: c });
    }
  return out;
}
function ext_betpawa(raw) {
  const out = [];
  for (const mk of raw?.markets || []) {
    const marketName = mk.marketType?.name || mk.name || `m${mk.id}`;
    for (const row of mk.row || []) {
      const spec = row?.specifier || {};
      const suf = spec.total ? ` [${spec.total}]` : (spec.hcp ? ` [${spec.hcp}]` : '');
      for (const p of row.prices || []) {
        const c = parseFloat(p.odds); if (isNaN(c) || c <= 1) continue;
        out.push({ market: `${marketName}${suf}`, selection: String(p.name || p.displayName || '?'), odds: c });
      }
    }
  }
  return out;
}
const EXT = { '1xbet': ext_1xbet, '1win': ext_1win, congobet: ext_congobet, betpawa: ext_betpawa };
async function fetchRaw(bk, id) {
  try {
    if (bk === 'betpawa') return await bpFetchEvent(id, 15_000);
    if (bk === 'congobet') return await congoJson(`${CONGO_API}events/${id}`);
    if (bk === '1xbet') return await viaWorker(`${FEED}/service-api/LineFeed/GetGameZip?id=${id}&lng=fr&isSubGames=true&GroupEvents=true&countevents=2000&grMode=4&country=${COUNTRY}&marketType=1&isNewBuilder=true`);
    if (bk === '1win') { const r = await fetchOddsWS([id], { timeoutMs: 20000, quietMs: 3000 }); return r.get(id) || r.get(String(id)) || {}; }
  } catch { return null; }
}

// Normalise pour matching cross-book : minuscules, sans accents, sans ponctuation
function norm(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s.+\-\[\]]/g, ' ').trim().replace(/\s+/g, ' ');
}

// Classe une sélection en type : YES, NO, OVER, UNDER, HOME, AWAY, DRAW, ODD, EVEN, autre
function classifySelection(sel) {
  const s = norm(sel);
  if (/\b(yes|oui|y)\b/.test(s)) return 'YES';
  if (/\b(no|non|n)\b/.test(s)) return 'NO';
  if (/^over|^plus |^\>|\bover\s+\d/.test(s)) return 'OVER';
  if (/^under|^moins |^\<|\bunder\s+\d/.test(s)) return 'UNDER';
  if (/^odd|^impair/.test(s)) return 'ODD';
  if (/^even|^pair/.test(s)) return 'EVEN';
  if (/^1$|^home$|^dom/.test(s)) return 'HOME';
  if (/^2$|^away$|^ext/.test(s)) return 'AWAY';
  if (/^x$|^draw$|^nul/.test(s)) return 'DRAW';
  return null;
}

// Paires opposées pour arb 2-way
const OPPOSITES = {
  'YES': 'NO', 'NO': 'YES',
  'OVER': 'UNDER', 'UNDER': 'OVER',
  'ODD': 'EVEN', 'EVEN': 'ODD',
};

// Cibles : marchés à mots-clefs "exotiques" qu'on veut privilégier
const EXOTIC_KEYWORDS = /penalty|penalt|carton|card|red card|yellow card|corner|coin|tir|shot|foul|saves|throw|offside|hors-jeu|prolongation|overtime|extra time|penalt.*shootout|séance de penalty|qualif|s'imposer|goalscor|but.*joueur|player|joueur|marque|scorer|first goal|premier but|dernier but|last goal/i;

// ─── Main ───
console.log('SCANNER MARCHES INHABITUELS — 2-way pur cross-book');
const catalogs = new Map();
for (const key of BOOKS) {
  const b = bookmakersByKey[key]; if (!b) continue;
  try {
    const ms = await b.listMatches({ live: false, sport: 'football', horizonHours: 48 });
    catalogs.set(key, ms);
    console.log(`[${key}] ${ms.length} matchs`);
  } catch (e) { console.log(`[${key}] KO`); }
}

const entries = alignCatalogs(catalogs, { minBooks: 4, horizonMs: Date.now() + 48*3600*1000 });
entries.sort((a,b) => Object.keys(b.matches).length - Object.keys(a.matches).length);
const top = entries.slice(0, TOP_MATCHES);
console.log(`\n${top.length} matchs communs top :`);
for (const e of top) console.log(`  - ${e.ref.home} vs ${e.ref.away}`);

const allArbs = [];
const allExoticMarkets = {};

for (const entry of top) {
  console.log(`\n▓ ${entry.ref.home} vs ${entry.ref.away}`);
  const bookMatches = Object.entries(entry.matches).filter(([b]) => EXT[b]);
  const rawResults = await Promise.all(bookMatches.map(async ([book, m]) => {
    try { return { book, raw: await fetchRaw(book, m.id) }; } catch { return { book, raw: null }; }
  }));

  // Collecte : { normMarket: { normSel: [{ book, market_raw, selection_raw, type, odds }] } }
  const bucket = new Map();
  const marketCatalog = new Map(); // pour lister tous les marchés uniques

  for (const { book, raw } of rawResults) {
    if (!raw) { console.log(`  [${book}] KO`); continue; }
    const outs = EXT[book](raw);
    console.log(`  [${book}] ${outs.length} outcomes`);
    for (const { market, selection, odds } of outs) {
      if (odds >= 40) continue; // phantom
      const mkey = norm(market);
      const skey = norm(selection);
      const type = classifySelection(selection);
      if (!bucket.has(mkey)) bucket.set(mkey, new Map());
      const inner = bucket.get(mkey);
      if (!inner.has(skey)) inner.set(skey, []);
      inner.get(skey).push({ book, market, selection, type, odds });
      // Track exotic
      if (EXOTIC_KEYWORDS.test(market) || EXOTIC_KEYWORDS.test(selection)) {
        marketCatalog.set(mkey, market);
      }
    }
  }

  // Cherche arbs 2-way : pour chaque marché, cherche paires opposées cross-book
  const matchArbs = [];
  for (const [mkey, sels] of bucket) {
    const items = [...sels.values()].flat();
    // Groupe par type
    const byType = {};
    for (const it of items) {
      if (!it.type || !OPPOSITES[it.type]) continue;
      if (!byType[it.type]) byType[it.type] = [];
      byType[it.type].push(it);
    }
    // Pour chaque type, cherche l'opposé
    for (const t of Object.keys(byType)) {
      const opp = OPPOSITES[t];
      if (!byType[opp]) continue;
      // meilleure cote pour t, meilleure cote pour opp, books différents
      const bestT = byType[t].sort((a,b) => b.odds - a.odds)[0];
      const bestOpp = byType[opp].sort((a,b) => b.odds - a.odds)[0];
      if (bestT.book === bestOpp.book) continue; // pas cross-book
      const sumInv = 1/bestT.odds + 1/bestOpp.odds;
      if (sumInv < 1) {
        const profit = 1 - sumInv;
        matchArbs.push({
          market_key: mkey, market_a: bestT.market, market_b: bestOpp.market,
          book_a: bestT.book, book_b: bestOpp.book,
          sel_a: bestT.selection, sel_b: bestOpp.selection,
          odds_a: bestT.odds, odds_b: bestOpp.odds,
          profit,
          exotic: EXOTIC_KEYWORDS.test(mkey) || EXOTIC_KEYWORDS.test(bestT.selection) || EXOTIC_KEYWORDS.test(bestOpp.selection),
        });
      }
    }
  }
  // Trie par profit desc
  matchArbs.sort((a,b) => b.profit - a.profit);
  console.log(`  → ${matchArbs.length} arbs 2-way trouvés (${matchArbs.filter(a => a.exotic).length} exotiques)`);
  for (const a of matchArbs) allArbs.push({ ...a, match: `${entry.ref.home} vs ${entry.ref.away}` });
  // Ajoute marchés exotiques trouvés pour ce match
  for (const [mk, mn] of marketCatalog) {
    if (!allExoticMarkets[mn]) allExoticMarkets[mn] = 0;
    allExoticMarkets[mn]++;
  }
}

allArbs.sort((a,b) => b.profit - a.profit);

console.log(`\n═══ TOP 30 ARBS 2-WAY (exotiques prioritaires) ═══`);
const exoticArbs = allArbs.filter(a => a.exotic);
const normalArbs = allArbs.filter(a => !a.exotic);
console.log(`Total : ${allArbs.length} arbs — ${exoticArbs.length} exotiques + ${normalArbs.length} classiques\n`);

console.log('▓▓ EXOTIQUES (penalty, cartons, corners, joueurs, etc.) ▓▓');
for (const [i, a] of exoticArbs.slice(0, 15).entries()) {
  console.log(`#${i+1} ${(a.profit*100).toFixed(2)}%  ${a.match}`);
  console.log(`   [${a.book_a}] ${a.market_a} → ${a.sel_a} @ ${a.odds_a.toFixed(2)}`);
  console.log(`   [${a.book_b}] ${a.market_b} → ${a.sel_b} @ ${a.odds_b.toFixed(2)}`);
}
console.log('\n▓▓ CLASSIQUES (top 10 pour info) ▓▓');
for (const [i, a] of normalArbs.slice(0, 10).entries()) {
  console.log(`#${i+1} ${(a.profit*100).toFixed(2)}%  ${a.match}`);
  console.log(`   [${a.book_a}] ${a.market_a} → ${a.sel_a} @ ${a.odds_a.toFixed(2)}`);
  console.log(`   [${a.book_b}] ${a.market_b} → ${a.sel_b} @ ${a.odds_b.toFixed(2)}`);
}

console.log('\n═══ INVENTAIRE MARCHES EXOTIQUES OBSERVES ═══');
const sorted = Object.entries(allExoticMarkets).sort((a,b) => b[1] - a[1]);
for (const [name, count] of sorted.slice(0, 40)) console.log(`  ${count}× ${name}`);

mkdirSync('output', { recursive: true });
writeFileSync('output/exotic-arb-scan.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  matches: top.map(e => ({ home: e.ref.home, away: e.ref.away })),
  total_arbs: allArbs.length,
  exotic_arbs: exoticArbs.length,
  arbs: allArbs.slice(0, 100),
  exotic_markets: sorted,
}, null, 2));
console.log(`\nJSON : output/exotic-arb-scan.json`);
process.exit(0);
