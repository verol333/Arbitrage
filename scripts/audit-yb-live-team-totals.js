#!/usr/bin/env node
// Diagnostic YB LIVE team totals : le user rapporte que YB donne des cotes
// FAKE pour "Total Dom." / "Total Ext." sur matchs argentins live (ex Total
// Ext. -3.5 = 2.05 alors que la vraie cote sur le site YB est differente).
// Cette audit :
// 1. Fetch YB LIVE, cherche matchs argentins (Banfield, Sarmiento, Tigre,
//    Nacional, San Lorenzo, Gimnasia)
// 2. Pour chaque match trouve, dump TOUS les marches bruts contenant "total"
//    ou le nom d'equipe → identifie ce que YB expose reellement
// 3. Passe par le parseur → compare cle produite vs raw

import { evapi } from '../src/bookmakers/yellowbet/api.js';
import { yellowbetFlatOdds } from '../src/bookmakers/yellowbet/parse.js';

const TARGETS = ['banfield', 'sarmiento', 'tigre', 'nacional', 'san lorenzo', 'gimnasia'];

console.log('=== Fetch YB LIVE ===');
const url = 'https://yellowbet.cg/services/evapi/event/GetEvents?isLive=true&count=500&take=500';
const j = await evapi(url);
const events = (j?.data || []).filter((e) => e.sid === 31 && e.bts?.length && e.lv);
console.log(`Total YB LIVE foot events (with ev.lv): ${events.length}`);

// Filtre matchs argentins
const argentine = events.filter((e) => {
  const s = `${e.h} ${e.a}`.toLowerCase();
  return TARGETS.some((t) => s.includes(t));
});
console.log(`Matchs argentins cible: ${argentine.length}`);

for (const ev of argentine) {
  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(`═══ ${ev.h} vs ${ev.a} | id=${ev.id} | ${ev.bts.length} markets ═══`);
  console.log(`════════════════════════════════════════════════════════════`);
  // Score/minute
  let lv = null;
  try { lv = typeof ev.lv === 'string' ? JSON.parse(ev.lv) : ev.lv; } catch { /* ignore */ }
  if (lv) console.log(`  live state: score=${lv.hs}-${lv.as} min=${lv.t}' period=${lv.p}`);

  // 1) TOUS les marches contenant "total" ou le nom d'une equipe
  console.log(`\n  ─── MARCHES BRUTS 'total' ou avec nom equipe ───`);
  const homeTokens = ev.h.toLowerCase().split(/\s+/).filter((t) => t.length >= 4);
  const awayTokens = ev.a.toLowerCase().split(/\s+/).filter((t) => t.length >= 4);
  for (const bt of ev.bts) {
    const nm = String(bt.n || '').toLowerCase();
    const hasTotal = /total/.test(nm);
    const hasHomeName = homeTokens.some((t) => nm.includes(t));
    const hasAwayName = awayTokens.some((t) => nm.includes(t));
    if (!hasTotal && !hasHomeName && !hasAwayName) continue;
    const sample = (bt.odds || []).map((o) => {
      const line = o.l != null ? ` l=${o.l}` : (o.sp != null ? ` sp=${o.sp}` : '');
      return `${o.n || o.id}=${o.p}${line}`;
    });
    console.log(`    "${bt.n}" (${(bt.odds || []).length}): ${sample.join(' | ')}`);
  }

  // 2) Parseur output — cles tt_home_*, tt_away_*, match_over_*
  console.log(`\n  ─── CLES tt_* et match_over/under_* parsees ───`);
  const parsed = yellowbetFlatOdds(ev.bts, { home: ev.h, away: ev.a });
  const relevant = Object.entries(parsed).filter(([k]) => /^tt_|^match_(over|under)_|^ht_over|^h2_over|^ht_under|^h2_under/.test(k));
  for (const [k, v] of relevant) console.log(`    ${k} = ${v}`);
  if (!relevant.length) console.log(`    (aucune cle tt/match_over produite)`);
}

process.exit(0);
