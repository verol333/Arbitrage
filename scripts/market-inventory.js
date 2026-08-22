#!/usr/bin/env node
// INVENTAIRE PROPRE DES MARCHES par bookmaker.
// Objectif : produire un catalogue lisible {marketName -> [selections uniques]}
// pour chaque book, sans aucune interpretation.
// Sortie : output/market-inventory.json + output/market-inventory.md
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';
import { bpFetchEvent } from '../src/bookmakers/betpawa/api.js';
import { apolloGet } from '../src/bookmakers/apollo/api.js';
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { FEED, COUNTRY, viaWorker } from '../src/bookmakers/xbet/api.js';
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const BOOKS = ['1xbet', '1win', 'congobet', 'betpawa'];
const TOP_MATCHES = 3; // 3 matchs suffit pour inventorier presque tous les marches

// Extracteurs : retourne [{market, selection}]
function ext_1xbet(raw) {
  const out = [];
  const XBET_GROUP_MAP = {
    1: 'Match Result', 8: 'Double Chance', 17: 'Over/Under',
    19: 'Both Teams To Score', 2: 'Handicap', 14: 'Odd/Even',
    9: 'Draw No Bet', 15: 'Team 1 Total', 62: 'Team 2 Total',
    27: 'Correct Score', 21: 'Winning Margin', 20: 'Exact Goals',
    28: 'Double Chance HT', 30: 'Over/Under HT', 31: 'BTTS HT',
    37: 'HT/FT', 43: 'Handicap HT', 127: 'Clean Sheet Home',
    128: 'Clean Sheet Away', 129: 'Win To Nil Home', 130: 'Win To Nil Away',
    136: 'Multigoals', 237: 'Asian Handicap', 1845: 'European Handicap',
  };
  const TYPES = {1:'Home',2:'Draw',3:'Away',4:'1X',5:'12',6:'X2',7:'Home',8:'Away',9:'Over',10:'Under',180:'Yes',181:'No',182:'Even',183:'Odd'};
  for (const ge of (raw?.Value?.GE || [])) {
    const marketName = XBET_GROUP_MAP[ge.G] || ge.GN || `G${ge.G}`;
    for (const sub of (ge.E || [])) {
      for (const it of (Array.isArray(sub) ? sub : [sub])) {
        if (it?.C == null) continue;
        let sel = it.N || TYPES[it.T] || `T${it.T}`;
        if (it.P != null) sel = `${sel} [${it.P}]`;
        out.push({ market: marketName, selection: sel });
      }
    }
  }
  return out;
}
function ext_1win(raw) {
  const out = [];
  for (const [groupName, oddsList] of Object.entries(raw || {})) {
    for (const o of oddsList || []) {
      if (!o) continue;
      out.push({ market: groupName, selection: String(o.name || o.outcome || '?') });
    }
  }
  return out;
}
function ext_congobet(raw) {
  const out = [];
  for (const bt of raw?.eventBetTypes || []) {
    for (const it of bt.eventBetTypeItems || []) {
      out.push({ market: bt.name || '?', selection: String(it.shortName || it.name || '?') });
    }
  }
  return out;
}
function ext_betpawa(raw) {
  const out = [];
  for (const mk of raw?.markets || []) {
    const marketName = mk.marketType?.name || mk.name || `m${mk.id}`;
    for (const row of (mk.row || [])) {
      const spec = row?.specifier || {};
      const suffix = spec.total ? ` [${spec.total}]` : (spec.hcp ? ` [${spec.hcp}]` : '');
      for (const p of (row.prices || [])) {
        out.push({ market: `${marketName}${suffix}`, selection: String(p.name || p.displayName || '?') });
      }
    }
  }
  return out;
}
const EXT = { '1xbet': ext_1xbet, '1win': ext_1win, congobet: ext_congobet, betpawa: ext_betpawa };

