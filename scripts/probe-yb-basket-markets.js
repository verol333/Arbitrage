#!/usr/bin/env node
// PROBE YellowBet BASKET — dump complet des marches embarques dans le listing
// (ev.bts du GetEvents), c'est ce que le scanner prematch utilise reellement.
// GetEventDetails 503 systematique, donc inutile de le probe.

import { evapi, BASE_URL } from '../src/bookmakers/yellowbet/api.js';

console.log('▶ PROBE YB BASKET — dump ev.bts embarque dans GetEvents\n');

const url = `${BASE_URL}/event/GetEvents?skip=0&take=500&count=500`;
const data = await evapi(url);
const events = Array.isArray(data?.data) ? data.data : [];
console.log(`GetEvents total : ${events.length}`);

const basket = events.filter((ev) => ev?.sid === 32 && !ev.lv);
console.log(`Basket prematch (sid=32) : ${basket.length}\n`);

if (!basket.length) { console.log('❌ Aucun match basket.'); process.exit(0); }

// Prend les 3 premiers matchs basket
for (const ev of basket.slice(0, 3)) {
  console.log(`══════════════════════════════════════════════════════════════`);
  console.log(`MATCH id=${ev.id} : ${ev.h} vs ${ev.a}`);
  console.log(`  league: ${ev.ln} | start: ${ev.gt}`);
  const bts = Array.isArray(ev.bts) ? ev.bts : [];
  console.log(`  ev.bts count : ${bts.length}\n`);
  if (!bts.length) { console.log('  ⚠️ bts vide dans listing.\n'); continue; }

  for (const b of bts) {
    const oddCount = (b.odds || []).length;
    console.log(`  [bt id=${b.id}] "${b.n}" (${oddCount} odds)`);
    for (const o of (b.odds || []).slice(0, 12)) {
      const parts = [];
      if (o.n != null) parts.push(`n="${o.n}"`);
      if (o.l != null) parts.push(`l=${o.l}`);
      if (o.sp != null) parts.push(`sp=${o.sp}`);
      if (o.hc != null) parts.push(`hc=${o.hc}`);
      if (o.p != null) parts.push(`p=${o.p}`);
      if (o.id != null) parts.push(`id=${o.id}`);
      console.log(`      ${parts.join(' | ')}`);
    }
    if (oddCount > 12) console.log(`      ... +${oddCount - 12} more`);
  }
  console.log('');

  const hcpBts = bts.filter((b) => /handicap|spread|ecart|difference|marge/i.test(String(b?.n || '')));
  console.log(`  ➜ bts nom-like Handicap : ${hcpBts.length}`);
  for (const b of hcpBts) {
    console.log(`     [${b.id}] "${b.n}"`);
    for (const o of (b.odds || []).slice(0, 8)) console.log(`         ${JSON.stringify(o)}`);
  }
  console.log('');
}

console.log('▶ Fin.');
process.exit(0);
