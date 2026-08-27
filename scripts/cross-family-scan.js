#!/usr/bin/env node
// SCAN CROISE DES FAMILLES INEXPLOITEES.
// Cible les familles listees dans docs/combinaisons-arbitrage.md et cherche des
// partitions FERMEES (toutes les issues couvertes une fois et une seule) dont la
// somme des probabilites implicites descend sous 1 en prenant la meilleure cote
// de chaque issue chez des books differents.
//
// Ne place rien : lecture seule. Sortie console + docs/cross-family-scan.md
// Deux volets :
//   1. les surebets detectes (avec book de chaque jambe)
//   2. les libelles bruts reellement vus par famille et par book, pour verifier
//      que le decodage colle a la realite avant d'industrialiser quoi que ce soit.
import { writeFileSync, mkdirSync } from 'node:fs';
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';
import { rawOutcomes, RAW_BOOKS } from '../src/foot/rawOutcomes.js';
import { classify, strip } from '../src/foot/families.js';

const TOP_MATCHES = Number(process.env.TOP_MATCHES || 12);
const HORIZON_HOURS = Number(process.env.HORIZON_HOURS || 48);
const MIN_PROFIT = Number(process.env.MIN_PROFIT || 0.5); // en %

// ---------- decodage des issues, famille par famille ----------
// Chaque decodeur renvoie un identifiant d'issue canonique, ou null si le
// libelle n'est pas reconnu (on ne devine jamais).

const YES = /(^|\b)(oui|yes|si)(\b|$)/;
const NO = /(^|\b)(non|no)(\b|$)/;

function binaryYesNo(sel) {
  const s = strip(sel);
  if (YES.test(s)) return 'YES';
  if (NO.test(s)) return 'NO';
  return null;
}

// HTFT : deux resultats successifs parmi 1 / X / 2. Accepte "1/1", "1:X",
// "Home/Draw", "domicile/nul".
function htftIssue(sel) {
  const s = strip(sel);
  const tok = (w) => {
    if (/^(1|home|dom|domicile|p1)$/.test(w)) return '1';
    if (/^(x|nul|draw|egalite|tie)$/.test(w)) return 'X';
    if (/^(2|away|ext|exterieur|p2)$/.test(w)) return '2';
    return null;
  };
  const parts = s.split(/[\/:\-–>]+|\band\b|\bpuis\b/).map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  const a = tok(parts[0]);
  const b = tok(parts[1]);
  return a && b ? a + '/' + b : null;
}

// MULTIGOALS : intervalles de buts "0-1", "2 a 3", "4-6", "7+".
function multigoalsRange(sel) {
  const s = strip(sel).replace(/buts?|goals?/g, ' ');
  let m = s.match(/(\d+)\s*(?:-|a|to|:)\s*(\d+)/);
  if (m) return [Number(m[1]), Number(m[2])];
  m = s.match(/(\d+)\s*\+/);
  if (m) return [Number(m[1]), 99];
  m = s.match(/^(\d+)$/);
  if (m) return [Number(m[1]), Number(m[1])];
  return null;
}

// Familles binaires exploitables telles quelles : une issue Oui, une issue Non,
// donc partition fermee a deux jambes des que deux books la cotent.
const BINARY_FAMS = ['BOTH_HALVES_SCORE', 'CLEAN_SHEET', 'WIN_TO_NIL', 'QUALIFY'];

// ---------- collecte ----------
const t0 = Date.now();
console.log('=== SCAN CROISE FAMILLES INEXPLOITEES ===');
console.log('matchs ' + TOP_MATCHES + ' | horizon ' + HORIZON_HOURS + 'h | marge mini ' + MIN_PROFIT + '%');

const catalogs = new Map();
for (const key of RAW_BOOKS) {
  const book = bookmakersByKey[key];
  if (!book) continue;
  try {
    const matches = await book.listMatches({ live: false, sport: 'football', horizonHours: HORIZON_HOURS });
    catalogs.set(key, matches);
    console.log('[' + key + '] ' + matches.length + ' matchs');
  } catch (e) {
    console.log('[' + key + '] listMatches KO : ' + e.message);
  }
}
const entries = alignCatalogs(catalogs, { minBooks: 2, horizonMs: Date.now() + HORIZON_HOURS * 3600 * 1000 });
entries.sort((a, b) => Object.keys(b.matches).length - Object.keys(a.matches).length || (a.ref.start || 0) - (b.ref.start || 0));
const targets = entries.slice(0, TOP_MATCHES);
console.log(entries.length + ' matchs apparies, ' + targets.length + ' scannes\n');

const finds = [];
const labelSamples = new Map(); // famille -> book -> Set(libelles)

const noteLabel = (fam, book, market, sel) => {
  if (!labelSamples.has(fam)) labelSamples.set(fam, new Map());
  const per = labelSamples.get(fam);
  if (!per.has(book)) per.set(book, new Set());
  const set = per.get(book);
  if (set.size < 14) set.add(market + ' >> ' + sel);
};

const best = (map, key, odds, book, label) => {
  const cur = map.get(key);
  if (!cur || odds > cur.odds) map.set(key, { odds, book, label });
};

