#!/usr/bin/env node
// Diagnostic probe: dumps raw BetMomo market structures for tennis + football.
// Run locally: node scripts/probe-betmomo-markets.js
// Purpose: verify that market type → odds key mappings are correct.
// Outputs raw market type, group_name, group_id, event type_1, base, price
// for each match, then shows what our parser produces.
import { BETMOMO_SID, swarmSession } from '../src/bookmakers/betmomo/api.js';
import { betmomoFlatOdds } from '../src/bookmakers/betmomo/parse.js';

const SPORTS = ['tennis', 'football'];

for (const sport of SPORTS) {
  const sid = BETMOMO_SID[sport];
  if (!sid) { console.log(`[SKIP] No SID for ${sport}`); continue; }
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${sport.toUpperCase()} (sportId=${sid})`);
  console.log('═'.repeat(60));

  try {
    await swarmSession(async (send) => {
      const now = Math.floor(Date.now() / 1000);
      const where = {
        sport: { id: sid },
        game: { start_ts: { '@gt': now, '@lt': now + 24 * 3600 }, is_live: 0 },
      };
      const listData = await send(
        { sport: ['id'], region: ['name'], competition: ['name'],
          game: ['id', 'team1_name', 'team2_name', 'start_ts'] },
        where,
      );
      const games = [];
      for (const s of Object.values(listData?.sport || {})) {
        for (const r of Object.values(s.region || {})) {
          for (const c of Object.values(r.competition || {})) {
            for (const g of Object.values(c.game || {})) {
              games.push({ ...g, league: c.name || r.name || '' });
            }
          }
        }
      }
      console.log(`  Found ${games.length} games (next 24h prematch)`);
      const sample = games.slice(0, 2);
      for (const g of sample) {
        console.log(`\n  ── ${g.team1_name} vs ${g.team2_name} (id=${g.id}) ──`);
        console.log(`     League: ${g.league}`);
        const oddsData = await send(
          { game: ['id'],
            market: ['name', 'type', 'col_count', 'group_name', 'group_id'],
            event: ['name', 'price', 'base', 'type_1', 'type'] },
          { game: { id: { '@in': [g.id] } } },
        );
        const gData = Object.values(oddsData?.game || {})[0];
        const markets = gData ? Object.values(gData.market || {}) : [];
        console.log(`     ${markets.length} raw markets`);
        const seen = new Set();
        for (const m of markets) {
          const key = `${m.type}|${m.group_name || ''}|${m.group_id || ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const evts = Array.isArray(m.event) ? m.event : Object.values(m.event || {});
          const sample3 = evts.filter(e => e.price > 1).slice(0, 4);
          const evStr = sample3.map(e =>
            `${e.type_1 || e.type}=${e.price}${e.base != null ? ` b=${e.base}` : ''}`
          ).join(' | ');
          console.log(`     type="${m.type}" group="${m.group_name || ''}" gid=${m.group_id || ''} name="${m.name || ''}" → ${evStr}`);
        }
        const parsed = betmomoFlatOdds(markets);
        const keys = Object.keys(parsed).sort();
        console.log(`     ── Parsed odds (${keys.length} keys) ──`);
        for (const k of keys) console.log(`       ${k} = ${parsed[k]}`);
      }
    });
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
}
