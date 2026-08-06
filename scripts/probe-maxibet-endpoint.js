#!/usr/bin/env node
// Probe Maxibet v9 — cross-check 3 candidats XAF (211, 613, 894) avec matchs foot
// visibles sur maxibet.bet (dump home HTML precedent : Benfica, Heart of Midlothian,
// Ligue Europa Qualifs). Le vrai Maxibet = celui qui expose les memes matchs.
import WebSocket from 'ws';

const SWARM = 'wss://eu-swarm-newm.betconstruct.com/';
const CANDIDATES = [211, 613, 894, 509, 968]; // XAF+CFA operators

async function swarmSession(siteId, cb, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let done = false; let ws;
    const finish = (fn) => { if (!done) { done = true; try { ws.close(); } catch {} fn(); } };
    ws = new WebSocket(SWARM);
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
      } else if (pending[m.rid]) {
        pending[m.rid](m?.data?.data); delete pending[m.rid];
      }
    });
    ws.on('error', (e) => { clearTimeout(t); finish(() => reject(e)); });
  });
}

const now = Math.floor(Date.now() / 1000);
const to = now + 5 * 86400; // 5 jours d'horizon

for (const siteId of CANDIDATES) {
  console.log(`\n═══ site_id=${siteId} — dump foot matchs (prematch, next 5 days) ═══`);
  try {
    const data = await swarmSession(siteId, async (send) => {
      const foot = await send(
        { sport: ['id', 'name'], region: ['name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'start_ts'] },
        { sport: { id: 1 }, game: { start_ts: { '@gt': now, '@lt': to }, is_live: 0 } },
      );
      const matches = [];
      for (const s of Object.values(foot?.sport || {})) {
        for (const r of Object.values(s.region || {})) {
          for (const c of Object.values(r.competition || {})) {
            for (const g of Object.values(c.game || {})) {
              matches.push({ team1: g.team1_name, team2: g.team2_name, league: c.name, start: g.start_ts });
            }
          }
        }
      }
      return matches;
    });
    console.log(`  ${data.length} matchs foot`);
    // Print 15 samples
    for (const m of data.slice(0, 15)) {
      const dt = new Date(m.start * 1000).toISOString().slice(0, 16);
      console.log(`    ${m.team1} vs ${m.team2} [${m.league}] ${dt}`);
    }
    // Chercher matchs "signatures" maxibet.bet home
    const known = ['Benfica', 'Heart of Midlothian', 'Fiorentina', 'Deportivo', 'AS Monaco', 'Getafe'];
    const matches_known = data.filter(m => {
      const s = `${m.team1} ${m.team2} ${m.league}`.toLowerCase();
      return known.some(k => s.includes(k.toLowerCase()));
    });
    if (matches_known.length) {
      console.log(`  🎯 ${matches_known.length} matchs "signature" trouves :`);
      for (const m of matches_known.slice(0, 5)) console.log(`    ${m.team1} vs ${m.team2} [${m.league}]`);
    }
  } catch (e) {
    console.log(`  ERR ${e.message}`);
  }
}
