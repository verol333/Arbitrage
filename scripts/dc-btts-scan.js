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
};

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
  if (/mi temps|1st half|2nd half|premiere periode|seconde periode|halftime|ht\b/.test(m)) return false;
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

// ---- optimisation du pire cas sur 6 cases (poids multiplicatifs) ----
function solve(legs) {
  if (!legs.length) return null;
  const N = CELLS.length;
  const pays = legs.map((l) => CELLS.map((c) => (COVER[l.key].includes(c) ? l.odds : 0)));
  const M = Math.max(...legs.map((l) => l.odds));
  const w = new Array(N).fill(1);
  const count = new Array(legs.length).fill(0);
  const eta = 0.5;
  const ITER = 20000;
  for (let it = 0; it < ITER; it++) {
    const sum = w.reduce((a, b) => a + b, 0);
    let bi = 0, bv = -Infinity;
    for (let k = 0; k < legs.length; k++) {
      let v = 0;
      for (let i = 0; i < N; i++) v += (w[i] / sum) * pays[k][i];
      if (v > bv) { bv = v; bi = k; }
    }
    count[bi]++;
    for (let i = 0; i < N; i++) w[i] *= Math.exp(-eta * (pays[bi][i] / M));
  }
  const tot = count.reduce((a, b) => a + b, 0);
  let mix = legs.map((l, k) => ({ leg: l, x: count[k] / tot })).filter((e) => e.x > 0.002);
  const s = mix.reduce((a, e) => a + e.x, 0);
  mix = mix.map((e) => ({ ...e, x: e.x / s }));
  let worst = Infinity, wc = null;
  for (let i = 0; i < CELLS.length; i++) {
    let v = 0;
    for (const e of mix) v += e.x * (COVER[e.leg.key].includes(CELLS[i]) ? e.leg.odds : 0);
    if (v < worst) { worst = v; wc = CELLS[i]; }
  }
  return { mix, worst, worstCell: wc };
}

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

for (const entry of targets) {
  const label = entry.ref.home + ' vs ' + entry.ref.away;
  const perBook = await Promise.all(
    Object.entries(entry.matches).filter(([k]) => RAW_BOOKS.includes(k))
      .map(async ([key, m]) => ({ key, ...(await rawOutcomes(key, m.id)) }))
  );

  const best = new Map(); // key case -> { odds, book, market, selection }
  const found = [];
  for (const r of perBook) {
    if (r.error) continue;
    for (const o of r.outcomes || []) {
      if (!isTargetMarket(o.market)) continue;
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
  const sol = legs.length >= 2 ? solve(legs) : null;
  const profit = sol ? (sol.worst - 1) * 100 : null;
  console.log('- ' + label + ' : ' + legs.length + '/6 cases, ' + found.length + ' cotes lues, pire cas ' +
    (sol ? sol.worst.toFixed(4) : 'n/a'));
  results.push({ label, legs, found: found.length, sol, profit, books: [...new Set(found.map((f) => f.book))] });
}

// ---------- rapport ----------
results.sort((a, b) => (b.profit ?? -999) - (a.profit ?? -999));
const md = ['# Double Chance + Les deux equipes marquent (fin de match)', '',
  'Genere le ' + new Date().toISOString(), '',
  'Espace complet : 6 cases (Dom/Nul/Ext x BTTS oui/non). Chaque option couvre 2 cases.',
  'Le pire cas est le rendement garanti pour 1 unite misee au total : au-dessus de 1.00, profit certain.', ''];

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
md.push('| Match | Books avec le marche | Cotes lues | Cases couvertes | Pire cas | Ecart |');
md.push('|---|---|---:|---:|---:|---:|');
for (const r of results) {
  md.push('| ' + r.label + ' | ' + (r.books.join(', ') || '—') + ' | ' + r.found + ' | ' + r.legs.length + '/6 | ' +
    (r.sol ? r.sol.worst.toFixed(4) : 'n/a') + ' | ' + (r.profit != null ? r.profit.toFixed(2) + '%' : 'n/a') + ' |');
}
md.push('', 'Rappel du reglement retenu : 1X+Oui gagne si le domicile gagne OU match nul, avec au moins un but ' +
  'de chaque equipe. 12+Non gagne si un des deux camps gagne et qu une seule equipe (ou aucune) a marque. ' +
  'Le nul + Non correspond au seul 0-0.', '');

mkdirSync('docs', { recursive: true });
writeFileSync('docs/dc-btts-scan.md', md.join('\n'));
console.log('\nRapport : docs/dc-btts-scan.md');
