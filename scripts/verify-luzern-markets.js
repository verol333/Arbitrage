#!/usr/bin/env node
// VERIFICATION : identifie EXACTEMENT comment chaque book expose les 3 marchés
// du pattern Luzern (Double Chance X2, Handicap Européen 1 (0:1), Handicap Européen X (0:1))
// sur un GRAND match.
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';
import { bpFetchEvent } from '../src/bookmakers/betpawa/api.js';
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { FEED, COUNTRY, viaWorker } from '../src/bookmakers/xbet/api.js';
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const BOOKS = ['1xbet', '1win', 'congobet', 'betpawa'];
const TARGET = process.env.TARGET_MATCH || ''; // recherche substring

async function extractBetpawa(matchId) {
  const raw = await bpFetchEvent(matchId, 15_000).catch(() => null);
  if (!raw) return [];
  const out = [];
  for (const mk of raw?.markets || []) {
    const name = mk.marketType?.name || mk.name || '';
    if (!/handicap|double chance/i.test(name)) continue;
    for (const row of mk.row || []) {
      const spec = row?.specifier || {};
      const suf = spec.total ? ` [${spec.total}]` : (spec.hcp ? ` [${spec.hcp}]` : '');
      for (const p of row.prices || []) {
        const c = parseFloat(p.odds);
        if (isNaN(c) || c <= 1) continue;
        out.push({ market: `${name}${suf}`, selection: p.name || p.displayName, odds: c });
      }
    }
  }
  return out;
}
async function extractCongobet(matchId) {
  const raw = await congoJson(`${CONGO_API}events/${matchId}`).catch(() => null);
  if (!raw) return [];
  const out = [];
  for (const bt of raw?.eventBetTypes || []) {
    const name = bt.name || '';
    if (!/handicap|double chance/i.test(name)) continue;
    for (const it of bt.eventBetTypeItems || []) {
      const c = parseFloat(it.odds);
      if (isNaN(c) || c <= 1) continue;
      out.push({ market: name, selection: it.shortName || it.name, odds: c });
    }
  }
  return out;
}
async function extract1xbet(matchId) {
  const url = `${FEED}/service-api/LineFeed/GetGameZip?id=${matchId}&lng=fr&isSubGames=true&GroupEvents=true&countevents=2000&grMode=4&country=${COUNTRY}&marketType=1&isNewBuilder=true`;
  const raw = await viaWorker(url).catch(() => null);
  if (!raw) return [];
  const out = [];
  const MAP = { 2: 'Handicap', 8: 'Double Chance', 237: 'Asian Handicap', 1845: 'European Handicap', 62: 'Team 2 Total', 15: 'Team 1 Total' };
  for (const ge of raw?.Value?.GE || []) {
    const gname = MAP[ge.G] || ge.GN || `G${ge.G}`;
    if (!/handicap|double chance|european/i.test(gname)) continue;
    for (const sub of ge.E || []) {
      for (const it of (Array.isArray(sub) ? sub : [sub])) {
        if (it?.C == null) continue;
        const c = parseFloat(it.C);
        if (isNaN(c) || c <= 1) continue;
        let sel = it.N || `T${it.T}`;
        if (it.P != null) sel = `${sel} [${it.P}]`;
        out.push({ market: `${gname} (G=${ge.G})`, selection: sel, odds: c });
      }
    }
  }
  // Aussi dump les subgames avec "handicap" dans PN
  for (const sg of raw?.Value?.SG || []) {
    const pn = sg.PN || '';
    if (!/handicap|european/i.test(pn)) continue;
    out.push({ market: `SUBGAME: ${pn} (I=${sg.I})`, selection: '(voir sous-marchés)', odds: 0 });
  }
  return out;
}
async function extract1win(matchId) {
  const raw = await fetchOddsWS([matchId], { timeoutMs: 20000, quietMs: 3000 }).catch(() => new Map());
  const data = raw.get(matchId) || raw.get(String(matchId)) || {};
  const out = [];
  for (const [groupName, oddsList] of Object.entries(data || {})) {
    if (!/handicap|double chance|european/i.test(groupName)) continue;
    for (const o of oddsList || []) {
      if (!o || o.status !== 1) continue;
      const c = Number(o.cf);
      if (isNaN(c) || c <= 1) continue;
      out.push({ market: groupName, selection: o.name, odds: c });
    }
  }
  return out;
}

