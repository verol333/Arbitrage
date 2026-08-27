#!/usr/bin/env node
// SCAN DEDIE : "Double Chance + Les deux equipes marquent" (fin de match).
//
// Ce marche a une structure parfaite pour l arbitrage : l espace des resultats
// se resume a 6 cases atomiques et rien d autre.
//
//        BTTS Oui        BTTS Non
//  Dom   HY              HN
//  Nul   DY              DN
//  Ext   AY              AN
//
// Chaque option du book couvre exactement DEUX cases :
//   1X + Oui -> HY, DY      1X + Non -> HN, DN
//   12 + Oui -> HY, AY      12 + Non -> HN, AN
//   X2 + Oui -> DY, AY      X2 + Non -> DN, AN
//
// Aucune interpretation floue possible, aucun libelle devine : on ne garde que
// les selections ou l on lit clairement la double chance ET le oui/non.
// On prend la meilleure cote de chaque case parmi les books, puis on cherche la
// repartition de mises qui maximise le PIRE des 6 cas. Pire cas > 1 = profit
// garanti quoi qu il arrive.
//
// Lecture seule. Sortie : docs/dc-btts-scan.md
import { writeFileSync, mkdirSync } from 'node:fs';
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';
import { rawOutcomes, RAW_BOOKS } from '../src/foot/rawOutcomes.js';
import { solveWorstCase, selfTest } from '../src/core/worstCase.js';

const TOP_MATCHES = Number(process.env.TOP_MATCHES || 20);
const HORIZON_HOURS = Number(process.env.HORIZON_HOURS || 48);
const MIN_PROFIT = Number(process.env.MIN_PROFIT || 0.5);

const CELLS = ['HY', 'HN', 'DY', 'DN', 'AY', 'AN'];
const CELL_LABEL = {
  HY: 'Domicile + les 2 marquent', HN: 'Domicile sans BTTS',
  DY: 'Nul avec buts partages (1-1, 2-2...)', DN: 'Nul sans BTTS (0-0)',
  AY: 'Exterieur + les 2 marquent', AN: 'Exterieur sans BTTS',
};
const COVER = {
  '1X|Y': ['HY', 'DY'], '1X|N': ['HN', 'DN'],
  '12|Y': ['HY', 'AY'], '12|N': ['HN', 'AN'],
  'X2|Y': ['DY', 'AY'], 'X2|N': ['DN', 'AN'],
  // --- jambes simples, meme espace de 6 cases (chevauchements autorises) ---
  'W|H': ['HY', 'HN'], 'W|D': ['DY', 'DN'], 'W|A': ['AY', 'AN'],
  'DCO|1X': ['HY', 'HN', 'DY', 'DN'], 'DCO|12': ['HY', 'HN', 'AY', 'AN'], 'DCO|X2': ['DY', 'DN', 'AY', 'AN'],
  'BTTS|Y': ['HY', 'DY', 'AY'], 'BTTS|N': ['HN', 'DN', 'AN'],
};
const COMBO_KEYS = ['1X|Y', '1X|N', '12|Y', '12|N', 'X2|Y', 'X2|N'];

const norm = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

// ---- le marche est-il bien "double chance + btts" en fin de match ? ----
function isTargetMarket(name) {
  const m = norm(name);
  const hasDC = /double chance|dc /.test(m) || /\bdc\b/.test(m);
  const hasBTTS = /deux equipes marquent|les 2 equipes marquent|both teams to score|btts|gg ng/.test(m);
  if (!hasDC || !hasBTTS) return false;
  // on exclut tout ce qui n est pas la fin de match (mi-temps, totaux, corners)
  // fin de match uniquement : betpawa suffixe ses variantes '- 1H' / '- 2H',
  // congobet ecrit 'mi-temps'. Toute variante de periode est rejetee.
  if (/mi temps|1st half|2nd half|premiere periode|seconde periode|halftime|\b1h\b|\b2h\b|\bht\b|1ere|2eme|1re|2nde/.test(m)) return false;
  if (/total|plus de|moins de|over|under|corner|carton/.test(m)) return false;
  return true;
}

