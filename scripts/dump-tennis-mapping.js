#!/usr/bin/env node
// Dump v3 : focus sur premierbet (guineegames sportId=5) + betmomo (trouver tennis)
import { fetchJson } from '../src/net/fetcher.js';

const dumpMatch = (label, m) => {
  console.log(`\n  ┌── ${label}`);
  console.log(`  │ home: ${m.home}`);
  console.log(`  │ away: ${m.away}`);
  console.log(`  │ league: ${m.league || '?'}`);
  console.log(`  │ start: ${m.start ? new Date(m.start).toISOString() : '?'}`);
  console.log(`  │ id: ${m.id}`);
};

// ═══════════════════════════════════════════════════════════════
// PREMIERBET (guineegames) — sportId=5 supposé tennis, dump names + markets
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ PREMIERBET (guineegames) sportId=5 (tennis?) — dump avec noms ════════════');
try {
  const HDR = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://www.guineegames.com/',
  };
  const params = 'country=GN&group=g6&platform=desktop&locale=fr';
  const date = new Date().toISOString().slice(0, 10);
  const url = `https://sports-api.guineegames.com/v1/events/upcoming?${params}&sportId=5&timeOffset=-60&date=${date}`;
  const j = await fetchJson(url, { headers: HDR, timeoutMs: 20000 });
  console.log(`  status=${j ? 'OK' : 'null'} keys=${j ? Object.keys(j).join(',') : ''}`);
  if (j?.data) {
    const cats = j.data.categories || (Array.isArray(j.data) ? j.data : []);
    console.log(`  ${cats.length} categories`);
    let firstEv = null;
    for (const c of cats) {
      console.log(`    category "${c.name || '?'}" competitions=${(c.competitions || c.tournaments || []).length}`);
      for (const comp of (c.competitions || c.tournaments || []).slice(0, 3)) {
        const evs = comp.events || [];
        console.log(`      ${comp.name || '?'} : ${evs.length} events`);
        for (const e of evs.slice(0, 2)) {
          const names = e.competitors?.map(x => x.name) || e.teams?.map(x => x.name) || e.eventNames || [];
          console.log(`        ev.id=${e.id} keys=[${Object.keys(e).slice(0, 8).join(',')}] names="${names.join(' vs ')}"`);
          if (!firstEv) firstEv = e;
        }
      }
    }

    // Fetch 1 evt pour voir markets
    if (firstEv) {
      console.log(`\n  --- Fetch /events/${firstEv.id} pour dump markets ---`);
      const evtUrl = `https://sports-api.guineegames.com/v1/events/${firstEv.id}?${params}`;
      const evt = await fetchJson(evtUrl, { headers: HDR, timeoutMs: 15000 });
      const event = evt?.data || evt;
      const marketGroups = event?.marketGroups || [];
      console.log(`  event keys : ${Object.keys(event || {}).join(',')}`);
      console.log(`  ${marketGroups.length} market groups :`);
      for (const g of marketGroups) {
        console.log(`    groupe "${g.name}" : ${(g.markets || []).length} markets`);
        for (const mk of (g.markets || []).slice(0, 5)) {
          const outs = (mk.outcomes || []).slice(0, 6).map(o => `${o.name}=${o.value}`).join(' | ');
          console.log(`      id=${mk.id} "${mk.name}" → ${outs}`);
        }
      }
    }
  }
} catch (e) { console.log(`  ERR ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// BETMOMO — probe sports pour identifier tennis (pas table tennis)
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ BETMOMO — probe sports 1-15 (chercher tennis ATP/WTA) ════════════');
try {
  const { swarmSession } = await import('../src/bookmakers/betmomo/api.js');
  await swarmSession(async (send) => {
    // 1) Lister tous les sports pour voir noms
    const sportList = await send({ sport: ['id', 'name', 'order'] }, {});
    const sports = Object.values(sportList?.sport || {});
    console.log(`  ${sports.length} sports exposes :`);
    for (const s of sports) console.log(`    id=${s.id} "${s.name}" order=${s.order}`);

    // 2) Trouver sport whose name matches tennis-like
    const candidates = sports.filter(s => /tennis|atp|wta/i.test(s.name || ''));
    console.log(`  ${candidates.length} candidates tennis-like: ${candidates.map(s => `${s.id}:${s.name}`).join(' | ')}`);

    // 3) Pour chaque candidat, dump 2 matchs avec leurs markets
    const now = Math.floor(Date.now() / 1000);
    const to = now + 72 * 3600;
    for (const sport of candidates) {
      const listData = await send(
        { sport: ['id', 'name'], region: ['name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'start_ts'] },
        { sport: { id: sport.id }, game: { start_ts: { '@gt': now, '@lt': to }, is_live: 0 } },
      );
      const games = [];
      for (const s of Object.values(listData?.sport || {})) {
        for (const r of Object.values(s.region || {})) for (const c of Object.values(r.competition || {}))
          for (const g of Object.values(c.game || {})) games.push({ ...g, league: c.name });
      }
      console.log(`\n  --- sport ${sport.id} "${sport.name}" : ${games.length} matchs ---`);
      const sample = games.slice(0, 2);
      if (sample.length) {
        const ids = sample.map(g => g.id);
        const oddsData = await send(
          { game: ['id'], market: ['name', 'type', 'group_name'], event: ['name', 'price', 'base', 'type_1', 'type'] },
          { game: { id: { '@in': ids } } },
        );
        for (const g of sample) {
          dumpMatch(`BETMOMO sport=${sport.id} : ${g.team1_name} vs ${g.team2_name}`, { id: g.id, home: g.team1_name, away: g.team2_name, league: g.league, start: g.start_ts * 1000 });
          const withOdds = oddsData?.game?.[g.id];
          const markets = withOdds ? Object.values(withOdds.market || {}) : [];
          console.log(`  │ ${markets.length} markets`);
          for (const mk of markets.slice(0, 12)) {
            const evs = Object.values(mk.event || {}).slice(0, 4);
            const outs = evs.map(e => `${e.type || e.type_1 || ''}"${e.name || ''}"base=${e.base ?? ''}@${e.price}`).join(' | ');
            console.log(`  │   type="${mk.type}" name="${mk.name}" group="${mk.group_name}" → ${outs}`);
          }
          console.log('  └──');
        }
      }
    }
  });
} catch (e) { console.log(`  ERR ${e.message}`); console.error(e.stack); }

console.log('\n═══════════════ FIN DUMP v3 ═══════════════');
