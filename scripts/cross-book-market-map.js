#!/usr/bin/env node
// CARTOGRAPHIE CROSS-BOOK : pour un match populaire, dump tous les marchés
// de chaque book, groupe les marchés similaires cross-book (>=2 books),
// et affiche les gap de cotes exploitables sur des sélections opposées.
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';
import { bpFetchEvent } from '../src/bookmakers/betpawa/api.js';
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { FEED, COUNTRY, viaWorker } from '../src/bookmakers/xbet/api.js';
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const BOOKS = ['1xbet', '1win', 'congobet', 'betpawa'];

// Extracteurs
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

// ─── Classification par CATÉGORIE FONCTIONNELLE ────────────────────────────
// On regroupe les marchés sémantiquement identiques (peu importe leur nom brut).
// Chaque catégorie = ensemble de mots-clés + une fonction extract() qui retourne
// une clé canonique de la sélection (ex "over_2.5" ou "yes").
function categorize(market, selection) {
  const m = String(market).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const s = String(selection).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // 1. PENALTY dans le match
  if (/penalty|penalt/.test(m) && !/shootout|apres prolongation|penalty.*shootout|penalty.*award/.test(m)) {
    return { cat: 'PENALTY_MATCH', selKey: extractYesNo(s) };
  }
  // 2. Cartons rouges
  if (/red card|carton rouge/.test(m)) {
    return { cat: 'RED_CARD', selKey: extractYesNo(s) };
  }
  // 3. Cartons jaunes ou total cartons
  if (/carton jaune|yellow card|booking|total.*card|total.*carton/.test(m)) {
    return { cat: 'CARDS_TOTAL', selKey: extractOverUnder(s) || extractYesNo(s) };
  }
  // 4. Prolongations
  if (/prolongation|overtime|extra time/.test(m) && !/penalty/.test(m)) {
    return { cat: 'OVERTIME', selKey: extractYesNo(s) };
  }
  // 5. Penalty shootout
  if (/penalty.*shootout|penalty shootout|séance de penalty|penalt.*apres/.test(m)) {
    return { cat: 'PENALTY_SHOOTOUT', selKey: extractYesNo(s) };
  }
  // 6. Qualification
  if (/qualif|to qualify/.test(m) && !/type/.test(m)) {
    return { cat: 'QUALIFY', selKey: extractHomeAway(s) };
  }
  // 7. Corners total O/U
  if (/corner|coin/.test(m) && !/1st|1ere|first|handicap|result|race/.test(m)) {
    return { cat: 'CORNERS_TOTAL', selKey: extractOverUnder(s) };
  }
  // 8. Corners 1X2
  if (/corner.*result|corner.*1x2|corners.*result/.test(m)) {
    return { cat: 'CORNERS_1X2', selKey: extractHomeDrawAway(s) };
  }
  // 9. Race to N goals
  if (/race to \d+ goals|race to \d+/.test(m)) {
    return { cat: 'RACE_TO_N_GOALS', selKey: extractHomeAway(s) };
  }
  // 10. HT/FT
  if (/ht[\s\/]?ft|halftime.?fulltime|mi-temps.*fin de match|mt.?fin/.test(m) && !/correct score/.test(m)) {
    return { cat: 'HT_FT', selKey: extractHTFT(s) };
  }
  // 11. Score in Both Halves (both halves scored)
  if (/score in both halves|score.*both halves|marque.*chaque mi-temps|marque a chaque/.test(m)) {
    return { cat: 'SCORE_BOTH_HALVES', selKey: extractYesNo(s) };
  }
  // 12. Winning method (regular time / OT / Pens)
  if (/winning method|methode.*vict/.test(m)) {
    return { cat: 'WINNING_METHOD', selKey: s };
  }
  // 13. Résultat + Total (V1/V2 + TP/TM combined)
  if (/resultat.*nombre|1x2.*total|matchbet.*total|match.*total|result.*total|resultat.*ou.*nombre/.test(m)) {
    return { cat: 'RESULT_AND_TOTAL', selKey: extractResultTotal(s) };
  }
  // 14. DC + Total
  if (/double.*chance.*total|double.*chance.*nombre|dc.*total/.test(m)) {
    return { cat: 'DC_AND_TOTAL', selKey: extractDCTotal(s) };
  }
  // 15. Home team clean sheet
  if (/home.*clean sheet|clean sheet.*home|n'encaisse pas.*domicile/.test(m)) {
    return { cat: 'CLEAN_SHEET_HOME', selKey: extractYesNo(s) };
  }
  // 16. Away team clean sheet
  if (/away.*clean sheet|clean sheet.*away|n'encaisse pas.*ext/.test(m)) {
    return { cat: 'CLEAN_SHEET_AWAY', selKey: extractYesNo(s) };
  }
  // 17. Home win to nil
  if (/home.*win to nil|win to nil.*home|gagne sans encaisser.*(?:dom|home)/.test(m)) {
    return { cat: 'WIN_TO_NIL_HOME', selKey: extractYesNo(s) };
  }
  // 18. Away win to nil
  if (/away.*win to nil|win to nil.*away|gagne sans encaisser.*(?:ext|away)/.test(m)) {
    return { cat: 'WIN_TO_NIL_AWAY', selKey: extractYesNo(s) };
  }
  // 19. Odd/Even total buts
  if (/odd\s*\/\s*even|even\/odd|pair.*impair/.test(m) && !/home|away|team|equipe/.test(m)) {
    return { cat: 'ODD_EVEN_TOTAL', selKey: extractOddEven(s) };
  }
  // 20. Both teams to score both halves
  if (/both teams.*score.*halves|both halves.*score.*yes|marque.*chaque mi-temps.*deux|deux.*equipes.*chaque mi/.test(m)) {
    return { cat: 'BTTS_BOTH_HALVES', selKey: extractYesNo(s) };
  }
  // 21. Goal in time interval
  if (/intervalle.*temps|goal in interval|goalscored.*minute|but.*minutes|goal in.*minute/.test(m)) {
    return { cat: 'GOAL_INTERVAL', selKey: s };  // trop varié, on garde brut
  }

  return null;
}