// ---- lecture de la case : double chance + oui/non ----
function parseSelection(sel) {
  const s = norm(sel);
  let dc = null;
  if (/\b1x\b/.test(s) || /1 ou x|home or draw|dom ou nul/.test(s)) dc = '1X';
  else if (/\b12\b/.test(s) || /1 ou 2|home or away|dom ou ext/.test(s)) dc = '12';
  else if (/\bx2\b/.test(s) || /x ou 2|draw or away|nul ou ext/.test(s)) dc = 'X2';
  let yn = null;
  if (/\b(oui|yes|gg|both)\b/.test(s)) yn = 'Y';
  else if (/\b(non|no|ng)\b/.test(s)) yn = 'N';
  if (!dc || !yn) return null;
  return dc + '|' + yn;
}


// ---- marches simples : resultat du match, double chance seule, BTTS seul ----
// Ces marches existent chez 1xbet et 1win (qui ne publient pas le marche combine).
// Leurs jambes couvrent 2, 3 ou 4 des 6 cases : le solveur exact peut les melanger
// avec les jambes combinees de congobet/betpawa.
const isPeriodOrOther = (m) => /mi temps|1st half|2nd half|halftime|\b1h\b|\b2h\b|\bht\b|1ere|2eme|1re|2nde|total|plus de|moins de|over|under|corner|carton|handicap|score exact|prolongation|penalt/.test(m);

function parseSimple(marketName, sel) {
  const m = norm(marketName);
  const s = norm(sel);
  if (isPeriodOrOther(m)) return null;
  const hasBTTS = /deux equipes marquent|both teams to score|btts|gg ng/.test(m);
  const hasDC = /double chance/.test(m) || /\bdc\b/.test(m);

  // BTTS seul (jamais 'in both halves' ni combine)
  if (hasBTTS && !hasDC) {
    if (/et |and |\+/.test(m)) return null;
    if (/^(oui|yes|gg|both teams to score|les deux equipes marquent)$/.test(s)) return 'BTTS|Y';
    if (/^(non|no|ng)$/.test(s)) return 'BTTS|N';
    return null;
  }
  // double chance seule
  if (hasDC && !hasBTTS) {
    if (/^(1x|1 ou x|home or draw|dom ou nul)$/.test(s)) return 'DCO|1X';
    if (/^(12|1 ou 2|home or away|dom ou ext)$/.test(s)) return 'DCO|12';
    if (/^(x2|x ou 2|draw or away|nul ou ext)$/.test(s)) return 'DCO|X2';
    return null;
  }
  // resultat du match 1X2
  if (/^1x2|1x2|resultat du match|match result|resultat final|vainqueur du match/.test(m) && !hasBTTS && !hasDC) {
    if (/^(1|home|dom|domicile)$/.test(s)) return 'W|H';
    if (/^(x|draw|nul|match nul)$/.test(s)) return 'W|D';
    if (/^(2|away|ext|exterieur)$/.test(s)) return 'W|A';
    return null;
  }
  return null;
}

// ---- pire cas : solveur EXACT (simplexe) ----
const solve = (legs) => solveWorstCase(legs, CELLS, COVER);

// Auto-diagnostic du solveur avant tout scan : s il echoue, un 0 opportunite
// ne veut rien dire et on arrete tout.
const st = selfTest(CELLS, COVER, COMBO_KEYS);
console.log('[auto-test solveur] arbitrage synthetique = ' + (st.arbWorst || 0).toFixed(4) +
  ' (attendu 1.3333), cas avec marge = ' + (st.realWorst || 0).toFixed(4) + ' (attendu < 1) -> ' +
  (st.ok ? 'OK' : 'ECHEC'));
if (!st.ok) { console.error('Solveur defectueux, scan annule.'); process.exit(1); }

