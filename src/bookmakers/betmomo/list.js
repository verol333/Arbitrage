import { BETMOMO_SID, swarmSession, isOutright, isVirtual } from './api.js';

export async function listMatches({ live = false, maxMatches, horizonHours = 72, sport = 'football' } = {}) {
  const sid = BETMOMO_SID[sport];
  if (!sid) return [];
  const limit = maxMatches ?? (live ? 300 : 1200);
  const now = Math.floor(Date.now() / 1000);
  const to = now + horizonHours * 3600;
  return swarmSession(async (send) => {
    const where = { sport: { id: sid } };
    where.game = live ? { is_live: 1 } : { start_ts: { '@gt': now, '@lt': to }, is_live: 0 };
    const listData = await send(
      { sport: ['id'], region: ['name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'is_live', 'start_ts', 'info', 'stats'] },
      where,
    );
    const games = [];
    for (const s of Object.values(listData?.sport || {})) {
      for (const g of Object.values(s.game || {})) games.push({ ...g, league: '' });
      for (const r of Object.values(s.region || {})) {
        for (const c of Object.values(r.competition || {})) {
          for (const g of Object.values(c.game || {})) games.push({ ...g, league: c.name || r.name || '' });
        }
      }
    }
    const real = games.filter((g) => !isOutright(g) && !isVirtual(g)).slice(0, limit);
    if (!real.length) return [];
    const BATCH = 30;
    const out = [];
    for (let i = 0; i < real.length; i += BATCH) {
      const chunk = real.slice(i, i + BATCH);
      const ids = chunk.map((g) => g.id);
      const oddsData = await send(
        { game: ['id'], market: ['name', 'type', 'col_count', 'group_name', 'group_id'], event: ['name', 'price', 'base', 'type_1', 'type'] },
        { game: { id: { '@in': ids } } },
      );
      const byId = {};
      for (const g of Object.values(oddsData?.game || {})) byId[g.id] = g;
      for (const g of chunk) {
        const withOdds = byId[g.id];
        const markets = withOdds ? Object.values(withOdds.market || {}) : [];
        const info = g.info || {};
        const s1 = info.score1, s2 = info.score2;
        const score = (s1 != null && s2 != null) ? `${s1}-${s2}` : null;
        const minute = info.current_game_time != null ? Number(info.current_game_time) : null;
        const period = info.current_game_state || null;
        out.push({
          id: g.id, home: g.team1_name, away: g.team2_name, league: g.league || '',
          start: g.start_ts ? g.start_ts * 1000 : null,
          __raw: { markets },
          live: live ? { score, minute: Number.isFinite(minute) ? minute : null, period } : null,
        });
      }
    }
    return out;
  });
}