function extractYesNo(s) {
  if (/^(yes|oui|y)$/.test(s.trim())) return 'YES';
  if (/^(no|non|n)$/.test(s.trim())) return 'NO';
  return null;
}
function extractOverUnder(s) {
  const ov = s.match(/(?:over|plus)\s*(?:de\s*)?(\d+(?:\.\d+)?)|>\s*(\d+(?:\.\d+)?)/);
  if (ov) return `OVER_${parseFloat(ov[1] || ov[2])}`;
  const un = s.match(/(?:under|moins)\s*(?:de\s*)?(\d+(?:\.\d+)?)|<\s*(\d+(?:\.\d+)?)/);
  if (un) return `UNDER_${parseFloat(un[1] || un[2])}`;
  return null;
}
function extractHomeAway(s) {
  if (/^(home|1|w1|dom)/.test(s.trim())) return 'HOME';
  if (/^(away|2|w2|ext)/.test(s.trim())) return 'AWAY';
  return null;
}
function extractHomeDrawAway(s) {
  if (/^(home|1|w1|dom)/.test(s.trim())) return 'HOME';
  if (/^(draw|x|nul)/.test(s.trim())) return 'DRAW';
  if (/^(away|2|w2|ext)/.test(s.trim())) return 'AWAY';
  return null;
}
function extractOddEven(s) {
  if (/odd|impair/.test(s)) return 'ODD';
  if (/even|pair/.test(s)) return 'EVEN';
  return null;
}
function extractHTFT(s) {
  // Format V1/V1, V1/V2, X/V1, 1/1, 1/X, 1/2, X/X, X/2, 2/1, 2/X, 2/2
  const clean = s.replace(/\s+/g, '').toLowerCase();
  const m = clean.match(/^(v?1|v?2|x|nul|home|away|draw)[\/\-](v?1|v?2|x|nul|home|away|draw)$/);
  if (!m) return null;
  const norm = (x) => {
    if (/^(v?1|home)$/.test(x)) return '1';
    if (/^(v?2|away)$/.test(x)) return '2';
    if (/^(x|nul|draw)$/.test(x)) return 'X';
    return x;
  };
  return `HT_FT_${norm(m[1])}_${norm(m[2])}`;
}
function extractResultTotal(s) {
  const clean = s.replace(/\s+/g, '').toLowerCase();
  // ex: "1/over2.5", "V1EtTP2.5-Oui", "1&plus2.5"
  // simple : chercher side + total
  const side = /^(v?1|home|1|dom)/i.test(clean) ? '1'
    : /^(v?2|home|2|ext)/i.test(clean) ? '2'
    : /^(x|nul|draw)/i.test(clean) ? 'X'
    : null;
  const ou = clean.match(/(over|plus|tp|>)[\d\.]*?(\d+(?:\.\d+)?)|(under|moins|tm|<)[\d\.]*?(\d+(?:\.\d+)?)/);
  const yes = /oui|yes/i.test(clean);
  const no = /non|no/i.test(clean);
  if (!side) return null;
  if (ou) {
    const isOver = ou[1] != null;
    const line = parseFloat(ou[2] || ou[4]);
    return `RT_${side}_${isOver ? 'OVER' : 'UNDER'}_${line}${yes ? '_YES' : no ? '_NO' : ''}`;
  }
  return null;
}
function extractDCTotal(s) {
  const clean = s.replace(/\s+/g, '').toLowerCase();
  const side = clean.match(/^(1x|x2|12)/);
  if (!side) return null;
  const ou = clean.match(/(over|plus|>)[\d\.]*?(\d+(?:\.\d+)?)|(under|moins|<)[\d\.]*?(\d+(?:\.\d+)?)/);
  if (!ou) return null;
  const isOver = ou[1] != null;
  const line = parseFloat(ou[2] || ou[4]);
  return `DCT_${side[1].toUpperCase()}_${isOver ? 'OVER' : 'UNDER'}_${line}`;
}

