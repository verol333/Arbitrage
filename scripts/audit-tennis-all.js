#!/usr/bin/env node
// Audit tennis : pour chaque bookmaker actif, liste les matchs tennis
// PREMATCH et LIVE, dump les cotes parsees + les marches bruts vus mais non
// parses. Permet d'identifier ce qui manque au parseur tennis de chaque book.

import { bookmakers } from '../src/bookmakers/index.js';

async function auditBook(book, live) {
  const mode = live ? 'LIVE' : 'PREMATCH';
  console.log(`\n═══════ ${book.key.toUpperCase()} tennis ${mode} ═══════`);
  try {
    const matches = await book.listMatches({ live, sport: 'tennis' });
    console.log(`  matches: ${matches.length}`);
    if (!matches.length) return;
    // Prendre 3 matches echantillon
    const sample = matches.slice(0, 3);
    for (const m of sample) {
      let odds = {};
      try {
        // IMPORTANT : passer {live, sport, noCache} — sans live, xbet fetche
        // LineFeed pour un match LIVE-only → 0 cles. Prod passe listOpts.
        const opts = { live, sport: 'tennis', noCache: true };
        if (book.getOddsBatch) {
          const map = await book.getOddsBatch([m], opts);
          odds = map.get(m.id) || {};
        } else if (book.getOdds) {
          odds = await book.getOdds(m, opts);
        }
      } catch (e) {
        console.log(`  [${m.home} vs ${m.away}] getOdds error: ${e.message}`);
        continue;
      }
      const keys = Object.keys(odds || {});
      // Groupe cles par famille
      const g = { m1x2: [], total: [], hcp: [], set: [], sN: [], tt: [], other: [] };
      for (const k of keys) {
        if (k === 'match_1' || k === 'match_2') g.m1x2.push(`${k}=${odds[k]}`);
        else if (/^match_(over|under)_/.test(k)) g.total.push(`${k}=${odds[k]}`);
        else if (/^hcp_/.test(k)) g.hcp.push(`${k}=${odds[k]}`);
        else if (/^set_hcp_|^set_over_|^set_under_/.test(k)) g.set.push(`${k}=${odds[k]}`);
        else if (/^s[1-5]_/.test(k)) g.sN.push(`${k}=${odds[k]}`);
        else if (/^tt_/.test(k)) g.tt.push(`${k}=${odds[k]}`);
        else g.other.push(`${k}=${odds[k]}`);
      }
      console.log(`\n  ── ${m.home} vs ${m.away} (${keys.length} cles parsees) ──`);
      for (const [cat, list] of Object.entries(g)) {
        if (list.length) console.log(`    [${cat}] ${list.join(' | ')}`);
      }
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
}

for (const book of bookmakers) {
  if (book.supports?.prematch) await auditBook(book, false);
  if (book.supports?.live) await auditBook(book, true);
}

process.exit(0);
