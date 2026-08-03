#!/usr/bin/env node
// Dictionnaire complet BetMomo tennis (BetConstruct SWARM)
// Objectif : lister TOUS les market types + noms + structure outcomes
// Sur 10 matchs pour capturer max variantes

import { swarmSession } from '../src/bookmakers/betmomo/api.js';

await swarmSession(async (send) => {
  const now = Math.floor(Date.now() / 1000);
  const to = now + 72 * 3600;

  // Liste matchs tennis (sport=4)
  const listData = await send(
    { sport: ['id', 'name'], region: ['name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'start_ts'] },
    { sport: { id: 4 }, game: { start_ts: { '@gt': now, '@lt': to }, is_live: 0 } },
  );
  const games = [];
  for (const s of Object.values(listData?.sport || {})) {
    for (const r of Object.values(s.region || {}))
      for (const c of Object.values(r.competition || {}))
        for (const g of Object.values(c.game || {})) games.push({ ...g, league: c.name, region: r.name });
  }
  console.log(`${games.length} matchs tennis dispos\n`);

  // Prendre 5 matchs qui ont des markets (skip 0-markets)
  const sample = [];
  for (const g of games) {
    if (sample.length >= 5) break;
    const oddsData = await send(
      { game: ['id'], market: ['name', 'type', 'group_name', 'col_count'], event: ['name', 'price', 'base', 'type_1', 'type'] },
      { game: { id: g.id } },
    );
    const withOdds = oddsData?.game?.[g.id];
    const markets = withOdds ? Object.values(withOdds.market || {}) : [];
    if (markets.length > 5) sample.push({ ...g, markets });
  }
  console.log(`${sample.length} matchs avec >5 markets\n`);

  // Stats par (type, name) — c'est la vraie signature d'un marché BetConstruct
  const stats = {}; // "type|name" → { count, samples, hasBase, distinctBases }
  for (const g of sample) {
    for (const mk of g.markets) {
      const key = `${mk.type || ''}|${mk.name || ''}`;
      if (!stats[key]) stats[key] = { type: mk.type, name: mk.name, group: mk.group_name, count: 0, hasBase: false, distinctBases: new Set(), samples: [] };
      stats[key].count++;
      const events = Object.values(mk.event || {});
      let anyBase = false;
      for (const e of events) {
        if (e.base != null && e.base !== '') { anyBase = true; stats[key].distinctBases.add(e.base); }
      }
      if (anyBase) stats[key].hasBase = true;
      if (stats[key].samples.length < 2) {
        const outs = events.slice(0, 6).map(e => `${e.type || e.type_1 || ''}"${e.name}"base=${e.base ?? ''}@${e.price}`);
        stats[key].samples.push({ matchLabel: `${g.team1_name} vs ${g.team2_name}`, outcomes: outs });
      }
    }
  }

  console.log(`═══ DICTIONNAIRE : ${Object.keys(stats).length} (type, name) uniques ═══\n`);
  for (const [key, s] of Object.entries(stats).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`\n━━ type="${s.type}" name="${s.name}" ━━`);
    console.log(`  group_name : "${s.group}"`);
    console.log(`  instances : ${s.count}`);
    if (s.hasBase) console.log(`  distinct bases : ${[...s.distinctBases].sort((a, b) => Number(a) - Number(b)).slice(0, 10).join(', ')}`);
    console.log(`  Exemples :`);
    for (const sm of s.samples) {
      console.log(`    [${sm.matchLabel}]`);
      console.log(`      ${sm.outcomes.join(' | ')}`);
    }
  }
});
