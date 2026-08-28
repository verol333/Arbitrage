#!/usr/bin/env node
// RECENSEMENT TENNIS PAR SET (1er / 2e / 3e set) — lecture seule.
//
// Constat de depart : les opportunites tennis reellement encaissees portent sur
// les handicaps du TEMPS REGLEMENTAIRE (match entier). Les memes familles
// existent set par set, mais nos lecteurs ne les remontent pas toutes.
//
// Ce script repond a trois questions, sans rien placer :
//   1. Quelles cles par set (sN_) le MOTEUR lit-il deja, book par book ?
//   2. Quels marches par set les books exposent-ils REELLEMENT en brut ?
//      -> l'ecart entre 1 et 2 = la liste de ce qu'il reste a brancher.
//   3. Sur les familles 2-way par set (vainqueur, handicap jeux, total jeux,
//      pair/impair), quelle est la meilleure paire complementaire disponible
//      entre books, et laquelle passe deja sous 1.00 (surebet) ?
//
// Rapport : docs/tennis-set-census.md
import { writeFileSync, mkdirSync } from 'node:fs';
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';
import { bpFetchEvent } from '../src/bookmakers/betpawa/api.js';
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { dumpXbetMarkets } from '../src/bookmakers/xbet/dictionary.js';
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';

const BOOKS = (process.env.TS_BOOKS || '1xbet,congobet,betpawa,1win,apollo,sportybet')
  .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
const MATCHES = parseInt(process.env.TS_MATCHES || '6', 10);
const MIN_BOOKS = parseInt(process.env.TS_MIN_BOOKS || '2', 10);
const HORIZON = parseInt(process.env.TS_HORIZON || '48', 10);
const DUMP = process.env.TS_DUMP !== '0';
const ROWS = parseInt(process.env.TS_ROWS || '0', 10) || (MATCHES > 12 ? 3 : 12);

const out = [];
function say(s) { console.log(s); out.push(s); }

// ─── Vocabulaire canonique par set ───────────────────────────────────────────
// sN_match_1/2 · sN_hcp_home_L / sN_hcp_away_-L · sN_over_L / sN_under_L · sN_odd/even
function setInfo(key) {
  const m = key.match(/^s([1-5])_(.+)$/);
  if (!m) return null;
  const set = Number(m[1]);
  const rest = m[2];
  if (/^match_[12]$/.test(rest)) return { set: set, fam: 'Vainqueur du set' };
  if (/^hcp_(home|away)_-?[0-9.]+$/.test(rest)) return { set: set, fam: 'Handicap jeux' };
  if (/^(over|under)_-?[0-9.]+$/.test(rest)) return { set: set, fam: 'Total jeux' };
  if (/^(odd|even)$/.test(rest)) return { set: set, fam: 'Pair/Impair jeux' };
  return { set: set, fam: rest };
}
function complement(key) {
  let m = key.match(/^(s[1-5]_)match_1$/); if (m) return m[1] + 'match_2';
  m = key.match(/^(s[1-5]_)match_2$/); if (m) return m[1] + 'match_1';
  m = key.match(/^(s[1-5]_)hcp_home_(-?[0-9.]+)$/); if (m) return m[1] + 'hcp_away_' + String(-Number(m[2]));
  m = key.match(/^(s[1-5]_)hcp_away_(-?[0-9.]+)$/); if (m) return m[1] + 'hcp_home_' + String(-Number(m[2]));
  m = key.match(/^(s[1-5]_)over_(-?[0-9.]+)$/); if (m) return m[1] + 'under_' + m[2];
  m = key.match(/^(s[1-5]_)under_(-?[0-9.]+)$/); if (m) return m[1] + 'over_' + m[2];
  m = key.match(/^(s[1-5]_)odd$/); if (m) return m[1] + 'even';
  m = key.match(/^(s[1-5]_)even$/); if (m) return m[1] + 'odd';
  return null;
}

