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
// Categorisation STRICTE : chaque catégorie décrit exactement une même sémantique.
// Si un marché mentionne une équipe (nom ou home/away), on distingue par équipe.
function categorize(market, selection, homeTeam, awayTeam) {
  const m = String(market).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const s = String(selection).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const homeN = homeTeam ? homeTeam.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') : '';
  const awayN = awayTeam ? awayTeam.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') : '';
  // Exclut les mots génériques (team, club, united, real, city, fc, sc, etc.)
  const STOPWORDS = new Set(['team','club','united','city','real','fc','ac','sc','cf','ca','cd','ec','sp','fk','sv','sk','fv','tsg','vfb','vfl','vff','1899','borussia','sporting','athletic','atletico','deportivo','deportes','olympique','olympiacos','2000','sport','sports','club','football','fussball']);
  const homeWords = homeN.split(/\s+/).filter(w => w.length >= 5 && !STOPWORDS.has(w));
  const awayWords = awayN.split(/\s+/).filter(w => w.length >= 5 && !STOPWORDS.has(w));
  const mentionsHome = homeWords.length > 0 && homeWords.some(w => m.includes(w));
  const mentionsAway = awayWords.length > 0 && awayWords.some(w => m.includes(w));
  const isHomeSide = /home|domicile|team\s*1|1ere\s*equipe/.test(m) || (mentionsHome && !mentionsAway);
  const isAwaySide = /away|ext[eé]rieur|team\s*2|2eme\s*equipe/.test(m) || (mentionsAway && !mentionsHome);

  // ─── SKIP 1ère/2ème mi-temps standalone (pas fin de match) ───
  if (/^1ere mi-temps|^2eme mi-temps|^1st half\b|^2nd half\b|- 1h\b|- 2h\b|halftime\/fulltime|correct score.*halftime/.test(m)) return null;
  // ─── SKIP marchés combinés OR (X gagne ou Y) — sémantique différente ───
  if (/\bgagne ou\b|\bwin or\b|\s ou (?:les|au moins)/.test(m)) return null;
  // ─── SKIP marchés partiels de mi-temps (1ère MT / 2ème MT au-dedans) ───
  if (/en 1ere mi-temps|en 2eme mi-temps|in 1st half|in 2nd half|1ere periode|2eme periode/.test(m)) return null;

  // 1. PENALTY dans le match (marqué / manqué)
  if (/(penalty|penalt).*(match|dans le match)|penalty.*award|will.*penalty|penalty.*manque/.test(m) && !/shootout|apres prolongation|penalty.*shootout/.test(m)) {
    return { cat: 'PENALTY_MATCH', selKey: extractYesNo(s) };
  }
  // 2. Carton rouge dans le match
  if (/red card|carton rouge/.test(m) && !/away|home|team\s*[12]|equipe/.test(m)) {
    return { cat: 'RED_CARD_MATCH', selKey: extractYesNo(s) };
  }
  // 3. Prolongations
  if (/prolongation|overtime|extra time|will.*overtime/.test(m) && !/penalty/.test(m)) {
    return { cat: 'OVERTIME_MATCH', selKey: extractYesNo(s) };
  }
  // 4. Penalty shootout
  if (/penalty.*shootout|penalty shootout|seance de penalty|penalt.*apres/.test(m)) {
    return { cat: 'PENALTY_SHOOTOUT', selKey: extractYesNo(s) };
  }
  // 5. Qualification (souvent ambigu, on garde brut)
  if (/^qualif|^to qualify|will.*qualify/.test(m) && !/type/.test(m)) {
    return { cat: 'QUALIFY_TEAM', selKey: extractHomeAway(s) };
  }

  // 6. Corners total match (Over/Under)
  if (/(corner|coin)/.test(m) && /(over\/under|total|nombre|number of)/.test(m)
      && !/1st|1ere|first|1h|home|away|team|equipe/.test(m)) {
    const line = extractOverUnder(s);
    if (line) return { cat: 'CORNERS_TOTAL_MATCH', selKey: line };
  }

  // 7. Corners 1X2 (qui aura le plus)
  if (/corner.*(result|1x2)|corners.*result|plus de corners/.test(m)) {
    return { cat: 'CORNERS_MATCH_1X2', selKey: extractHomeDrawAway(s) };
  }

  // 8. HT/FT (mi-temps / fin de match)
  if (/^ht.?ft$|halftime.?fulltime|mt.?fin|mi-temps \/ fin de match|resultat mi-temps.*fin/.test(m) && !/correct score|nombre exact|nombre de buts/.test(m)) {
    const k = extractHTFT(s);
    if (k) return { cat: 'HT_FT', selKey: k };
  }

  // 9-11. Score in both halves : IMPORTANT — d'abord vérifier "both teams"
  //  (marché des 2 équipes, ne pas confondre avec home/away seul)
  if (/both teams.*score.*halves|both halves.*both teams|deux equipes marquent.*chaque mi|les deux equipes marquent lors de chaque/.test(m)) {
    return { cat: 'BTTS_BOTH_HALVES', selKey: extractYesNo(s) };
  }
  // Score in both halves - HOME (uniquement UNE équipe)
  if ((/score in both halves.*home|home.*score.*both halves/.test(m) ||
       (mentionsHome && !mentionsAway && /marque.*chaque mi-temps|score in both halves/.test(m)))
      && !/both teams|deux equipes|les 2 equipes/.test(m)) {
    return { cat: 'SCORE_BOTH_HALVES_HOME', selKey: extractYesNo(s) };
  }
  // Score in both halves - AWAY
  if ((/score in both halves.*away|away.*score.*both halves/.test(m) ||
       (mentionsAway && !mentionsHome && /marque.*chaque mi-temps|score in both halves/.test(m)))
      && !/both teams|deux equipes|les 2 equipes/.test(m)) {
    return { cat: 'SCORE_BOTH_HALVES_AWAY', selKey: extractYesNo(s) };
  }

  // 12. Résultat + Total (V1/V2 + TP/TM combined)
  if (/resultat du match et nombre de buts|1x2 and totals|matchbet and totals|result and total|1x2.*over\/under|1x2.*totals/.test(m)) {
    const k = extractResultTotal(s, m);
    if (k) return { cat: 'RESULT_AND_TOTAL', selKey: k };
  }
  // 13. DC + Total
  if (/double chance et nombre de buts|double chance and totals|dc.*total|dc.*nombre/.test(m)) {
    const k = extractDCTotal(s, m);
    if (k) return { cat: 'DC_AND_TOTAL', selKey: k };
  }
  // 14. Résultat + BTTS
  if (/resultat du match et les deux equipes marquent|result and both teams to score|1x2 and both teams to score|matchbet.*btts/.test(m)) {
    const k = extractResultBTTS(s);
    if (k) return { cat: 'RESULT_AND_BTTS', selKey: k };
  }
  // 15. DC + BTTS
  if (/double chance et les deux equipes marquent|double chance and both teams to score|dc.*btts/.test(m)) {
    const k = extractDCBTTS(s);
    if (k) return { cat: 'DC_AND_BTTS', selKey: k };
  }

  // 16. Clean Sheet HOME (equipe home ne concede pas)
  if (/(clean sheet).*(home|team\s*1)|home.*(clean sheet)/.test(m) ||
      (mentionsHome && !mentionsAway && /n'encaisse pas de but|clean sheet/.test(m))) {
    return { cat: 'CLEAN_SHEET_HOME', selKey: extractYesNo(s) };
  }
  // 17. Clean Sheet AWAY
  if (/(clean sheet).*(away|team\s*2)|away.*(clean sheet)/.test(m) ||
      (mentionsAway && !mentionsHome && /n'encaisse pas de but|clean sheet/.test(m))) {
    return { cat: 'CLEAN_SHEET_AWAY', selKey: extractYesNo(s) };
  }
  // 18. Win to Nil HOME
  if (/win to nil.*(home|team\s*1)|(home|team\s*1).*win to nil/.test(m) ||
      (mentionsHome && !mentionsAway && /gagne sans encaisser/.test(m))) {
    return { cat: 'WIN_TO_NIL_HOME', selKey: extractYesNo(s) };
  }
  // 19. Win to Nil AWAY
  if (/win to nil.*(away|team\s*2)|(away|team\s*2).*win to nil/.test(m) ||
      (mentionsAway && !mentionsHome && /gagne sans encaisser/.test(m))) {
    return { cat: 'WIN_TO_NIL_AWAY', selKey: extractYesNo(s) };
  }

  // 20. Odd/Even total buts match (pas team)
  if (/^odd\s*\/\s*even$|^even\/odd$|pair\s*.\s*impair|odd\s*.\s*even/.test(m) && !/home|away|team|equipe|1st|2nd|1ere|2eme/.test(m)) {
    return { cat: 'ODD_EVEN_TOTAL', selKey: extractOddEven(s) };
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
function extractResultTotal(s, m) {
  const clean = s.replace(/\s+/g, '').toLowerCase();
  const side = /^(v?1|home|dom|1[^02])|^1$/i.test(clean) ? '1'
    : /^(v?2|ext|2[^0.])|^2$/i.test(clean) ? '2'
    : /^(x|nul|draw)/i.test(clean) ? 'X'
    : null;
  // line dans selection ou dans market
  let ou = clean.match(/(over|plus|tp|>)\s*[\d\.]*?(\d+(?:\.\d+)?)|(under|moins|tm|<)\s*[\d\.]*?(\d+(?:\.\d+)?)/);
  let isOver = false, line = null;
  if (ou) {
    isOver = ou[1] != null;
    line = parseFloat(ou[2] || ou[4]);
  } else if (m) {
    const mLine = String(m).match(/\[(\d+(?:\.\d+)?)\]/);
    if (mLine) {
      line = parseFloat(mLine[1]);
      isOver = /over|plus/i.test(clean);
    }
  }
  if (!side || line == null) return null;
  return `RT_${side}_${isOver ? 'OVER' : 'UNDER'}_${line}`;
}
function extractDCTotal(s, m) {
  const clean = s.replace(/\s+/g, '').toLowerCase();
  const side = clean.match(/^(1x|x2|12)/);
  if (!side) return null;
  let ou = clean.match(/(over|plus|>)\s*[\d\.]*?(\d+(?:\.\d+)?)|(under|moins|<)\s*[\d\.]*?(\d+(?:\.\d+)?)/);
  let isOver = false, line = null;
  if (ou) { isOver = ou[1] != null; line = parseFloat(ou[2] || ou[4]); }
  else if (m) {
    const mLine = String(m).match(/\[(\d+(?:\.\d+)?)\]/);
    if (mLine) { line = parseFloat(mLine[1]); isOver = /over|plus/i.test(clean); }
  }
  if (line == null) return null;
  return `DCT_${side[1].toUpperCase()}_${isOver ? 'OVER' : 'UNDER'}_${line}`;
}
function extractResultBTTS(s) {
  const clean = s.replace(/\s+/g, '').toLowerCase();
  const side = /^(v?1|home|dom)|^1[^02]/i.test(clean) ? '1'
    : /^(v?2|ext)|^2[^0.]/i.test(clean) ? '2'
    : /^(x|nul|draw)/i.test(clean) ? 'X'
    : null;
  const yes = /(oui|yes)/i.test(clean);
  const no = /(non|no)\b/i.test(clean);
  if (!side || (!yes && !no)) return null;
  return `RB_${side}_${yes ? 'YES' : 'NO'}`;
}
function extractDCBTTS(s) {
  const clean = s.replace(/\s+/g, '').toLowerCase();
  const side = clean.match(/^(1x|x2|12)/);
  if (!side) return null;
  const yes = /(oui|yes)/i.test(clean);
  const no = /(non|no)\b/i.test(clean);
  if (!yes && !no) return null;
  return `DCB_${side[1].toUpperCase()}_${yes ? 'YES' : 'NO'}`;
}

// ─── Main ───
const TOP_MATCHES = parseInt(process.env.TOP_MATCHES || '1', 10);
const MATCH_BATCH = parseInt(process.env.MATCH_BATCH || '6', 10);
const catalogs = new Map();
for (const key of BOOKS) {
  const b = bookmakersByKey[key]; if (!b) continue;
  try {
    const ms = await b.listMatches({ live: false, sport: 'football', horizonHours: 72 });
    catalogs.set(key, ms);
    console.log(`[${key}] ${ms.length} matchs`);
  } catch (e) { console.log(`[${key}] KO`); }
}
const entries = alignCatalogs(catalogs, { minBooks: 3, horizonMs: Date.now() + 72*3600*1000 });
entries.sort((a,b) => Object.keys(b.matches).length - Object.keys(a.matches).length);
const topEntries = entries.slice(0, TOP_MATCHES);
console.log(`\n${topEntries.length} matchs scannés (top populaires)\n`);

// Process 1 match : fetch + categorize + trouve arbs 2-way
async function processMatch(entry, idx) {
  const bookMatches = Object.entries(entry.matches).filter(([b]) => EXT[b]);
  const rawResults = await Promise.all(bookMatches.map(async ([book, m]) => {
    try { return { book, raw: await fetchRaw(book, m.id) }; } catch { return { book, raw: null }; }
  }));
  const cartography = {};
  for (const { book, raw } of rawResults) {
    if (!raw) continue;
    const outs = EXT[book](raw);
    for (const { market, selection, odds } of outs) {
      if (odds >= 40) continue;
      const cls = categorize(market, selection, entry.ref.home, entry.ref.away);
      if (!cls || !cls.selKey) continue;
      if (!cartography[cls.cat]) cartography[cls.cat] = {};
      if (!cartography[cls.cat][cls.selKey]) cartography[cls.cat][cls.selKey] = {};
      const prev = cartography[cls.cat][cls.selKey][book];
      if (!prev || odds > prev.odds) cartography[cls.cat][cls.selKey][book] = { market, selection, odds };
    }
  }
  // Détection arbs 2-way pour ce match
  const arbs = [];
  const OPPS = { 'YES': 'NO', 'NO': 'YES' };
  const opposite = (k1, k2) => {
    if (OPPS[k1] === k2) return true;
    const m1 = k1.match(/^OVER_(.+)$/); const m2 = k2.match(/^UNDER_(.+)$/);
    if (m1 && m2 && m1[1] === m2[1]) return true;
    const m3 = k1.match(/^UNDER_(.+)$/); const m4 = k2.match(/^OVER_(.+)$/);
    if (m3 && m4 && m3[1] === m4[1]) return true;
    if ((k1 === 'ODD' && k2 === 'EVEN') || (k1 === 'EVEN' && k2 === 'ODD')) return true;
    return false;
  };
  for (const [cat, sels] of Object.entries(cartography)) {
    const keys = Object.keys(sels);
    for (let i = 0; i < keys.length; i++) for (let j = i+1; j < keys.length; j++) {
      const k1 = keys[i], k2 = keys[j];
      if (!opposite(k1, k2)) continue;
      let bestPair = null;
      for (const [ba, va] of Object.entries(sels[k1])) {
        for (const [bb, vb] of Object.entries(sels[k2])) {
          if (ba === bb) continue;
          const sum = 1/va.odds + 1/vb.odds;
          if (!bestPair || sum < bestPair.sum) bestPair = { best1: { book: ba, ...va }, best2: { book: bb, ...vb }, sum };
        }
      }
      if (bestPair && bestPair.sum < 1) arbs.push({ cat, k1, k2, best1: bestPair.best1, best2: bestPair.best2, profit: 1 - bestPair.sum });
    }
  }
  console.log(`[${idx+1}/${topEntries.length}] ${entry.ref.home} vs ${entry.ref.away}  cats=${Object.keys(cartography).length}  arbs=${arbs.length}`);
  return { entry, arbs };
}

// Traite par batch en parallèle
const allArbs = [];
for (let b = 0; b < topEntries.length; b += MATCH_BATCH) {
  const batch = topEntries.slice(b, b + MATCH_BATCH).map((e, k) => processMatch(e, b + k));
  const results = await Promise.all(batch);
  for (const r of results) for (const a of r.arbs) allArbs.push({ ...a, match: `${r.entry.ref.home} vs ${r.entry.ref.away}`, league: r.entry.ref.league });
}
allArbs.sort((a,b) => b.profit - a.profit);

// ─── Cas single match : ancien flow (rétrocompatibilité) ───
const cartography = {}; // legacy pour l'ancien rapport détaillé, uniquement si TOP_MATCHES=1
if (TOP_MATCHES === 1 && topEntries[0]) {
  const entry = topEntries[0];
  const bookMatches = Object.entries(entry.matches).filter(([b]) => EXT[b]);
  const rawResults = await Promise.all(bookMatches.map(async ([book, m]) => {
    try { return { book, raw: await fetchRaw(book, m.id) }; } catch { return { book, raw: null }; }
  }));
  for (const { book, raw } of rawResults) {
    if (!raw) continue;
    const outs = EXT[book](raw);
    for (const { market, selection, odds } of outs) {
      if (odds >= 40) continue;
      const cls = categorize(market, selection, entry.ref.home, entry.ref.away);
      if (!cls || !cls.selKey) continue;
      if (!cartography[cls.cat]) cartography[cls.cat] = {};
      if (!cartography[cls.cat][cls.selKey]) cartography[cls.cat][cls.selKey] = {};
      const prev = cartography[cls.cat][cls.selKey][book];
      if (!prev || odds > prev.odds) cartography[cls.cat][cls.selKey][book] = { market, selection, odds };
    }
  }
}
const entry = topEntries[0] || { ref: { home: '?', away: '?' } };

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
let md = `# Cartographie cross-book — scan ${topEntries.length} matchs\n\n`;
md += `Généré: ${new Date().toISOString()}\n\n`;
md += `## Résumé global\n\n`;
md += `- Matchs scannés : ${topEntries.length}\n`;
md += `- **Arbs 2-way trouvés : ${allArbs.length}**\n\n`;

// TOP OPPS (multi-match)
md += `## 🎯 Arbitrages 2-way trouvés (tous matchs, tri par profit desc)\n\n`;
if (allArbs.length === 0) {
  md += `Aucun arb 2-way trouvé sur les ${topEntries.length} matchs scannés.\n\n`;
} else {
  for (const [i, a] of allArbs.slice(0, 30).entries()) {
    const bankroll = 100000;
    const sumInv = 1/a.best1.odds + 1/a.best2.odds;
    const s1 = bankroll * (1/a.best1.odds) / sumInv;
    const s2 = bankroll * (1/a.best2.odds) / sumInv;
    const retour = bankroll / sumInv;
    md += `\n### #${i+1} — PROFIT **${(a.profit*100).toFixed(2)}%** — ${a.match}\n\n`;
    md += `Ligue : ${a.league || '?'} | Catégorie : \`${a.cat}\`\n\n`;
    md += `Bankroll 100 000 XOF → gain net garanti **+${(retour - bankroll).toFixed(0)} XOF**\n\n`;
    md += `| Pari | Book | Marché (nom exact) | Sélection (nom exact) | Cote | Mise |\n|---|---|---|---|---:|---:|\n`;
    md += `| 1 | **${a.best1.book}** | \`${a.best1.market}\` | \`${a.best1.selection}\` | ${a.best1.odds.toFixed(2)} | ${s1.toFixed(0)} XOF |\n`;
    md += `| 2 | **${a.best2.book}** | \`${a.best2.market}\` | \`${a.best2.selection}\` | ${a.best2.odds.toFixed(2)} | ${s2.toFixed(0)} XOF |\n`;
    md += `\n**Vérif** : 1/${a.best1.odds.toFixed(2)} + 1/${a.best2.odds.toFixed(2)} = ${sumInv.toFixed(4)} < 1 → arb réel\n`;
  }
}

// Cartographie détaillée UNIQUEMENT si 1 seul match
if (TOP_MATCHES === 1) {
  md += `\n\n## Cartographie détaillée (match unique)\n\n`;
  md += `Match : **${entry.ref.home} vs ${entry.ref.away}**\n\n`;
  md += `| Catégorie | Books | Nb sélections |\n|---|---|---:|\n`;
  const catStats = [];
  for (const [cat, sels] of Object.entries(cartography)) {
    const books = new Set();
    for (const sk of Object.values(sels)) for (const b of Object.keys(sk)) books.add(b);
    catStats.push({ cat, books: [...books].sort(), nSel: Object.keys(sels).length });
  }
  catStats.sort((a,b) => b.books.length - a.books.length);
  for (const s of catStats) md += `| **${s.cat}** | ${s.books.join(', ')} (${s.books.length}) | ${s.nSel} |\n`;
}

// arbs2Way retiré (remplacé par allArbs multi-match)
const arbs2Way = [];
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
console.log(`Matchs scannés : ${topEntries.length}`);
console.log(`Arbs 2-way trouvés : ${allArbs.length}`);
if (allArbs.length > 0) {
  console.log(`Top profits :`);
  for (const a of allArbs.slice(0, 10)) console.log(`  ${(a.profit*100).toFixed(2)}% — ${a.match} — ${a.cat}`);
}
console.log(`Fichier : docs/cross-book-market-map.md`);
process.exit(0);