async function fetchRaw(bookKey, matchId) {
  try {
    if (bookKey === 'betpawa') return await bpFetchEvent(matchId, 15_000);
    if (bookKey === 'congobet') return await congoJson(`${CONGO_API}events/${matchId}`);
    if (bookKey === '1xbet') {
      const url = `${FEED}/service-api/LineFeed/GetGameZip?id=${matchId}&lng=fr&isSubGames=true&GroupEvents=true&countevents=2000&grMode=4&country=${COUNTRY}&marketType=1&isNewBuilder=true`;
      return await viaWorker(url);
    }
    if (bookKey === '1win') {
      const raw = await fetchOddsWS([matchId], { timeoutMs: 20000, quietMs: 3000 });
      return raw.get(matchId) || raw.get(String(matchId)) || {};
    }
  } catch (e) { return null; }
  return null;
}

// ─── Main ──────────────────────────────────────────────────────────────────
console.log('INVENTAIRE MARCHES — books:', BOOKS.join(', '));

const catalogs = new Map();
for (const key of BOOKS) {
  const book = bookmakersByKey[key];
  if (!book) continue;
  try {
    const matches = await book.listMatches({ live: false, sport: 'football', horizonHours: 30 });
    catalogs.set(key, matches);
    console.log(`[${key}] ${matches.length} matchs`);
  } catch (e) { console.log(`[${key}] KO ${e.message}`); }
}

const entries = alignCatalogs(catalogs, { minBooks: 4, horizonMs: Date.now() + 30 * 3600 * 1000 });
entries.sort((a, b) => Object.keys(b.matches).length - Object.keys(a.matches).length);
const top = entries.slice(0, TOP_MATCHES);
console.log(`${top.length} matchs communs:`);
for (const e of top) console.log(`  - ${e.ref.home} vs ${e.ref.away}`);

// { book: { market: Set(selections) } }
const inv = {};
for (const b of BOOKS) inv[b] = {};

for (const entry of top) {
  const bookMatches = Object.entries(entry.matches).filter(([b]) => EXT[b]);
  const results = await Promise.all(bookMatches.map(async ([book, m]) => {
    return { book, raw: await fetchRaw(book, m.id) };
  }));
  for (const { book, raw } of results) {
    if (!raw) continue;
    for (const { market, selection } of EXT[book](raw)) {
      if (!inv[book][market]) inv[book][market] = new Set();
      inv[book][market].add(selection);
    }
  }
}

mkdirSync('output', { recursive: true });

// JSON version
const jsonOut = {};
for (const b of BOOKS) {
  jsonOut[b] = {};
  for (const m of Object.keys(inv[b]).sort()) {
    jsonOut[b][m] = [...inv[b][m]].sort();
  }
}
writeFileSync('output/market-inventory.json', JSON.stringify(jsonOut, null, 2));

// Markdown version (lisible pour humain)
let md = `# Inventaire des marchés par bookmaker\n\nGénéré le ${new Date().toISOString()}\n\n`;
md += `Matchs analysés : ${top.map(e => `${e.ref.home} vs ${e.ref.away}`).join('  ·  ')}\n\n`;
for (const b of BOOKS) {
  const marketCount = Object.keys(inv[b]).length;
  md += `\n---\n\n## ${b} — ${marketCount} marchés uniques\n\n`;
  md += `| # | Marché brut | Sélections uniques rencontrées |\n|:-:|---|---|\n`;
  const sortedMarkets = Object.keys(inv[b]).sort();
  for (let i = 0; i < sortedMarkets.length; i++) {
    const m = sortedMarkets[i];
    const sels = [...inv[b][m]].sort();
    const selsCol = sels.slice(0, 15).map(s => `\`${s.replace(/\|/g, '\\|')}\``).join(' · ');
    const more = sels.length > 15 ? ` … (+${sels.length - 15})` : '';
    md += `| ${i+1} | \`${m.replace(/\|/g, '\\|')}\` | ${selsCol}${more} |\n`;
  }
}

writeFileSync('output/market-inventory.md', md);

console.log(`\n✅ Sortie :`);
for (const b of BOOKS) console.log(`  ${b}: ${Object.keys(inv[b]).length} marchés`);
console.log(`  JSON : output/market-inventory.json`);
console.log(`  MD   : output/market-inventory.md`);
process.exit(0);
