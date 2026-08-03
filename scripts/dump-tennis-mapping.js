#!/usr/bin/env node
// Dump complet des markets tennis v2 — bugs v1 corriges + probes plus larges
import { fetchJson } from '../src/net/fetcher.js';
import { stealthGetJson } from '../src/net/stealth.js';

const dumpMatch = (label, m) => {
  console.log(`\n  ┌── ${label}`);
  console.log(`  │ home: ${m.home}`);
  console.log(`  │ away: ${m.away}`);
  console.log(`  │ league: ${m.league || '?'}`);
  console.log(`  │ start: ${m.start ? new Date(m.start).toISOString() : '?'}`);
  console.log(`  │ id: ${m.id}`);
};

// ═══════════════════════════════════════════════════════════════
// 1) BETPAWA — probe categoryIds larges 4-100 par pas de 5 + regions .ke .ug
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ BETPAWA — probe categoryIds tennis (Congo + Kenya) ════════════');
try {
  const { bpFetchList } = await import('../src/bookmakers/betpawa/api.js');
  // Test Congo (cg)
  for (const catId of [3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 40, 50, 100]) {
    const q = { queries: [{ query: { eventType: 'UPCOMING', categories: [String(catId)], zones: {}, hasOdds: true }, view: { marketTypes: ['3743'] }, skip: 0, take: 5 }] };
    const url = `https://cg.betpawa.com/api/sportsbook/v4/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`;
    const strs = await bpFetchList(url);
    const pairs = [];
    for (let i = 0; i < strs.length - 1; i++) {
      if (/^\d{7,10}$/.test(strs[i]) && strs[i + 1].includes(' - ')) pairs.push(strs[i + 1]);
    }
    console.log(`  .cg cat=${catId}: ${pairs.length} matchs — ${[...new Set(pairs)].slice(0, 2).join(' | ')}`);
  }
  // Test Kenya (ke) — plus de sports peut-être exposés
  const HDR_KE = {
    'Accept': 'application/x-protobuf', 'Accept-Language': 'en',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36',
    'x-pawa-brand': 'betpawa-kenya', 'x-pawa-language': 'en',
    'Referer': 'https://ke.betpawa.com/events?categoryId=2&marketId=1X2',
  };
  for (const catId of [3, 4, 5, 6, 7]) {
    try {
      const q = { queries: [{ query: { eventType: 'UPCOMING', categories: [String(catId)], zones: {}, hasOdds: true }, view: { marketTypes: ['3743'] }, skip: 0, take: 5 }] };
      const res = await fetch(`https://ke.betpawa.com/api/sportsbook/v4/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`, { headers: HDR_KE, signal: AbortSignal.timeout(15000) });
      const buf = new Uint8Array(await res.arrayBuffer());
      const strs = []; let cur = '';
      for (let i = 0; i < buf.length; i++) { const b = buf[i]; if (b >= 32 && b <= 126) cur += String.fromCharCode(b); else { if (cur.length > 2) strs.push(cur); cur = ''; } }
      const pairs = [];
      for (let i = 0; i < strs.length - 1; i++) if (/^\d{7,10}$/.test(strs[i]) && strs[i + 1].includes(' - ')) pairs.push(strs[i + 1]);
      console.log(`  .ke cat=${catId}: status=${res.status} ${pairs.length} matchs — ${[...new Set(pairs)].slice(0, 2).join(' | ')}`);
    } catch (e) { console.log(`  .ke cat=${catId}: ERR ${e.message}`); }
  }
} catch (e) { console.log(`  ERR ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 2) YELLOWBET — fix stealth + probe sportIds tennis
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ YELLOWBET — probe sportIds tennis (stealth) ════════════');
try {
  const HDR = { brandid: '122', channelid: '4', language: 'fr', terminal: 'yellowbet.cg' };
  for (const sid of [32, 33, 34, 35, 36, 37, 40, 42, 45, 47, 50, 60]) {
    const url = `https://yellowbet.cg/services/evapi/event/GetEvents?skip=0&take=5&sportId=${sid}&categoryTypeIds=all&langId=fr`;
    const j = await stealthGetJson(url, { headers: HDR, timeoutMs: 12000 });
    const events = j?.value?.events || j?.events || [];
    console.log(`  sportId=${sid}: ${events.length} events${events.length > 0 ? ` — ex: ${events[0]?.h || '?'} vs ${events[0]?.a || '?'} (${events[0]?.ln || '?'})` : ''}`);
  }
} catch (e) { console.log(`  ERR ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 3) APOLLO — dump corrigé (fields Odds[].Type / Name / Odd + Sbv)
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ APOLLO — dump BetTypeKeys tennis (v2 fix fields) ════════════');
try {
  const { listMatches, fetchOffers } = await import('../src/bookmakers/apollo/list.js');
  const matches = await listMatches({ live: false, sport: 'tennis' });
  console.log(`  ${matches.length} matchs listes`);
  const sample = matches.slice(0, 2);
  if (sample.length) {
    const map = await fetchOffers(sample.map(m => m.id));
    for (const m of sample) {
      const offers = map.get(m.id) || [];
      dumpMatch(`APOLLO : ${m.home} vs ${m.away}`, m);
      console.log(`  │ ${offers.length} offers`);
      for (const o of offers) {
        const key = o.BetTypeKey ?? '?';
        const name = o.BetTypeName ?? o.betTypeName ?? '';
        const sbv = o.Sbv ?? '';
        const outcomes = (o.Odds || []).map(od => `${od.Type || ''}"${od.Name || ''}"=${od.Odd}`).join(' | ');
        console.log(`  │   BetTypeKey=${key} ${name ? `"${name}" ` : ''}Sbv=${sbv} → ${outcomes}`);
      }
      console.log('  └──');
    }
  }
} catch (e) { console.log(`  ERR ${e.message}`); console.error(e.stack); }

// ═══════════════════════════════════════════════════════════════
// 4) BETMOMO — investiger pourquoi markets vides + dump structure raw
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ BETMOMO — dump structure tennis (v2 raw SWARM) ════════════');
try {
  const { swarmSession } = await import('../src/bookmakers/betmomo/api.js');
  await swarmSession(async (send) => {
    // Test sport 4 (défaut tennis) — 3 matchs
    const now = Math.floor(Date.now() / 1000);
    const to = now + 72 * 3600;
    const listData = await send(
      { sport: ['id', 'name'], region: ['name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'start_ts'] },
      { sport: { id: 4 }, game: { start_ts: { '@gt': now, '@lt': to }, is_live: 0 } },
    );
    const games = [];
    for (const s of Object.values(listData?.sport || {})) {
      for (const r of Object.values(s.region || {})) for (const c of Object.values(r.competition || {}))
        for (const g of Object.values(c.game || {})) games.push({ ...g, league: c.name });
    }
    console.log(`  ${games.length} matchs sport=4 (tennis?)`);
    const sample = games.slice(0, 2);
    if (sample.length) {
      const ids = sample.map(g => g.id);
      const oddsData = await send(
        { game: ['id'], market: ['name', 'type', 'group_name', 'col_count'], event: ['name', 'price', 'base', 'type_1', 'type'] },
        { game: { id: { '@in': ids } } },
      );
      for (const g of sample) {
        dumpMatch(`BETMOMO : ${g.team1_name} vs ${g.team2_name}`, { id: g.id, home: g.team1_name, away: g.team2_name, league: g.league, start: g.start_ts * 1000 });
        const withOdds = oddsData?.game?.[g.id];
        const markets = withOdds ? Object.values(withOdds.market || {}) : [];
        console.log(`  │ ${markets.length} markets`);
        for (const mk of markets.slice(0, 15)) {
          const evs = Object.values(mk.event || {}).slice(0, 4);
          const outcomes = evs.map(e => `${e.type || e.type_1 || ''}"${e.name || ''}"base=${e.base ?? ''}@${e.price}`).join(' | ');
          console.log(`  │   type="${mk.type}" name="${mk.name}" group="${mk.group_name}" → ${outcomes}`);
        }
        console.log('  └──');
      }
    }
  });
} catch (e) { console.log(`  ERR ${e.message}`); console.error(e.stack); }

// ═══════════════════════════════════════════════════════════════
// 5) PREMIERBET (guineegames) — probe sportIds pour trouver vrai tennis
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ PREMIERBET (guineegames) — probe sportIds pour tennis ════════════');
try {
  const HDR = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://www.guineegames.com/',
  };
  const params = 'country=GN&group=g6&platform=desktop&locale=fr';
  const date = new Date().toISOString().slice(0, 10);
  for (const sid of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30]) {
    try {
      const url = `https://sports-api.guineegames.com/v1/events/upcoming?${params}&sportId=${sid}&timeOffset=-60&date=${date}`;
      const j = await fetchJson(url, { headers: HDR, timeoutMs: 20000 });
      let count = 0; let sample = '';
      if (j?.data) {
        const cats = j.data.categories || (Array.isArray(j.data) ? j.data : []);
        for (const c of cats) for (const comp of (c.competitions || c.tournaments || [])) {
          for (const e of (comp.events || [])) {
            count++;
            if (!sample) {
              const names = e.competitors?.map(x => x.name) || e.teams?.map(x => x.name) || [];
              sample = names.length >= 2 ? `${names[0]} vs ${names[1]} [${c.name || '?'} / ${comp.name || '?'}]` : (e.name || '?');
            }
          }
        }
      }
      console.log(`  sportId=${sid}: ${count} events${sample ? ` — ex: ${sample}` : ''}`);
    } catch (e) { console.log(`  sportId=${sid}: ERR ${e.message}`); }
  }
} catch (e) { console.log(`  ERR ${e.message}`); }

console.log('\n═══════════════ FIN DUMP v2 ═══════════════');
