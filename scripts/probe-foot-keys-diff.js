#!/usr/bin/env node
// PROBE FOOT KEYS DIFF — pour un match foot donne (search par team-name),
// fetch cotes sur les 9 books et dump les CLES produites par chaque parseur
// cote a cote. Objectif : identifier POURQUOI YellowBet/Apollo/PremierBet
// n'apparaissent JAMAIS dans les opps foot confirmees malgre 200-635 cotes
// lues par cycle.
//
// Hypothese : convention de cle differente (ex: `over_2.5` chez YB vs
// `match_over_2.5` chez 1xbet), donc jamais matched dans compareTwoBooks.
//
// Usage :
//   MATCH_SEARCH="Norwich" node scripts/probe-foot-keys-diff.js
import { bookmakers } from '../src/bookmakers/index.js';

const SEARCH = (process.env.MATCH_SEARCH || '').trim();
if (!SEARCH) { console.error('MATCH_SEARCH requis'); process.exit(1); }

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const matches = (m, q) => norm(m.home).includes(norm(q)) || norm(m.away).includes(norm(q));

console.log(`▶ PROBE FOOT KEYS DIFF — search="${SEARCH}"\n`);

// Etape 1 : trouver le match sur chaque book
const perBook = {};
await Promise.all(bookmakers.filter(b => b.supports.prematch).map(async (b) => {
  try {
    const list = await b.listMatches({ live: false, sport: 'football' });
    const found = (list || []).filter(m => matches(m, SEARCH));
    perBook[b.key] = { book: b, list: found };
    if (found.length) console.log(`[${b.key}] found ${found.length}: ${found.slice(0,2).map(m=>`"${m.home} vs ${m.away}"`).join(' | ')}`);
    else console.log(`[${b.key}] no match (catalog=${list?.length || 0})`);
  } catch (e) {
    console.log(`[${b.key}] listMatches ERR: ${e.message}`);
    perBook[b.key] = { book: b, list: [] };
  }
}));

const found = Object.entries(perBook).filter(([, v]) => v.list.length > 0);
if (!found.length) { console.log('❌ Aucun book trouve le match'); process.exit(0); }

console.log(`\n══════════════════════════════════════════════════════════`);
console.log(`ETAPE 2 : fetch cotes + dump cles produites par chaque parseur`);
console.log(`══════════════════════════════════════════════════════════\n`);

const oddsPerBook = {};
for (const [key, { book, list }] of found) {
  const m = list[0];
  console.log(`\n[${key}] "${m.home} vs ${m.away}" (id=${m.id})`);
  try {
    const odds = await book.getOdds(m, { live: false, noCache: true, sport: 'football' });
    oddsPerBook[key] = odds || {};
    const keys = Object.keys(oddsPerBook[key]).sort();
    console.log(`  ${keys.length} cles produites :`);
    // Grouper par prefixe pour lisibilite
    const groups = {};
    for (const k of keys) {
      const prefix = k.split('_')[0]; // match, hcp, dc, btts, dnb, ht, h2, cor, tt, odd, even, ...
      if (!groups[prefix]) groups[prefix] = [];
      groups[prefix].push(k);
    }
    for (const [prefix, ks] of Object.entries(groups).sort()) {
      console.log(`    ${prefix.padEnd(6)} (${ks.length}) : ${ks.slice(0, 8).join(', ')}${ks.length > 8 ? ' ...' : ''}`);
    }
  } catch (e) {
    console.log(`  getOdds ERR: ${e.message}`);
    oddsPerBook[key] = {};
  }
}

console.log(`\n══════════════════════════════════════════════════════════`);
console.log(`ETAPE 3 : CROSS-BOOK — cles COMMUNES a >= 2 books (arb possible)`);
console.log(`══════════════════════════════════════════════════════════\n`);
const keyToBooks = {};
for (const [book, odds] of Object.entries(oddsPerBook)) {
  for (const k of Object.keys(odds || {})) {
    if (!keyToBooks[k]) keyToBooks[k] = [];
    keyToBooks[k].push(book);
  }
}
const commonKeys = Object.entries(keyToBooks).filter(([, bs]) => bs.length >= 2);
const singleKeys = Object.entries(keyToBooks).filter(([, bs]) => bs.length === 1);
console.log(`  ${commonKeys.length} cles PARTAGEES (≥2 books) — potentiel arb`);
console.log(`  ${singleKeys.length} cles ORPHELINES (1 seul book) — gaspillees`);

// Compter les cles orphelines par book (books solitaires = mapping decale)
const orphanByBook = {};
for (const [k, bs] of singleKeys) {
  const b = bs[0];
  if (!orphanByBook[b]) orphanByBook[b] = 0;
  orphanByBook[b]++;
}
console.log(`\n  Cles orphelines (jamais matchees cross-book) par book :`);
for (const [b, n] of Object.entries(orphanByBook).sort((a,z)=>z[1]-a[1])) {
  const total = Object.keys(oddsPerBook[b] || {}).length;
  const pct = total ? Math.round(100 * n / total) : 0;
  const flag = pct > 60 ? '🚨 mapping decale' : pct > 30 ? '⚠️ suspect' : '';
  console.log(`    ${b.padEnd(12)} ${n}/${total} cles orphelines (${pct}%) ${flag}`);
}

// Focus : lister les cles orphelines des books suspects (YB/Apollo/PB)
console.log(`\n══════════════════════════════════════════════════════════`);
console.log(`ETAPE 4 : cles orphelines des books ZERO OPPS (YB/Apollo/PB)`);
console.log(`══════════════════════════════════════════════════════════\n`);
for (const susp of ['yellowbet', 'apollo', 'premierbet']) {
  if (!oddsPerBook[susp]) continue;
  const orphans = singleKeys.filter(([, bs]) => bs[0] === susp).map(([k]) => k);
  console.log(`\n[${susp}] ${orphans.length} cles orphelines (jamais partagees) :`);
  // Grouper par prefixe
  const g = {};
  for (const k of orphans) {
    const p = k.split('_')[0];
    if (!g[p]) g[p] = [];
    g[p].push(k);
  }
  for (const [p, ks] of Object.entries(g).sort()) {
    console.log(`    ${p.padEnd(6)} (${ks.length}) : ${ks.slice(0, 6).join(', ')}${ks.length > 6 ? ' ...' : ''}`);
  }
}

process.exit(0);