// ─── Dumps bruts : libelles natifs exacts, pour voir ce qu'on ne lit pas ─────
async function dumpCongobet(id) {
  const raw = await congoJson(CONGO_API + 'events/' + id);
  return (raw && raw.eventBetTypes ? raw.eventBetTypes : []).map(function (bt) {
    return {
      market: String(bt.name || '?'),
      selections: (bt.eventBetTypeItems || []).filter(function (it) { return parseFloat(it.odds) > 1; })
        .map(function (it) { return { name: String(it.shortName || it.name || '?'), odds: parseFloat(it.odds) }; }),
    };
  });
}
async function dumpBetpawa(id) {
  const raw = await bpFetchEvent(id, 15000);
  const res = [];
  const markets = raw && raw.markets ? raw.markets : [];
  for (const mk of markets) {
    const base = (mk.marketType && mk.marketType.name) || mk.name || ('m' + mk.id);
    for (const row of (mk.row || [])) {
      const sp = row && row.specifier ? row.specifier : {};
      const suffix = sp.total ? ' [' + sp.total + ']' : (sp.hcp ? ' [' + sp.hcp + ']' : '');
      res.push({
        market: base + suffix,
        selections: (row.prices || []).filter(function (p) { return parseFloat(p.odds) > 1; })
          .map(function (p) { return { name: String(p.name || p.displayName || '?'), odds: parseFloat(p.odds) }; }),
      });
    }
  }
  return res;
}
async function dumpOnewin(id) {
  const raw = await fetchOddsWS([id], { timeoutMs: 20000, quietMs: 3000 });
  const r = raw.get(id) || raw.get(String(id)) || {};
  return Object.entries(r).map(function (pair) {
    return {
      market: String(pair[0]),
      selections: (pair[1] || []).filter(function (o) { return o && o.status === 1 && Number(o.cf) > 1; })
        .map(function (o) { return { name: String(o.name || o.outcome || '?'), odds: Number(o.cf) }; }),
    };
  });
}
async function dumpXbet(id) {
  const res = await dumpXbetMarkets(id);
  if (!res.ok) throw new Error(res.reason || 'dump_failed');
  return res.markets.map(function (m) {
    return {
      market: m.market,
      selections: m.selections.map(function (s) {
        return { name: s.name + (s.line != null ? ' [' + s.line + ']' : ''), odds: s.odds };
      }),
    };
  });
}
const DUMPERS = { congobet: dumpCongobet, betpawa: dumpBetpawa, '1win': dumpOnewin, '1xbet': dumpXbet };

function isSetLabel(label) { return /set|manche/i.test(String(label)); }
function rawSetNumbers(label) {
  const l = String(label).toLowerCase();
  const nums = new Set();
  const re = /(?:^|[^0-9])([1-5])\s*(?:er|re|e|st|nd|rd|th)?\s*(?:set|manche)|(?:set|manche)\s*([1-5])/g;
  let m;
  while ((m = re.exec(l)) !== null) { const n = m[1] || m[2]; if (n) nums.add(Number(n)); }
  return Array.from(nums);
}

// ─── Agregats globaux ────────────────────────────────────────────────────────
const canonSetsByBook = new Map();
const canonKeysByBook = new Map();
const rawSetsByBook = new Map();
const rawSetLabels = new Map();
const famBooks = new Map();
const answered = new Map();   // book -> nb de matchs ou il a renvoye au moins une cote de set
const listed = new Map();     // book -> nb de matchs tennis listes au catalogue
const pairs = [];
function addTo(map, k, v) { if (!map.has(k)) map.set(k, new Set()); map.get(k).add(v); }

say('# Recensement tennis par set');
say('');
say('Genere le ' + new Date().toISOString());
say('');
say('Books : ' + BOOKS.join(', ') + ' — ' + MATCHES + ' match(s), horizon ' + HORIZON + 'h');
say('');

// ─── 1. Catalogues tennis ────────────────────────────────────────────────────
const catalogs = new Map();
await Promise.all(BOOKS.map(async function (key) {
  const book = bookmakersByKey[key];
  if (!book) { console.log('[' + key + '] absent du registre'); return; }
  try {
    const ms = await book.listMatches({ live: false, sport: 'tennis', horizonHours: HORIZON });
    catalogs.set(key, ms);
    listed.set(key, ms.length);
    console.log('[' + key + '] ' + ms.length + ' matchs tennis listes');
  } catch (e) { console.log('[' + key + '] KO ' + e.message); }
}));