// ---------- collecte ----------
console.log('=== SCAN DOUBLE CHANCE + BTTS ===');
const catalogs = new Map();
for (const key of RAW_BOOKS) {
  const book = bookmakersByKey[key];
  if (!book) continue;
  try {
    const matches = await book.listMatches({ live: false, sport: 'football', horizonHours: HORIZON_HOURS });
    catalogs.set(key, matches);
    console.log('[' + key + '] ' + matches.length + ' matchs');
  } catch (e) { console.log('[' + key + '] listMatches KO : ' + e.message); }
}
const entries = alignCatalogs(catalogs, { minBooks: 1, horizonMs: Date.now() + HORIZON_HOURS * 3600 * 1000 });
entries.sort((a, b) => Object.keys(b.matches).length - Object.keys(a.matches).length || (a.ref.start || 0) - (b.ref.start || 0));
const targets = entries.slice(0, TOP_MATCHES);
console.log(entries.length + ' matchs apparies, ' + targets.length + ' retenus\n');

const results = [];
const labelsSeen = new Map();   // book -> Set(nom de marche)
const unparsed = new Map();     // book -> Set(selection non lue)

const CONC = Number(process.env.CONCURRENCY || 8);

async function scanEntry(entry) {
  const label = entry.ref.home + ' vs ' + entry.ref.away;
  const perBook = await Promise.all(
    Object.entries(entry.matches).filter(([k]) => RAW_BOOKS.includes(k))
      .map(async ([key, m]) => { try { return { key, ...(await rawOutcomes(key, m.id)) }; } catch (e) { return { key, error: e.message }; } })
  );

  const best = new Map();
  const found = [];
  for (const r of perBook) {
    if (r.error) continue;
    for (const o of r.outcomes || []) {
      if (!isTargetMarket(o.market)) {
        const sk = parseSimple(o.market, o.selection);
        if (sk) {
          found.push({ book: r.key, key: sk, odds: o.odds });
          const c0 = best.get(sk);
          if (!c0 || o.odds > c0.odds) best.set(sk, { key: sk, odds: o.odds, book: r.key, market: o.market, selection: o.selection });
        }
        continue;
      }
      if (!labelsSeen.has(r.key)) labelsSeen.set(r.key, new Set());
      labelsSeen.get(r.key).add(String(o.market));
      const key = parseSelection(o.selection);
      if (!key) {
        if (!unparsed.has(r.key)) unparsed.set(r.key, new Set());
        unparsed.get(r.key).add(String(o.market) + ' -> ' + String(o.selection));
        continue;
      }
      found.push({ book: r.key, key, odds: o.odds });
      const cur = best.get(key);
      if (!cur || o.odds > cur.odds) best.set(key, { key, odds: o.odds, book: r.key, market: o.market, selection: o.selection });
    }
  }

  const legs = [...best.values()];
  // Invariant du marche : chaque case etant couverte par 2 des 6 options, un
  // arbitrage n existe QUE si la somme des 1/cote des 6 meilleures options
  // descend sous 2.00. C est la mesure directe de la marge cumulee des books.
  const combo = legs.filter((l) => COMBO_KEYS.includes(l.key));
  const impSum = combo.length === 6 ? combo.reduce((a, l) => a + 1 / l.odds, 0) : null;
  const sol = legs.length >= 2 ? solve(legs) : null;
  const profit = sol ? (sol.worst - 1) * 100 : null;
  console.log('- ' + label + ' : ' + legs.length + ' jambes (' + combo.length + ' combinees), ' + found.length + ' cotes lues, pire cas ' +
    (sol ? sol.worst.toFixed(4) : 'n/a'));
  return { label, legs, nCombo: combo.length, impSum, found: found.length, sol, profit, books: [...new Set(found.map((f) => f.book))] };
}