const EXT = { betpawa: extractBetpawa, congobet: extractCongobet, '1xbet': extract1xbet, '1win': extract1win };

// ─── Main ───
const catalogs = new Map();
for (const key of BOOKS) {
  const b = bookmakersByKey[key]; if (!b) continue;
  try {
    const ms = await b.listMatches({ live: false, sport: 'football', horizonHours: 72 });
    catalogs.set(key, ms);
    console.log(`[${key}] ${ms.length} matchs`);
  } catch (e) { console.log(`[${key}] KO`); }
}
const entries = alignCatalogs(catalogs, { minBooks: 4, horizonMs: Date.now() + 72*3600*1000 });
entries.sort((a,b) => Object.keys(b.matches).length - Object.keys(a.matches).length);
const entry = TARGET
  ? entries.find(e => (e.ref.home + ' ' + e.ref.away).toLowerCase().includes(TARGET.toLowerCase())) || entries[0]
  : entries[0];
console.log(`\n▓ ${entry.ref.home} vs ${entry.ref.away} (${entry.ref.league || '?'})`);

const bookData = {};
for (const [book, m] of Object.entries(entry.matches)) {
  if (!EXT[book]) continue;
  bookData[book] = await EXT[book](m.id);
  console.log(`  [${book}] ${bookData[book].length} outcomes handicap/DC`);
}

// Rapport
let md = `# Vérification des marchés Luzern pattern\n\n**Match** : ${entry.ref.home} vs ${entry.ref.away}\n**Ligue** : ${entry.ref.league || '?'}\n**Kickoff** : ${entry.ref.start ? new Date(entry.ref.start).toISOString() : '?'}\n\nGénéré: ${new Date().toISOString()}\n\n`;
md += `## Objectif\n\nIdentifier chez CHAQUE bookmaker les 3 sélections du pattern :\n\n`;
md += `- **SLOT A** : Double Chance X2 (Draw ∪ Away wins)\n`;
md += `- **SLOT B** : Handicap Européen 1 (0:1) = Home wins by 2+ (aussi : Handicap 1X2 [-1] "1" = même chose)\n`;
md += `- **SLOT C** : Handicap Européen X (0:1) = Home wins by exactly 1 (aussi : Handicap 1X2 [-1] "X" = même chose)\n\n`;
md += `---\n\n`;

for (const book of BOOKS) {
  const data = bookData[book] || [];
  md += `## ${book.toUpperCase()} — ${data.length} outcomes\n\n`;
  if (data.length === 0) {
    md += `⚠️ Aucun outcome de type Handicap ou Double Chance récupéré.\n\n`;
    continue;
  }
  // Groupe par nom de marché
  const groups = {};
  for (const { market, selection, odds } of data) {
    if (!groups[market]) groups[market] = [];
    groups[market].push({ selection, odds });
  }
  for (const [m, sels] of Object.entries(groups)) {
    md += `### ${m}\n\n`;
    md += `| Sélection | Cote |\n|---|---:|\n`;
    for (const s of sels) md += `| \`${s.selection}\` | ${s.odds ? s.odds.toFixed(2) : '—'} |\n`;
    md += `\n`;
  }
  md += `---\n\n`;
}

mkdirSync('docs', { recursive: true });
writeFileSync('docs/verify-luzern-markets.md', md);
console.log('\n docs/verify-luzern-markets.md');
process.exit(0);
