// Audit BetMomo tous sports : prend un match par sport, dump les market types
// distincts et vérifie ce que parseur produit. But: identifier autres
// mismappings potentiels comme on l'a fait pour volleyball.
import { swarmSession, BETMOMO_SID } from '../src/bookmakers/betmomo/api.js';
import { betmomoFlatOdds } from '../src/bookmakers/betmomo/parse.js';

const results = {};

for (const sport of ['football', 'tennis', 'basketball', 'hockey', 'volleyball']) {
  try {
    const out = await swarmSession(async (send) => {
      const listData = await send(
        { sport: ['id'], region: ['name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'start_ts'] },
        { sport: { id: BETMOMO_SID[sport] }, game: { start_ts: { '@gt': Math.floor(Date.now() / 1000) } } },
      );
      const games = [];
      for (const s of Object.values(listData?.sport || {})) {
        for (const g of Object.values(s.game || {})) games.push({ ...g, league: '' });
        for (const r of Object.values(s.region || {})) {
          for (const c of Object.values(r.competition || {})) {
            for (const g of Object.values(c.game || {})) games.push({ ...g, league: c.name || '' });
          }
        }
      }
      // Filtre outrights basiques
      const real = games.filter((g) => g.team1_name && g.team2_name && !/outright|winner|championship/i.test(String(g.team1_name)));
      if (!real.length) return { error: 'no real match' };
      // Prend un match avec beaucoup de marchés (pas le 1er qui est souvent l'outright)
      const g0 = real[0];
      const oddsData = await send(
        { game: ['id'], market: ['name', 'type', 'group_name'], event: ['name', 'price', 'base', 'type_1'] },
        { game: { id: g0.id } },
      );
      const g = Object.values(oddsData?.game || {})[0];
      const markets = g ? Object.values(g.market || {}) : [];
      const parsed = betmomoFlatOdds(markets);
      // Group raw markets by type + count
      const byType = {};
      for (const m of markets) {
        const k = m.type;
        if (!byType[k]) byType[k] = { count: 0, sample_group: m.group_name, sample_event: null };
        byType[k].count++;
        if (!byType[k].sample_event) {
          const evs = Array.isArray(m.event) ? m.event : Object.values(m.event || {});
          const e0 = evs[0];
          if (e0) byType[k].sample_event = { type_1: e0.type_1, base: e0.base, price: e0.price };
        }
      }
      return {
        match: `${g0.team1_name} vs ${g0.team2_name}`,
        market_count: markets.length,
        market_types_stats: byType,
        parsed_count: Object.keys(parsed).length,
        parsed: parsed,
      };
    });
    results[sport] = out;
  } catch (e) { results[sport] = { error: e.message }; }
}

console.log('=== BETMOMO ALL SPORTS AUDIT START ===');
console.log(JSON.stringify(results, null, 2));
console.log('=== BETMOMO ALL SPORTS AUDIT END ===');
process.exit(0);