// ─── Main ───
const target = process.env.TARGET_MATCH || '';
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
const entry = target
  ? entries.find(e => (e.ref.home + ' ' + e.ref.away).toLowerCase().includes(target.toLowerCase())) || entries[0]
  : entries[0];
console.log(`\n▓ ${entry.ref.home} vs ${entry.ref.away} (${entry.ref.league || '?'})`);

const bookMatches = Object.entries(entry.matches).filter(([b]) => EXT[b]);
const rawResults = await Promise.all(bookMatches.map(async ([book, m]) => {
  try { return { book, raw: await fetchRaw(book, m.id) }; } catch { return { book, raw: null }; }
}));

// { cat: { selKey: { book: {market, selection, odds} } } }
const cartography = {};
const nonCategorized = new Set();
for (const { book, raw } of rawResults) {
  if (!raw) { console.log(`  [${book}] KO`); continue; }
  const outs = EXT[book](raw);
  let cats = 0, uncats = 0;
  for (const { market, selection, odds } of outs) {
    if (odds >= 40) continue;
    const cls = categorize(market, selection);
    if (!cls || !cls.selKey) { uncats++; continue; }
    cats++;
    if (!cartography[cls.cat]) cartography[cls.cat] = {};
    if (!cartography[cls.cat][cls.selKey]) cartography[cls.cat][cls.selKey] = {};
    // Garde la MEILLEURE cote par book+cat+selKey
    const prev = cartography[cls.cat][cls.selKey][book];
    if (!prev || odds > prev.odds) {
      cartography[cls.cat][cls.selKey][book] = { market, selection, odds };
    }
  }
  console.log(`  [${book}] ${outs.length} outcomes → ${cats} catégorisés`);
}

// Cherche paires opposées pour arbs 2-way
const OPPOSITES = { 'YES': 'NO', 'NO': 'YES' };
function areOpposites(k1, k2) {
  if (OPPOSITES[k1] === k2) return true;
  const m1 = k1.match(/^OVER_(.+)$/); const m2 = k2.match(/^UNDER_(.+)$/);
  if (m1 && m2 && m1[1] === m2[1]) return true;
  const m3 = k1.match(/^UNDER_(.+)$/); const m4 = k2.match(/^OVER_(.+)$/);
  if (m3 && m4 && m3[1] === m4[1]) return true;
  if ((k1 === 'ODD' && k2 === 'EVEN') || (k1 === 'EVEN' && k2 === 'ODD')) return true;
  return false;
}

// Rapport
let md = `# Cartographie cross-book — ${entry.ref.home} vs ${entry.ref.away}\n\n`;
md += `Ligue: ${entry.ref.league || '?'}\nKickoff: ${entry.ref.start ? new Date(entry.ref.start).toISOString() : '?'}\nGénéré: ${new Date().toISOString()}\n\n`;

// Compte les catégories présentes chez ≥2 books
md += `## Résumé\n\n`;
md += `| Catégorie | Books qui la proposent | Nb sélections |\n|---|---|---:|\n`;
const catStats = [];
for (const [cat, sels] of Object.entries(cartography)) {
  const books = new Set();
  for (const sk of Object.values(sels)) for (const b of Object.keys(sk)) books.add(b);
  catStats.push({ cat, books: [...books].sort(), nSel: Object.keys(sels).length });
}
catStats.sort((a,b) => b.books.length - a.books.length);
for (const s of catStats) {
  md += `| **${s.cat}** | ${s.books.join(', ')} (${s.books.length}) | ${s.nSel} |\n`;
}

