#!/usr/bin/env node
// Dump COMPLET des cotes d'UN match sur les 4 books, format lisible humain.
// Aucune interpretation, juste marketName / selection / odds par book.
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';
import { bpFetchEvent } from '../src/bookmakers/betpawa/api.js';
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { FEED, COUNTRY, viaWorker } from '../src/bookmakers/xbet/api.js';
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const BOOKS = ['1xbet', '1win', 'congobet', 'betpawa'];

// Extracteurs bruts (identiques a market-inventory.js mais avec cotes)
function ext_1xbet(raw) {
  const out = [];
  const MAP = { 1:'Match Result',8:'Double Chance',17:'Over/Under',19:'BTTS',2:'Handicap',14:'Odd/Even',15:'Team 1 Total',62:'Team 2 Total',27:'Correct Score',21:'Winning Margin',20:'Exact Goals',136:'Multigoals',127:'Clean Sheet Home',128:'Clean Sheet Away',129:'Win To Nil Home',130:'Win To Nil Away',237:'Asian Handicap' };
  const TYPES = {1:'Home',2:'Draw',3:'Away',4:'1X',5:'12',6:'X2',7:'Home',8:'Away',9:'Over',10:'Under',180:'Yes',181:'No',182:'Even',183:'Odd'};
  for (const ge of raw?.Value?.GE || []) {
    const mn = MAP[ge.G] || ge.GN || `G${ge.G}`;
    for (const sub of ge.E || []) {
      for (const it of (Array.isArray(sub) ? sub : [sub])) {
        if (it?.C == null) continue;
        const c = parseFloat(it.C); if (isNaN(c) || c <= 1) continue;
        let sel = it.N || TYPES[it.T] || `T${it.T}`;
        if (it.P != null) sel = `${sel} [${it.P}]`;
        out.push({ market: mn, selection: sel, odds: c });
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
    const mn = mk.marketType?.name || mk.name || `m${mk.id}`;
    for (const row of mk.row || []) {
      const spec = row?.specifier || {};
      const suf = spec.total ? ` [${spec.total}]` : (spec.hcp ? ` [${spec.hcp}]` : '');
      for (const p of row.prices || []) {
        const c = parseFloat(p.odds); if (isNaN(c) || c <= 1) continue;
        out.push({ market: `${mn}${suf}`, selection: String(p.name || p.displayName || '?'), odds: c });
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

// ─── Main ───
const catalogs = new Map();
for (const key of BOOKS) {
  const b = bookmakersByKey[key];
  if (!b) continue;
  try {
    const ms = await b.listMatches({ live: false, sport: 'football', horizonHours: 30 });
    catalogs.set(key, ms);
    console.log(`[${key}] ${ms.length} matchs`);
  } catch (e) { console.log(`[${key}] KO`); }
}
const entries = alignCatalogs(catalogs, { minBooks: 4, horizonMs: Date.now() + 72*3600*1000 });
entries.sort((a,b) => Object.keys(b.matches).length - Object.keys(a.matches).length);
// Cible un match précis via env (nom d'équipe), sinon le premier top
const target = process.env.TARGET_MATCH || '';
const entry = target
  ? entries.find(e => (e.ref.home + ' ' + e.ref.away).toLowerCase().includes(target.toLowerCase())) || entries[0]
  : entries[0];
if (!entry) { console.log('Aucun match commun'); process.exit(1); }
console.log(`\n▓ ${entry.ref.home} vs ${entry.ref.away}`);

const bookData = {};
for (const [book, m] of Object.entries(entry.matches)) {
  if (!EXT[book]) continue;
  const raw = await fetchRaw(book, m.id);
  if (!raw) { console.log(`  [${book}] KO`); bookData[book] = []; continue; }
  bookData[book] = EXT[book](raw);
  console.log(`  [${book}] ${bookData[book].length} outcomes`);
}

// Markdown : par marché groupé, avec cotes des 4 books cote a cote quand possible
mkdirSync('docs', { recursive: true });
let md = `# ${entry.ref.home} vs ${entry.ref.away}\n\n`;
md += `Généré ${new Date().toISOString()} — Kickoff ${entry.ref.start ? new Date(entry.ref.start).toISOString() : '?'}\n\n`;
md += `Books : ${Object.keys(bookData).join(', ')}\n\n---\n\n`;

for (const book of BOOKS) {
  const data = bookData[book] || [];
  if (data.length === 0) { md += `\n## ${book} — 0 outcomes (KO)\n`; continue; }
  const byMarket = new Map();
  for (const { market, selection, odds } of data) {
    if (!byMarket.has(market)) byMarket.set(market, []);
    byMarket.get(market).push({ selection, odds });
  }
  md += `\n## ${book} — ${byMarket.size} marchés / ${data.length} outcomes\n\n`;
  for (const [mn, sels] of [...byMarket.entries()].sort()) {
    md += `### ${mn}\n\n`;
    md += `| Sélection | Cote |\n|---|---:|\n`;
    for (const s of sels) md += `| ${s.selection.replace(/\|/g, '\\|')} | ${s.odds.toFixed(2)} |\n`;
    md += `\n`;
  }
}
writeFileSync('docs/single-match-dump.md', md);
console.log(`\ndocs/single-match-dump.md (${(md.length/1024).toFixed(0)} KB)`);
process.exit(0);
