#!/usr/bin/env node
// Probe Maxibet CONFIRM — fetch tous les marches Benfica vs Heart of Midlothian
// depuis site_id=211 pour comparer avec le screenshot user.
import WebSocket from 'ws';

const SWARM = 'wss://eu-swarm-newm.betconstruct.com/';
const SITE_ID = 211;

async function swarmSession(cb, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    let done = false; const ws = new WebSocket(SWARM);
    const finish = (fn) => { if (!done) { done = true; try { ws.close(); } catch {} fn(); } };
    const t = setTimeout(() => finish(() => reject(new Error('timeout'))), timeoutMs);
    const pending = {}; let ridN = 0;
    const send = (what, where) => new Promise((res) => {
      const rid = 'r' + (++ridN); pending[rid] = res;
      ws.send(JSON.stringify({ command: 'get', params: { source: 'betting', what, where }, rid }));
    });
    ws.on('open', () => ws.send(JSON.stringify({ command: 'request_session', params: { site_id: SITE_ID, language: 'eng' }, rid: 's1' })));
    ws.on('message', async (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.rid === 's1') {
        if (!m?.data?.sid) { clearTimeout(t); return finish(() => reject(new Error('no-sid'))); }
        try { const out = await cb(send); clearTimeout(t); finish(() => resolve(out)); }
        catch (e) { clearTimeout(t); finish(() => reject(e)); }
      } else if (pending[m.rid]) { pending[m.rid](m?.data?.data); delete pending[m.rid]; }
    });
    ws.on('error', (e) => { clearTimeout(t); finish(() => reject(e)); });
  });
}

console.log(`═══ Maxibet (site_id=${SITE_ID}) — Benfica vs Heart of Midlothian ═══`);

const result = await swarmSession(async (send) => {
  const now = Math.floor(Date.now() / 1000);
  const to = now + 7 * 86400;
  const list = await send(
    { sport: ['id'], region: ['name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'start_ts'] },
    { sport: { id: 1 }, game: { start_ts: { '@gt': now, '@lt': to }, is_live: 0 } },
  );
  let target = null;
  for (const s of Object.values(list?.sport || {})) {
    for (const r of Object.values(s.region || {})) {
      for (const c of Object.values(r.competition || {})) {
        for (const g of Object.values(c.game || {})) {
          const label = `${g.team1_name || ''} ${g.team2_name || ''}`.toLowerCase();
          if (label.includes('benfica') && label.includes('heart of mid')) {
            target = { ...g, league: c.name };
            break;
          }
        }
      }
    }
  }
  if (!target) return null;
  console.log(`\n► ${target.team1_name} vs ${target.team2_name}`);
  console.log(`  [${target.league}]`);
  console.log(`  Kickoff: ${new Date(target.start_ts * 1000).toISOString()}`);
  console.log(`  Game ID: ${target.id}\n`);
  // Fetch tous les markets
  const odds = await send(
    { game: ['id'], market: ['name', 'type', 'base', 'col_count', 'group_name'], event: ['name', 'price', 'base', 'type_1', 'type'] },
    { game: { id: Number(target.id) } },
  );
  const g = Object.values(odds?.game || {})[0];
  return { target, markets: g ? Object.values(g.market || {}) : [] };
});

if (!result) { console.log('Match non trouve'); process.exit(1); }

console.log(`═══ ${result.markets.length} marches disponibles ═══\n`);

// Regroupement pratique par category pour lecture
const groups = {};
for (const m of result.markets) {
  const g = m.group_name || 'Autres';
  if (!groups[g]) groups[g] = [];
  groups[g].push(m);
}

for (const [gname, ms] of Object.entries(groups)) {
  console.log(`\n━━━━━━ ${gname} (${ms.length}) ━━━━━━`);
  for (const m of ms) {
    const events = Object.values(m.event || {}).filter(e => e && e.price != null && Number(e.price) > 1);
    if (!events.length) continue;
    const label = `${m.name || m.type}${m.base != null ? ` (base=${m.base})` : ''}`;
    const eventStr = events.map(e => {
      const t = e.type_1 || e.type || e.name;
      const b = e.base != null ? `@${e.base}` : '';
      return `${t}${b}=${e.price}`;
    }).join('  |  ');
    console.log(`  ${label.padEnd(50)} ${eventStr}`);
  }
}