// file de traitement parallele
let cursor = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (cursor < targets.length) {
    const entry = targets[cursor++];
    try { results.push(await scanEntry(entry)); }
    catch (e) { console.log('- ' + entry.ref.home + ' vs ' + entry.ref.away + ' : KO ' + e.message); }
  }
}));

// ---------- rapport ----------
results.sort((a, b) => (b.profit ?? -999) - (a.profit ?? -999));
const md = ['# Double Chance + Les deux equipes marquent (fin de match)', '',
  'Genere le ' + new Date().toISOString(), '',
  'Espace complet : 6 cases (Dom/Nul/Ext x BTTS oui/non). Chaque option couvre 2 cases.',
  'Le pire cas est le rendement garanti pour 1 unite misee au total : au-dessus de 1.00, profit certain.', ''];

md.push('Auto-test du solveur : arbitrage synthetique rendu ' + (st.arbWorst || 0).toFixed(4) + ' (attendu 1.3333), cas avec marge ' + (st.realWorst || 0).toFixed(4) + ' -> ' + (st.ok ? 'solveur valide' : 'SOLVEUR DEFECTUEUX') + '.', '');
md.push('## Libelles reellement trouves chez chaque book', '');
if (!labelsSeen.size) md.push('Aucun book ne publie ce marche sur cet echantillon.');
for (const [book, set] of labelsSeen) md.push('- **' + book + '** : ' + [...set].join(' / '));
md.push('');
if (unparsed.size) {
  md.push('### Selections non decodees (a corriger si elles apparaissent)', '');
  for (const [book, set] of unparsed) md.push('- ' + book + ' : ' + [...set].slice(0, 8).join(' | '));
  md.push('');
}

const winners = results.filter((r) => r.profit != null && r.profit >= MIN_PROFIT);
md.push('## Opportunites (pire cas > mise)', '');
if (!winners.length) md.push('Aucune combinaison garantie sur cet echantillon.');
for (const r of winners) {
  md.push('### ' + r.label + ' — profit garanti ' + r.profit.toFixed(2) + '%', '');
  md.push('| Part de mise | Case | Book | Cote | Selection |');
  md.push('|---:|---|---|---:|---|');
  for (const e of r.sol.mix.sort((a, b) => b.x - a.x)) {
    md.push('| ' + (e.x * 100).toFixed(1) + '% | ' + e.leg.key.replace('|', ' + ') + ' | ' + e.leg.book +
      ' | ' + e.leg.odds + ' | ' + String(e.leg.selection).replace(/\|/g, '/') + ' |');
  }
  md.push('', 'Cas le plus defavorable : ' + CELL_LABEL[r.sol.worstCell] + ' (rend ' + r.sol.worst.toFixed(4) + ')', '');
}

md.push('', '## Tous les matchs', '');
md.push('| Match | Books avec le marche | Cotes lues | Jambes (dont combinees) | Somme 1/cote (seuil 2.00) | Pire cas | Ecart |');
md.push('|---|---|---:|---:|---:|---:|---:|');
for (const r of results) {
  md.push('| ' + r.label + ' | ' + (r.books.join(', ') || '—') + ' | ' + r.found + ' | ' + r.legs.length + ' (' + r.nCombo + ') | ' +
    (r.impSum != null ? r.impSum.toFixed(3) : 'n/a') + ' | ' + (r.sol ? r.sol.worst.toFixed(4) : 'n/a') + ' | ' + (r.profit != null ? r.profit.toFixed(2) + '%' : 'n/a') + ' |');
}
md.push('', 'Rappel du reglement retenu : 1X+Oui gagne si le domicile gagne OU match nul, avec au moins un but ' +
  'de chaque equipe. 12+Non gagne si un des deux camps gagne et qu une seule equipe (ou aucune) a marque. ' +
  'Le nul + Non correspond au seul 0-0.', '');

mkdirSync('docs', { recursive: true });
writeFileSync('docs/dc-btts-scan.md', md.join('\n'));
console.log('\nRapport : docs/dc-btts-scan.md');
