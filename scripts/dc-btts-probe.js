#!/usr/bin/env node
// SONDE : le marche combine "Double Chance + BTTS (fin de match)" existe-t-il
// chez les 4 books cibles (1xbet, 1win, congobet, betpawa) sur les matchs
// populaires ?
//
// congobet / betpawa : le marche est nomme -> lecture directe.
// 1win : les groupes sont nommes par WebSocket -> on liste tout nom contenant
//        a la fois "double chance" et "marquent/score/btts/gg".
// 1xbet : groupes 100% numeriques (aucun texte). Identification STRUCTURELLE :
//        un groupe anonyme de 6 issues sans parametre dont les cotes triees
//        collent (ecart relatif moyen < 12%) aux 6 cotes de reference du meme
//        match chez betpawa/congobet ne peut etre que ce marche. On publie le
//        mapping T -> case propose (par proximite de cote) pour validation.
//
// Lecture seule. Sortie : docs/dc-btts-probe.md
import { writeFileSync, mkdirSync } from 'node:fs';
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';
import { rawOutcomes, RAW_BOOKS } from '../src/foot/rawOutcomes.js';

const TOP_MATCHES = Number(process.env.TOP_MATCHES || 12);
const HORIZON_HOURS = Number(process.env.HORIZON_HOURS || 48);

const CELLS = ['1X|Y', '1X|N', '12|Y', '12|N', 'X2|Y', 'X2|N'];
const norm = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

function isTargetMarket(name) {
  const m = norm(name);
  const hasDC = /double chance|dc /.test(m) || /\bdc\b/.test(m);
  const hasBTTS = /deux equipes marquent|les 2 equipes marquent|both teams to score|btts|gg ng/.test(m);
  if (!hasDC || !hasBTTS) return false;
  if (/mi temps|1st half|2nd half|halftime|\b1h\b|\b2h\b|\bht\b|1ere|2eme|1re|2nde/.test(m)) return false;
  if (/total|plus de|moins de|over|under|corner|carton/.test(m)) return false;
  return true;
}
function parseSelection(sel) {
  const s = norm(sel);
  let dc = null;
  if (/\b1x\b/.test(s) || /1 ou x|home or draw|dom ou nul/.test(s)) dc = '1X';
  else if (/\b12\b/.test(s) || /1 ou 2|home or away|dom ou ext/.test(s)) dc = '12';
  else if (/\bx2\b/.test(s) || /x ou 2|draw or away|nul ou ext/.test(s)) dc = 'X2';
  let yn = null;
  if (/\b(oui|yes|gg|both)\b/.test(s)) yn = 'Y';
  else if (/\b(non|no|ng)\b/.test(s)) yn = 'N';
  return dc && yn ? dc + '|' + yn : null;
}

// nom 1win candidat ? (test large, sans exclusion de periode -> on liste tout)
function onewinCandidate(name) {
  const m = norm(name);
  return /(double chance|\bdc\b)/.test(m) && /(marquent|to score|btts|gg)/.test(m);
}

// ---------- collecte des matchs presents sur les 4 books ----------
const catalogs = new Map();
for (const key of RAW_BOOKS) {
  const book = bookmakersByKey[key];
  try {
    const matches = await book.listMatches({ live: false, sport: 'football', horizonHours: HORIZON_HOURS });
    catalogs.set(key, matches);
    console.log('[' + key + '] ' + matches.length + ' matchs');
  } catch (e) { console.log('[' + key + '] listMatches KO : ' + e.message); }
}
const entries = alignCatalogs(catalogs, { minBooks: RAW_BOOKS.length, horizonMs: Date.now() + HORIZON_HOURS * 3600 * 1000 });
entries.sort((a, b) => (a.ref.start || 0) - (b.ref.start || 0));
const targets = entries.slice(0, TOP_MATCHES);
console.log(entries.length + ' matchs presents sur les 4 books, ' + targets.length + ' sondes\n');

const md = ['# Sonde marche combine Double Chance + BTTS (fin de match)', '',
  'Genere le ' + new Date().toISOString(), '',
  'Matchs presents sur les 4 books : ' + entries.length, ''];

const availability = { '1xbet': 0, '1win': 0, congobet: 0, betpawa: 0 };
const xbetGroupVotes = new Map(); // G -> nombre de matchs ou il colle
const onewinNames = new Set();