const entries = alignCatalogs(catalogs, { minBooks: MIN_BOOKS, horizonMs: Date.now() + HORIZON * 3600 * 1000 });
entries.sort(function (a, b) { return Object.keys(b.matches).length - Object.keys(a.matches).length; });
const top = entries.slice(0, MATCHES);
if (!top.length) {
  say('Aucun match tennis commun a ' + MIN_BOOKS + ' books.');
  mkdirSync('docs', { recursive: true });
  writeFileSync('docs/tennis-set-census.md', out.join('\n'));
  process.exit(0);
}

// ─── 2. Match par match ──────────────────────────────────────────────────────
say('## Detail par match');
say('');
for (const entry of top) {
  const label = entry.ref.home + ' vs ' + entry.ref.away;
  const bookKeys = Object.keys(entry.matches);
  say('### ' + label + '  (' + bookKeys.length + ' books)');
  say('');

  const canon = new Map();
  await Promise.all(bookKeys.map(async function (bk) {
    const book = bookmakersByKey[bk];
    if (!book) return;
    try {
      const odds = await book.getOdds(entry.matches[bk], { sport: 'tennis', live: false });
      canon.set(bk, odds || {});
    } catch (e) { canon.set(bk, {}); }
  }));

  const best = new Map();
  for (const [bk, odds] of canon) {
    if (Object.keys(odds).some(function (k) { return setInfo(k); })) answered.set(bk, (answered.get(bk) || 0) + 1);
    for (const k of Object.keys(odds)) {
      const info = setInfo(k);
      if (!info) continue;
      const o = Number(odds[k]);
      if (!(o > 1)) continue;
      addTo(canonSetsByBook, bk, info.set);
      addTo(canonKeysByBook, bk, k);
      addTo(famBooks, info.set + '|' + info.fam, bk);
      const cur = best.get(k);
      if (!cur || o > cur.odds) best.set(k, { odds: o, book: bk });
    }
  }
  const perBookCount = bookKeys.map(function (bk) {
    const s = canon.get(bk) || {};
    const n = Object.keys(s).filter(function (k) { return setInfo(k); }).length;
    return bk + ' ' + n;
  }).join(' · ');
  say('Cles par set lues par le moteur : ' + (perBookCount || 'aucune'));
  say('');

  const seen = new Set();
  const found = [];
  for (const [k, v] of best) {
    const comp = complement(k);
    if (!comp || !best.has(comp)) continue;
    const pairId = [k, comp].sort().join('~');
    if (seen.has(pairId)) continue;
    seen.add(pairId);
    const w = best.get(comp);
    const sum = 1 / v.odds + 1 / w.odds;
    const rec = { match: label, a: k, b: comp, oa: v.odds, ob: w.odds, ba: v.book, bb: w.book, sum: sum, info: setInfo(k) };
    found.push(rec);
    pairs.push(rec);
  }
  found.sort(function (a, b) { return a.sum - b.sum; });
  if (found.length) {
    say('| Set | Famille | Jambe A | Jambe B | Somme 1/cote | Marge |');
    say('|---|---|---|---|---:|---:|');
    for (const p of found.slice(0, ROWS)) {
      say('| ' + p.info.set + ' | ' + p.info.fam + ' | ' + p.a + ' ' + p.oa.toFixed(2) + ' (' + p.ba + ') | '
        + p.b + ' ' + p.ob.toFixed(2) + ' (' + p.bb + ') | ' + p.sum.toFixed(4) + ' | '
        + ((1 - p.sum) * 100).toFixed(2) + '% |');
    }
  } else {
    say('Aucune paire complementaire par set trouvee sur ce match.');
  }
  say('');

  for (const bk of DUMP ? bookKeys : []) {
    if (!DUMPERS[bk]) continue;
    let markets = [];
    try { markets = await DUMPERS[bk](entry.matches[bk].id); }
    catch (e) { say('- ' + bk + ' : dump brut impossible (' + e.message + ')'); continue; }
    const setMk = markets.filter(function (m) { return isSetLabel(m.market); });
    if (!rawSetLabels.has(bk)) rawSetLabels.set(bk, new Map());
    for (const m of setMk) {
      const clean = m.market.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
      const map = rawSetLabels.get(bk);
      map.set(clean, (map.get(clean) || 0) + m.selections.length);
      for (const n of rawSetNumbers(m.market)) addTo(rawSetsByBook, bk, n);
    }
    say('- ' + bk + ' : ' + setMk.length + ' marches bruts mentionnant un set');
  }
  say('');
}