for (const entry of targets) {
  const label = entry.ref.home + ' vs ' + entry.ref.away;
  const perBook = await Promise.all(
    Object.entries(entry.matches)
      .filter(([k]) => RAW_BOOKS.includes(k))
      .map(async ([key, m]) => ({ key, ...(await rawOutcomes(key, m.id)) }))
  );

  // buckets : famille -> marche natif normalise -> issue -> meilleure cote
  const htft = new Map();
  const binaries = new Map(); // fam|marche -> issue -> best
  const ranges = new Map();   // marche -> [{lo,hi,odds,book,label}]

  for (const r of perBook) {
    if (r.error || !r.outcomes.length) continue;
    for (const o of r.outcomes) {
      const fam = classify(o.market, o.selection);
      if (fam === 'HTFT') {
        noteLabel(fam, r.key, o.market, o.selection);
        const iss = htftIssue(o.selection);
        if (iss) best(htft, iss, o.odds, r.key, o.selection);
      } else if (fam === 'MULTIGOALS') {
        noteLabel(fam, r.key, o.market, o.selection);
        const rg = multigoalsRange(o.selection);
        if (rg) {
          if (!ranges.has('MULTIGOALS')) ranges.set('MULTIGOALS', []);
          ranges.get('MULTIGOALS').push({ lo: rg[0], hi: rg[1], odds: o.odds, book: r.key, label: o.selection });
        }
      } else if (BINARY_FAMS.includes(fam)) {
        noteLabel(fam, r.key, o.market, o.selection);
        const iss = binaryYesNo(o.selection);
        if (!iss) continue;
        // La cle inclut le libelle du marche : "clean sheet domicile" et
        // "clean sheet exterieur" sont deux partitions distinctes.
        const k = fam + ' | ' + strip(o.market);
        if (!binaries.has(k)) binaries.set(k, new Map());
        best(binaries.get(k), iss, o.odds, r.key, o.selection);
      }
    }
  }

  const record = (family, legs) => {
    const inv = legs.reduce((s, l) => s + 1 / l.odds, 0);
    const books = new Set(legs.map((l) => l.book));
    if (books.size < 2) return;
    const profit = (1 / inv - 1) * 100;
    if (profit >= MIN_PROFIT) finds.push({ match: label, family, profit, inv, legs });
  };

  // HTFT : les 9 issues doivent etre toutes presentes.
  const NINE = ['1/1', '1/X', '1/2', 'X/1', 'X/X', 'X/2', '2/1', '2/X', '2/2'];
  if (NINE.every((k) => htft.has(k))) {
    record('HTFT (9 issues)', NINE.map((k) => ({ issue: k, ...htft.get(k) })));
  }

  // Familles binaires : Oui + Non.
  for (const [k, m] of binaries) {
    if (m.has('YES') && m.has('NO')) {
      record(k, [{ issue: 'OUI', ...m.get('YES') }, { issue: 'NON', ...m.get('NO') }]);
    }
  }

  // MULTIGOALS : couverture greedy de 0 a l'infini par intervalles contigus.
  for (const [fam, list] of ranges) {
    const byLo = new Map();
    for (const r of list) {
      const key = r.lo + '-' + r.hi;
      const cur = byLo.get(key);
      if (!cur || r.odds > cur.odds) byLo.set(key, r);
    }
    const sorted = [...byLo.values()].sort((a, b) => a.lo - b.lo || b.hi - a.hi);
    const legs = [];
    let next = 0;
    for (const r of sorted) {
      if (r.lo === next) { legs.push({ issue: r.lo + '-' + (r.hi === 99 ? '+' : r.hi), ...r }); next = r.hi + 1; }
      if (r.hi === 99 && r.lo === legs.at(-1)?.lo) break;
    }
    const closed = legs.length > 1 && legs.at(-1).hi === 99;
    if (closed) record(fam + ' (intervalles)', legs);
  }

  console.log('- ' + label + ' : ' + perBook.filter((r) => r.outcomes.length).length + ' books lus');
}

// ---------- rapport ----------
finds.sort((a, b) => b.profit - a.profit);
const md = ['# Scan croise des familles inexploitees', '', 'Genere le ' + new Date().toISOString(), '',
  'Matchs scannes : ' + targets.length + ' | marge minimale retenue : ' + MIN_PROFIT + '%', ''];

md.push('## Partitions fermees rentables', '');
if (!finds.length) {
  md.push('Aucune partition fermee ne passe le seuil sur cet echantillon.');
} else {
  for (const f of finds.slice(0, 40)) {
    md.push('### ' + f.family + ' — ' + f.match + ' — marge ' + f.profit.toFixed(2) + '%');
    md.push('');
    md.push('| Issue | Book | Cote | Libelle natif |');
    md.push('|---|---|---:|---|');
    for (const l of f.legs) md.push('| ' + l.issue + ' | ' + l.book + ' | ' + l.odds + ' | ' + String(l.label).replace(/\|/g, '/').slice(0, 50) + ' |');
    md.push('');
  }
}
md.push('');
md.push('## Libelles bruts vus (verification du decodage)', '');
for (const [fam, per] of labelSamples) {
  md.push('### ' + fam);
  md.push('');
  for (const [book, set] of per) {
    md.push('- **' + book + '** : ' + [...set].map((s) => s.replace(/\|/g, '/')).join(' ; '));
  }
  md.push('');
}

mkdirSync('docs', { recursive: true });
writeFileSync('docs/cross-family-scan.md', md.join('\n'));
console.log('\n' + md.join('\n'));
console.log('\nPartitions rentables : ' + finds.length + ' | duree ' + Math.round((Date.now() - t0) / 1000) + 's');
