#!/usr/bin/env node
// PROBE BASKET DISCOVERY — Congobet + PremierBet basket
// Fetch RAW markets pour identifier betTypeIds/marketIds basket a mapper.
// Objectif : donner au parseur les IDs pour couvrir 1X2, Handicap, Total.
import { bookmakers } from '../src/bookmakers/index.js';
import { CONGO_API, congoJson } from '../src/bookmakers/congobet/api.js';
import { mget } from '../src/bookmakers/premierbet/api.js';

console.log('▶ PROBE BASKET DISCOVERY — CongoBet + PremierBet\n');

// ═══════════════════════════════════════════════════════════════
// 1) CONGOBET basket — dump betTypeIds sur 3 matchs WNBA/NBA
// ═══════════════════════════════════════════════════════════════
console.log('════════════ CONGOBET BASKET ════════════\n');
const cb = bookmakers.find(b => b.key === 'congobet');
try {
  const matches = await cb.listMatches({ live: false, horizonHours: 72, sport: 'basket' });
  console.log(`  ${matches.length} matchs listes\n`);
  const sample = matches.slice(0, 3);
  const btStats = {}; // betTypeId -> { name, count, sample_items }
  for (const m of sample) {
    console.log(`  ▶ ${m.home} vs ${m.away}  id=${m.id}`);
    const evt = await congoJson(`${CONGO_API}events/${m.id}`);
    if (!evt?.eventBetTypes) { console.log(`    (no eventBetTypes)`); continue; }
    for (const bt of evt.eventBetTypes) {
      const id = String(bt.betTypeId);
      if (!btStats[id]) btStats[id] = { name: bt.name || bt.betTypeName || '?', count: 0, samples: [] };
      btStats[id].count++;
      if (btStats[id].samples.length < 2) {
        const items = (bt.eventBetTypeItems || []).slice(0, 6).map(it => `${it.shortName}=${it.odds}`);
        btStats[id].samples.push({ match: `${m.home}-${m.away}`, items });
      }
    }
  }
  console.log(`\n  ═══ BetTypeIds observes (${Object.keys(btStats).length}) ═══`);
  for (const [id, s] of Object.entries(btStats).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`  betTypeId=${id}  "${s.name}"  (${s.count} matchs)`);
    for (const sm of s.samples) console.log(`     [${sm.match}] ${sm.items.join(' | ')}`);
  }
} catch (e) { console.log('  ERR:', e.message); }

// ═══════════════════════════════════════════════════════════════
// 2) PREMIERBET basket — dump marketIds sur match riche
// ═══════════════════════════════════════════════════════════════
console.log('\n\n════════════ PREMIERBET BASKET ════════════\n');
const pb = bookmakers.find(b => b.key === 'premierbet');
try {
  const matches = await pb.listMatches({ live: false, horizonHours: 72, sport: 'basket' });
  console.log(`  ${matches.length} matchs listes\n`);
  // Prendre matchs avec marketCount eleve
  const sortedMatches = matches.slice(0, 5);
  const mkStats = {};
  for (const m of sortedMatches) {
    console.log(`  ▶ ${m.home} vs ${m.away}  id=${m.id}`);
    const evtJ = await mget(`/events/${m.id}`, {}, 15000);
    const event = evtJ?.data || evtJ;
    const groups = event?.marketGroups || [];
    let totalMk = 0;
    for (const g of groups) {
      for (const mk of (g.markets || [])) {
        totalMk++;
        const id = String(mk.id);
        if (!mkStats[id]) mkStats[id] = { name: mk.name || '?', groups: new Set(), samples: [] };
        mkStats[id].groups.add(g.name);
        if (mkStats[id].samples.length < 2) {
          const outs = (mk.outcomes || []).slice(0, 6).map(o => `"${o.name}"h=${o.handicap ?? ''}=${o.value}`);
          mkStats[id].samples.push({ match: `${m.home}-${m.away}`, outs });
        }
      }
    }
    console.log(`    ${totalMk} markets dans ${groups.length} groups`);
  }
  console.log(`\n  ═══ MarketIds observes (${Object.keys(mkStats).length}) ═══`);
  for (const [id, s] of Object.entries(mkStats).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`  marketId=${id}  "${s.name}"  groups=[${[...s.groups].join(',')}]`);
    for (const sm of s.samples) console.log(`     [${sm.match}] ${sm.outs.join(' | ')}`);
  }
} catch (e) { console.log('  ERR:', e.message); }

console.log('\n═══ FIN — utilise ces IDs pour mapper les parseurs congobet/premierbet basket ═══');
process.exit(0);