for (const entry of targets) {
  const label = entry.ref.home + ' vs ' + entry.ref.away;
  console.log('--- ' + label);
  md.push('## ' + label, '');
  const perBook = {};
  await Promise.all(Object.entries(entry.matches).map(async ([key, m]) => {
    const r = await rawOutcomes(key, m.id);
    perBook[key] = r;
    if (r.error) console.log('  [' + key + '] KO : ' + r.error);
  }));

  // reference : 6 cotes du marche nomme (betpawa prioritaire, sinon congobet)
  let ref = null, refBook = null;
  for (const bk of ['betpawa', 'congobet']) {
    const cells = new Map();
    for (const o of perBook[bk]?.outcomes || []) {
      if (!isTargetMarket(o.market)) continue;
      const k = parseSelection(o.selection);
      if (k) cells.set(k, o.odds);
    }
    if (cells.size === 6) { ref = cells; refBook = bk; }
    availability[bk] += cells.size === 6 ? 1 : 0;
    md.push('- **' + bk + '** : marche combine ' + (cells.size === 6 ? 'PRESENT (6/6 cases)' : (cells.size ? 'incomplet (' + cells.size + '/6)' : 'ABSENT')));
  }

  // 1win : noms candidats
  let onewinHit = false;
  const g1win = new Map();
  for (const o of perBook['1win']?.outcomes || []) {
    if (!g1win.has(o.market)) g1win.set(o.market, []);
    g1win.get(o.market).push(o);
    if (onewinCandidate(o.market)) { onewinHit = true; onewinNames.add(String(o.market)); }
  }
  if (onewinHit) availability['1win']++;
  md.push('- **1win** : ' + (onewinHit ? 'candidat(s) nomme(s) trouve(s)' : 'aucun nom de marche DC+BTTS (' + g1win.size + ' marches lus)'));
  if (!onewinHit && g1win.size) {
    const six = [...g1win.entries()].filter(([, l]) => l.length === 6).map(([n]) => n);
    if (six.length) md.push('  - groupes 1win a 6 issues (a inspecter) : ' + six.slice(0, 12).join(' ; '));
  }

  // 1xbet : identification structurelle des groupes anonymes a 6 issues
  const gx = new Map();
  for (const o of perBook['1xbet']?.outcomes || []) {
    if (!/^xbet-G/.test(o.market)) continue;
    if (!gx.has(o.market)) gx.set(o.market, []);
    gx.get(o.market).push(o);
  }
  let xbetHit = null;
  if (ref) {
    const refSorted = [...ref.values()].sort((a, b) => a - b);
    for (const [g, list] of gx) {
      if (list.length !== 6 || list.some((o) => o.line != null)) continue;
      const cand = list.map((o) => o.odds).sort((a, b) => a - b);
      const err = cand.reduce((a, v, i) => a + Math.abs(v - refSorted[i]) / refSorted[i], 0) / 6;
      if (err < 0.12 && (!xbetHit || err < xbetHit.err)) xbetHit = { g, err, list };
    }
  }
  if (xbetHit) {
    availability['1xbet']++;
    xbetGroupVotes.set(xbetHit.g, (xbetGroupVotes.get(xbetHit.g) || 0) + 1);
    md.push('- **1xbet** : groupe ' + xbetHit.g + ' colle aux cotes ' + refBook + ' (ecart moyen ' + (xbetHit.err * 100).toFixed(1) + '%)');
    // mapping T -> case propose par proximite de cote
    const refPairs = [...ref.entries()].sort((a, b) => a[1] - b[1]);
    const candPairs = [...xbetHit.list].sort((a, b) => a.odds - b.odds);
    md.push('', '  | Case (' + refBook + ') | Cote ref | Issue 1xbet | Cote 1xbet |', '  |---|---:|---|---:|');
    refPairs.forEach(([cell, o], i) => {
      const cp = candPairs[i];
      md.push('  | ' + cell + ' | ' + o + ' | ' + cp.selection + ' | ' + cp.odds + ' |');
    });
    md.push('');
  } else {
    md.push('- **1xbet** : ' + (ref ? 'aucun groupe anonyme de 6 issues ne colle aux cotes de reference (' + gx.size + ' groupes anonymes lus)' : 'pas de reference betpawa/congobet pour comparer'));
  }
  md.push('');
}

md.push('## Bilan de disponibilite (sur ' + targets.length + ' matchs populaires)', '');
for (const [bk, n] of Object.entries(availability)) md.push('- ' + bk + ' : ' + n + '/' + targets.length);
md.push('');
if (xbetGroupVotes.size) {
  md.push('## Groupes 1xbet candidats (votes sur les matchs)', '');
  for (const [g, n] of [...xbetGroupVotes.entries()].sort((a, b) => b[1] - a[1])) md.push('- ' + g + ' : ' + n + ' match(s)');
  md.push('');
}
if (onewinNames.size) {
  md.push('## Noms de marches 1win candidats', '');
  for (const n of onewinNames) md.push('- ' + n);
  md.push('');
}

mkdirSync('docs', { recursive: true });
writeFileSync('docs/dc-btts-probe.md', md.join('\n'));
console.log('\nRapport : docs/dc-btts-probe.md');
