#!/usr/bin/env node
// PROBE BetMomo hockey RAW — dump vrais types SWARM pour un match hockey
// Objectif : identifier types (type/name/type_1) hockey pour ajuster parseur.
import { swarmSession, BETMOMO_SITE_ID } from '../src/bookmakers/betmomo/api.js';

console.log('▶ PROBE BetMomo HOCKEY RAW\n');

try {
  await swarmSession(async (send) => {
    // Fetch un match hockey (sportId=2)
    const data = await send(
      { sport: ['id'], region: ['name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name'], market: ['name', 'type', 'col_count', 'group_name', 'group_id'], event: ['name', 'price', 'base', 'type_1', 'type'] },
      { sport: { id: { '@eq': 2 } } },
    );
    // Trouve premier match avec markets non vides
    let sample = null;
    for (const s of Object.values(data?.sport || {})) {
      for (const r of Object.values(s.region || {})) {
        for (const c of Object.values(r.competition || {})) {
          for (const g of Object.values(c.game || {})) {
            if (g.team1_name && g.team2_name && g.market && Object.keys(g.market).length > 0) {
              sample = { g, region: r.name, comp: c.name };
              break;
            }
          }
          if (sample) break;
        }
        if (sample) break;
      }
      if (sample) break;
    }
    if (!sample) { console.log('  Aucun match hockey avec markets'); return; }
    const { g, region, comp } = sample;
    console.log(`  ▶ ${g.team1_name} vs ${g.team2_name}  [${region}/${comp}]  id=${g.id}`);
    const markets = Object.values(g.market || {});
    console.log(`  ${markets.length} markets\n`);
    // Group par type
    const byType = {};
    for (const m of markets) {
      const t = m.type || '?';
      if (!byType[t]) byType[t] = [];
      byType[t].push(m);
    }
    console.log(`  ${Object.keys(byType).length} types distincts :\n`);
    for (const [t, mks] of Object.entries(byType)) {
      console.log(`  type="${t}"  (${mks.length} markets)`);
      // Sample 1 par type
      const sm = mks[0];
      console.log(`     name="${sm.name}"  group_name="${sm.group_name}"  group_id=${sm.group_id}`);
      const evs = Object.values(sm.event || {}).slice(0, 5);
      for (const e of evs) {
        console.log(`     event type="${e.type}" type_1="${e.type_1}" name="${e.name}" base=${e.base} price=${e.price}`);
      }
    }
  });
} catch (e) { console.log('ERR:', e.message); }

console.log('\n═══ FIN ═══');
process.exit(0);
