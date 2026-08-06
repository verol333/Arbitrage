#!/usr/bin/env node
// Probe Maxibet v10 — dump les cotes 1X2 de Benfica vs Heart of Midlothian
// sur chaque site_id candidat. La signature maxibet.bet home = V1=1.05 X=7.90 V2=19.00.
import WebSocket from 'ws';

const SWARM = 'wss://eu-swarm-newm.betconstruct.com/';
const CANDIDATES = [211, 613, 894, 509, 968, 122]; // + BetMomo pour comparaison

async function swarmSession(siteId, cb, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let done = false; const ws = new WebSocket(SWARM);
    const finish = (fn) => { if (!done) { done = true; try { ws.close(); } catch {} fn(); } };
    const t = setTimeout(() => finish(() => reject(new Error('timeout'))), timeoutMs);
    const pending = {}; let ridN = 0;
    const send = (what, where) => new Promise((res) => {
      const rid = 'r' + (++ridN); pending[rid] = res;
      ws.send(JSON.stringify({ command: 'get', params: { source: 'betting', what, where }, rid }));
    });
    ws.on('open', () => ws.send(JSON.stringify({ command: 'request_session', params: { site_id: siteId, language: 'eng' }, rid: 's1' })));
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

// Etape 1 : trouve le game_id de Benfica vs Heart of Midlothian sur site 211
console.log('═══ Etape 1 : find game_id ═══');
const gameId = await swarmSession(211, async (send) => {
  const now = Math.floor(Date.now() / 1000);
  const to = now + 5 * 86400;
  const data = await send(
    { sport: ['id'], region: ['name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name'] },
    { sport: { id: 1 }, game: { start_ts: { '@gt': now, '@lt': to }, is_live: 0, team1_name: { '@like': '%Benfica%' } } },
  );
  for (const s of Object.values(data?.sport || {})) {
    for (const r of Object.values(s.region || {})) {
      for (const c of Object.values(r.competition || {})) {
        for (const g of Object.values(c.game || {})) {
          if (/heart of mid/i.test(g.team2_name)) return g.id;
        }
      }
    }
  }
  return null;
}).catch(e => { console.log('  ERR trouve gameId:', e.message); return null; });
console.log(`game_id = ${gameId}`);
if (!gameId) process.exit(1);

// Etape 2 : fetch les cotes 1X2 sur chaque site_id
console.log('\n═══ Etape 2 : cotes 1X2 par site_id ═══');
console.log(`  Reference maxibet.bet home : V1=1.05  X=7.90  V2=19.00\n`);
for (const siteId of CANDIDATES) {
  try {
    const odds = await swarmSession(siteId, async (send) => {
      const data = await send(
        { game: ['id'], market: ['name', 'type'], event: ['name', 'price', 'type_1', 'type'] },
        { game: { id: Number(gameId) } },
      );
      const g = Object.values(data?.game || {})[0];
      if (!g) return null;
      const markets = Object.values(g.market || {});
      // Cherche marche "Match Winner" (type = 'P1XP2' typiquement)
      const m1x2 = markets.find(m => m.type === 'P1XP2' || /match winner/i.test(m.name || ''));
      if (!m1x2) return { markets: markets.map(m => m.name || m.type).slice(0, 8) };
      const events = Object.values(m1x2.event || {});
      const map = {};
      for (const e of events) {
        const t = e.type_1 || e.type;
        map[t] = e.price;
      }
      return { v1: map.P1 || map.W1 || map['1'], vX: map.X || map.Draw, v2: map.P2 || map.W2 || map['2'] };
    });
    if (!odds) console.log(`  site_id=${siteId} → pas de match trouve`);
    else if (odds.v1) {
      const match = (Math.abs(odds.v1 - 1.05) < 0.02 && Math.abs(odds.vX - 7.90) < 0.5 && Math.abs(odds.v2 - 19.00) < 2);
      console.log(`  site_id=${siteId} → V1=${odds.v1} X=${odds.vX} V2=${odds.v2} ${match ? '🎯 MATCH MAXIBET' : ''}`);
    } else {
      console.log(`  site_id=${siteId} → pas de 1X2, markets: ${odds.markets?.join(', ')}`);
    }
  } catch (e) { console.log(`  site_id=${siteId} ERR ${e.message}`); }
}