// ─── 3. Synthese ─────────────────────────────────────────────────────────────
say('## Couverture par book : ce que le moteur lit vs ce que le book expose');
say('');
say('| Book | Matchs listes | Matchs avec cotes de set | Sets lus | Sets vus en brut | Cles canoniques | Verdict |');
say('|---|---:|---|---|---|---:|---|');
for (const bk of BOOKS) {
  const canonS = Array.from(canonSetsByBook.get(bk) || []).sort();
  const rawS = Array.from(rawSetsByBook.get(bk) || []).sort();
  const nKeys = (canonKeysByBook.get(bk) || new Set()).size;
  const missing = rawS.filter(function (n) { return canonS.indexOf(n) === -1; });
  const nAns = answered.get(bk) || 0;
  const nList = listed.get(bk);
  let verdict;
  if (nList == null) verdict = 'CATALOGUE KO — le book n a rien liste';
  else if (!nAns) verdict = 'AUCUNE cote de set remontee';
  else if (missing.length) verdict = 'sets manquants : ' + missing.join(',');
  else if (nAns < top.length) verdict = 'partiel : muet sur ' + (top.length - nAns) + '/' + top.length + ' matchs';
  else verdict = 'complet sur tous les matchs';
  say('| ' + bk + ' | ' + (nList == null ? '—' : nList) + ' | ' + nAns + '/' + top.length + ' | '
    + (canonS.join(',') || '—') + ' | ' + (rawS.join(',') || '—') + ' | ' + nKeys + ' | ' + verdict + ' |');
}
say('');

say('## Familles par set disponibles sur au moins 2 books (= arbitrable)');
say('');
const famRows = Array.from(famBooks.entries()).map(function (e) {
  return { k: e[0], books: Array.from(e[1]) };
}).filter(function (r) { return r.books.length >= 2; });
famRows.sort(function (a, b) { return b.books.length - a.books.length || a.k.localeCompare(b.k); });
if (!famRows.length) say('Aucune : aucune famille par set n est lue par 2 books a la fois.');
else {
  say('| Set | Famille | Books | Nb |');
  say('|---|---|---|---:|');
  for (const r of famRows) {
    const parts = r.k.split('|');
    say('| ' + parts[0] + ' | ' + parts[1] + ' | ' + r.books.join(', ') + ' | ' + r.books.length + ' |');
  }
}
say('');

say('## Meilleures paires par set, tous matchs confondus');
say('');
pairs.sort(function (a, b) { return a.sum - b.sum; });
const sure = pairs.filter(function (p) { return p.sum < 1; });
say('Paires completes trouvees : ' + pairs.length + ' — dont ' + sure.length + ' sous 1.00 (profit garanti).');
say('');
if (pairs.length) {
  say('| Match | Set | Famille | A | B | Somme | Marge |');
  say('|---|---|---|---|---|---:|---:|');
  for (const p of pairs.slice(0, 25)) {
    say('| ' + p.match + ' | ' + p.info.set + ' | ' + p.info.fam + ' | ' + p.a + ' ' + p.oa.toFixed(2) + ' (' + p.ba + ') | '
      + p.b + ' ' + p.ob.toFixed(2) + ' (' + p.bb + ') | ' + p.sum.toFixed(4) + ' | ' + ((1 - p.sum) * 100).toFixed(2) + '% |');
  }
}
say('');

say('## Marches par set exposes en brut (candidats a brancher)');
say('');
for (const bk of BOOKS) {
  const map = rawSetLabels.get(bk);
  if (!map || !map.size) continue;
  say('### ' + bk);
  const rows = Array.from(map.entries()).sort(function (a, b) { return b[1] - a[1]; });
  for (const r of rows.slice(0, 40)) say('- ' + r[0] + '  (' + r[1] + ' issues cumulees)');
  say('');
}

mkdirSync('docs', { recursive: true });
writeFileSync('docs/tennis-set-census.md', out.join('\n'));
console.log('\nRapport ecrit : docs/tennis-set-census.md');
