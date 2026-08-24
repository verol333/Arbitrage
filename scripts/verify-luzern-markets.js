#!/usr/bin/env node
// VERIFICATION : cherche un match par nom d'equipe SUR CHAQUE BOOK independamment,
// puis dump TOUS les marches Handicap / Double Chance / European pour ce match.
// Objectif : identifier exactement ou chaque book expose les 3 slots Luzern.
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { bpFetchEvent } from '../src/bookmakers/betpawa/api.js';
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { FEED, COUNTRY, viaWorker } from '../src/bookmakers/xbet/api.js';
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const BOOKS = ['1xbet', '1win', 'congobet', 'betpawa'];
const TARGET = (process.env.TARGET_MATCH || 'fulham').toLowerCase();

async function extractBetpawa(matchId) {
  const raw = await bpFetchEvent(matchId, 15_000).catch(() => null);
  if (!raw) return [];
  const out = [];
  for (const mk of raw?.markets || []) {
    const name = mk.marketType?.name || mk.name || '';
    if (!/handicap|double chance|european/i.test(name)) continue;
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
    if (!/handicap|double chance|europ/i.test(name)) continue;
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
  let raw = null;
  for (let i = 0; i < 3 && !raw; i++) {
    raw = await viaWorker(url).catch(() => null);
    if (!raw) await new Promise(r => setTimeout(r, 1500));
  }
  if (!raw) return [];
  const out = [];
  // Dump TOUS les groupes contenant handicap/double chance/europ dans GN
  for (const ge of raw?.Value?.GE || []) {
    const gname = ge.GN || `G${ge.G}`;
    if (!/handicap|double chance|europ/i.test(gname)) continue;
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
  // Sous-jeux (SG)
  for (const sg of raw?.Value?.SG || []) {
    const pn = sg.PN || '';
    if (!/handicap|europ/i.test(pn)) continue;
    out.push({ market: `SUBGAME (SG.I=${sg.I}, SG.G=${sg.G})`, selection: pn, odds: 0 });
  }
  return out;
}
async function extract1win(matchId) {
  const raw = await fetchOddsWS([matchId], { timeoutMs: 25000, quietMs: 4000 }).catch(() => new Map());
  const data = raw.get(matchId) || raw.get(String(matchId)) || raw.get(Number(matchId)) || {};
  const out = [];
  for (const [groupName, oddsList] of Object.entries(data || {})) {
    if (!/handicap|double chance|europ/i.test(groupName)) continue;
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

// ─── Main : cherche independamment chez chaque book ───
const found = {};
for (const key of BOOKS) {
  const b = bookmakersByKey[key]; if (!b) { console.log(`[${key}] absent`); continue; }
  try {
    const ms = await b.listMatches({ live: false, sport: 'football', horizonHours: 168 });
    const hit = ms.find(m => (m.home + ' ' + m.away).toLowerCase().includes(TARGET));
    if (!hit) { console.log(`[${key}] ${TARGET} introuvable (${ms.length} matchs)`); continue; }
    found[key] = hit;
    console.log(`[${key}] ${hit.home} vs ${hit.away} id=${hit.id}`);
  } catch (e) { console.log(`[${key}] listMatches KO: ${e.message}`); }
}

const bookData = {};
for (const [book, m] of Object.entries(found)) {
  bookData[book] = await EXT[book](m.id);
  console.log(`  [${book}] ${bookData[book].length} outcomes handicap/DC/europ`);
}

// Rapport
let md = `# Verification marches Luzern pattern (recherche ${TARGET})\n\n`;
md += `Genere: ${new Date().toISOString()}\n\n`;
md += `## Objectif\n\n`;
md += `- SLOT A : Double Chance X2 (Draw union Away)\n`;
md += `- SLOT B : Handicap Europeen 1 (0:1) = Home wins by 2+\n`;
md += `- SLOT C : Handicap Europeen X (0:1) = Home wins by exactly 1\n\n`;
md += `---\n\n`;

for (const book of BOOKS) {
  const hit = found[book];
  const data = bookData[book] || [];
  md += `## ${book.toUpperCase()}`;
  if (hit) md += ` - ${hit.home} vs ${hit.away} (id=${hit.id})`;
  md += ` - ${data.length} outcomes\n\n`;
  if (!hit) { md += `Match introuvable\n\n---\n\n`; continue; }
  if (data.length === 0) { md += `Aucun outcome handicap/DC/europ recupere\n\n---\n\n`; continue; }
  const groups = {};
  for (const { market, selection, odds } of data) {
    if (!groups[market]) groups[market] = [];
    groups[market].push({ selection, odds });
  }
  for (const [m, sels] of Object.entries(groups)) {
    md += `### ${m}\n\n| Selection | Cote |\n|---|---:|\n`;
    for (const s of sels) md += `| \`${s.selection}\` | ${s.odds ? s.odds.toFixed(2) : '-'} |\n`;
    md += `\n`;
  }
  md += `---\n\n`;
}

mkdirSync('docs', { recursive: true });
writeFileSync('docs/verify-luzern-markets.md', md);
console.log('\n docs/verify-luzern-markets.md');
process.exit(0);