// Détails catégorie par catégorie (>= 2 books)
md += `\n\n## Détails par catégorie (≥ 2 books)\n\n`;
const arbs2Way = [];
for (const s of catStats) {
  if (s.books.length < 2) continue;
  const sels = cartography[s.cat];
  md += `\n### ${s.cat}\n\n`;
  md += `| Sélection | ${s.books.map(b => b + ' cote').join(' | ')} |\n|---|${s.books.map(() => '---').join('|')}|\n`;
  for (const [selKey, byBook] of Object.entries(sels)) {
    const cols = s.books.map(b => byBook[b] ? `${byBook[b].odds.toFixed(2)} (${String(byBook[b].selection).slice(0,20)})` : '—');
    md += `| \`${selKey}\` | ${cols.join(' | ')} |\n`;
  }
  // Détection arbs 2-way : paires opposées
  const selKeys = Object.keys(sels);
  for (let i = 0; i < selKeys.length; i++) {
    for (let j = i + 1; j < selKeys.length; j++) {
      const k1 = selKeys[i]; const k2 = selKeys[j];
      if (!areOpposites(k1, k2)) continue;
      // Meilleure cote pour k1 et pour k2, chez books différents
      let best1 = null, best2 = null;
      for (const [b, v] of Object.entries(sels[k1])) if (!best1 || v.odds > best1.odds) best1 = { book: b, ...v };
      for (const [b, v] of Object.entries(sels[k2])) if (!best2 || v.odds > best2.odds) best2 = { book: b, ...v };
      if (!best1 || !best2 || best1.book === best2.book) continue;
      const sumInv = 1/best1.odds + 1/best2.odds;
      if (sumInv < 1) {
        arbs2Way.push({ cat: s.cat, k1, k2, best1, best2, profit: 1 - sumInv });
      } else if (sumInv < 1.05) {
        // near-miss
        arbs2Way.push({ cat: s.cat, k1, k2, best1, best2, profit: 1 - sumInv, nearMiss: true });
      }
    }
  }
}

arbs2Way.sort((a,b) => b.profit - a.profit);
md += `\n\n## Arbs 2-way trouvés (profit > 0)\n\n`;
const realArbs = arbs2Way.filter(a => !a.nearMiss);
if (realArbs.length === 0) {
  md += `Aucun arb 2-way avec les sélections opposées.\n`;
} else {
  md += `| # | Profit | Cat | Book A | Cote A | Book B | Cote B |\n|:-:|---:|---|---|---:|---|---:|\n`;
  for (const [i, a] of realArbs.slice(0, 20).entries()) {
    md += `| ${i+1} | **${(a.profit*100).toFixed(2)}%** | ${a.cat} | ${a.best1.book} (${a.k1}) | ${a.best1.odds.toFixed(2)} | ${a.best2.book} (${a.k2}) | ${a.best2.odds.toFixed(2)} |\n`;
  }
}
md += `\n\n## Near-misses (marge < 5%)\n\n`;
const near = arbs2Way.filter(a => a.nearMiss).slice(0, 30);
if (near.length === 0) md += `Aucun.\n`;
else {
  md += `| Cat | Book A | Cote A | Book B | Cote B | Marge |\n|---|---|---:|---|---:|---:|\n`;
  for (const a of near) md += `| ${a.cat} | ${a.best1.book} (${a.k1}) | ${a.best1.odds.toFixed(2)} | ${a.best2.book} (${a.k2}) | ${a.best2.odds.toFixed(2)} | ${(-a.profit*100).toFixed(2)}% |\n`;
}

mkdirSync('docs', { recursive: true });
writeFileSync('docs/cross-book-market-map.md', md);
console.log(`\n═══ RESULTATS ═══`);
console.log(`Catégories trouvées : ${catStats.length}`);
console.log(`Catégories chez ≥ 2 books : ${catStats.filter(s => s.books.length >= 2).length}`);
console.log(`Arbs 2-way : ${realArbs.length}`);
console.log(`Near-misses (marge <5%) : ${arbs2Way.filter(a => a.nearMiss).length}`);
console.log(`Fichier : docs/cross-book-market-map.md`);
process.exit(0);
