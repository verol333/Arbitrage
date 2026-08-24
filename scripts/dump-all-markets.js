#!/usr/bin/env node
// Dump TOUS les marches d'un match sur chaque book (sans filtre)
// pour identifier les noms exacts de chaque marche utile.
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { bpFetchEvent } from '../src/bookmakers/betpawa/api.js';
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { FEED, COUNTRY, viaWorker } from '../src/bookmakers/xbet/api.js';
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const BOOKS = ['1xbet', '1win', 'congobet', 'betpawa'];
const TARGET = (process.env.TARGET_MATCH || 'fulham').toLowerCase();

async function dumpBetpawa(matchId) {
  const raw = await bpFetchEvent(matchId, 20_000).catch(e => { console.log('  BP err:', e.message); return null; });
  if (!raw) return {};
  const groups = {};
  for (const mk of raw?.markets || []) {
    const name = mk.marketType?.name || mk.name || 'UNKNOWN';
    if (!groups[name]) groups[name] = [];
    for (const row of mk.row || []) {
      const spec = row?.specifier || {};
      const suf = spec.total ? ` [${spec.total}]` : (spec.hcp ? ` [${spec.hcp}]` : '');
      for (const p of row.prices || []) {
        const c = parseFloat(p.odds);
        if (isNaN(c) || c <= 1) continue;
        groups[name].push({ sel: `${p.name || p.displayName}${suf}`, odds: c });
      }
    }
  }
  return groups;
}

async function dumpCongobet(matchId) {
  const raw = await congoJson(`${CONGO_API}events/${matchId}`).catch(e => { console.log('  CG err:', e.message); return null; });
  if (!raw) return {};
  const groups = {};
  for (const bt of raw?.eventBetTypes || []) {
    const name = bt.name || 'UNKNOWN';
    if (!groups[name]) groups[name] = [];
    for (const it of bt.eventBetTypeItems || []) {
      const c = parseFloat(it.odds);
      if (isNaN(c) || c <= 1) continue;
      groups[name].push({ sel: it.shortName || it.name, odds: c });
    }
  }
  return groups;
}

async function dump1xbet(matchId) {
  const url = `${FEED}/service-api/LineFeed/GetGameZip?id=${matchId}&lng=fr&isSubGames=true&GroupEvents=true&countevents=2500&grMode=4&country=${COUNTRY}&marketType=1&isNewBuilder=true`;
  let raw = null;
  for (let i = 0; i < 3 && !raw; i++) {
    raw = await viaWorker(url).catch(() => null);
    if (!raw) await new Promise(r => setTimeout(r, 2000));
  }
  if (!raw) return {};
  const groups = {};
  for (const ge of raw?.Value?.GE || []) {
    const gname = ge.GN || `G${ge.G}`;
    const label = `${gname} (G=${ge.G})`;
    if (!groups[label]) groups[label] = [];
    for (const sub of ge.E || []) {
      for (const it of (Array.isArray(sub) ? sub : [sub])) {
        if (it?.C == null) continue;
        const c = parseFloat(it.C);
        if (isNaN(c) || c <= 1) continue;
        let sel = it.N || `T${it.T}`;
        if (it.P != null) sel = `${sel} [${it.P}]`;
        groups[label].push({ sel, odds: c, T: it.T });
      }
    }
  }
  return groups;
}

async function dump1win(matchId) {
  const raw = await fetchOddsWS([matchId], { timeoutMs: 25000, quietMs: 4000 }).catch(() => new Map());
  const data = raw.get(matchId) || raw.get(String(matchId)) || raw.get(Number(matchId)) || {};
  const groups = {};
  for (const [groupName, oddsList] of Object.entries(data || {})) {
    if (!groups[groupName]) groups[groupName] = [];
    for (const o of oddsList || []) {
      if (!o || o.status !== 1) continue;
      const c = Number(o.cf);
      if (isNaN(c) || c <= 1) continue;
      groups[groupName].push({ sel: o.name, odds: c });
    }
  }
  return groups;
}

const DUMP = { betpawa: dumpBetpawa, congobet: dumpCongobet, '1xbet': dump1xbet, '1win': dump1win };

// ─── Main ───
const found = {};
for (const key of BOOKS) {
  const b = bookmakersByKey[key]; if (!b) continue;
  try {
    const ms = await b.listMatches({ live: false, sport: 'football', horizonHours: 168 });
    const hit = ms.find(m => (m.home + ' ' + m.away).toLowerCase().includes(TARGET));
    if (!hit) { console.log(`[${key}] "${TARGET}" introuvable (${ms.length} matchs)`); continue; }
    found[key] = hit;
    console.log(`[${key}] ${hit.home} vs ${hit.away} id=${hit.id}`);
  } catch (e) { console.log(`[${key}] KO: ${e.message}`); }
}

const allData = {};
for (const [book, m] of Object.entries(found)) {
  allData[book] = await DUMP[book](m.id);
  const nMarkets = Object.keys(allData[book]).length;
  const nOutcomes = Object.values(allData[book]).reduce((s, a) => s + a.length, 0);
  console.log(`  [${book}] ${nMarkets} marches, ${nOutcomes} outcomes`);
}

// Rapport complet
let md = `# Dump complet marches — recherche "${TARGET}"\n\nGenere: ${new Date().toISOString()}\n\n`;

// Pour chaque book, lister TOUS les noms de marches (sans les outcomes pour garder court)
// puis lister en detail les marches qui nous interessent
const INTEREST = /score.*(exact|correct)|over.*under|total.*but|total.*goal|under|over|win.*nil|clean.sheet|btts|both.*team.*score|double.*chance|handicap|europ|impair|pair|odd.*even|1.re.*mi|first.*half|1st.*half|premier.*but|first.*goal|equipe.*marque|team.*score|nombre.*but|exact.*goal/i;

for (const book of BOOKS) {
  const data = allData[book] || {};
  const hit = found[book];
  md += `## ${book.toUpperCase()}`;
  if (hit) md += ` — ${hit.home} vs ${hit.away} (id=${hit.id})`;
  md += `\n\n`;

  if (!hit || Object.keys(data).length === 0) {
    md += `Aucune donnee\n\n---\n\n`;
    continue;
  }

  // Index de tous les noms de marches
  const names = Object.keys(data).sort();
  md += `### Index des ${names.length} marches\n\n`;
  for (const n of names) {
    const flag = INTEREST.test(n) ? ' **<<<**' : '';
    md += `- \`${n}\` (${data[n].length} sel)${flag}\n`;
  }
  md += `\n`;

  // Detail des marches qui nous interessent
  md += `### Detail marches pertinents\n\n`;
  for (const n of names) {
    if (!INTEREST.test(n)) continue;
    md += `#### ${n}\n\n| Selection | Cote |\n|---|---:|\n`;
    for (const s of data[n].slice(0, 30)) {
      md += `| \`${s.sel}\` | ${s.odds.toFixed(2)} |\n`;
    }
    if (data[n].length > 30) md += `| ... +${data[n].length - 30} | |\n`;
    md += `\n`;
  }
  md += `---\n\n`;
}

mkdirSync('docs', { recursive: true });
writeFileSync('docs/dump-all-markets.md', md);
console.log('\ndocs/dump-all-markets.md');
process.exit(0);
