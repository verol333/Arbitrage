// Cartographie BetMomo TENNIS : dump TOUS les markets de 2-3 matchs.
// Objectif : identifier chaque market unique par son NOM, TYPE, GROUP_NAME
// pour distinguer proprement :
//   - Handicap match complet (Sets Handicap)
//   - Handicap 1er set (Games Handicap Set 1)
//   - Handicap 2ème set (Games Handicap Set 2)
//   - Handicap 3ème set (Games Handicap Set 3)
//   - Total match complet vs Total 1er set vs Total 2ème set
//   - Match Winner, Set Winner (per-set)
//
// AUCUN branchement au scan, uniquement dump pour analyse.
import WebSocket from 'ws';

const ENDPOINT = 'wss://eu-swarm-newm.betconstruct.com/';
const SITE_ID = 122;
const TENNIS_SID = 4; // BetMomo tennis sport ID (validé)
const log = (m) => console.log(m);

async function swarmSession(cb, { timeoutMs = 45_000 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const ws = new WebSocket(ENDPOINT);
    const finish = (fn) => { if (!done) { done = true; try { ws.close(); } catch {} fn(); } };
    const timer = setTimeout(() => finish(() => reject(new Error('bm-swarm-timeout'))), timeoutMs);
    const pending = {};
    let ridN = 0;
    const send = (what, where) => new Promise((res) => {
      const rid = 'r' + (++ridN);
      pending[rid] = res;
      ws.send(JSON.stringify({ command: 'get', params: { source: 'betting', what, where }, rid }));
    });
    ws.on('open', () => ws.send(JSON.stringify({ command: 'request_session', params: { site_id: SITE_ID, language: 'eng' }, rid: 's1' })));
    ws.on('message', async (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.rid === 's1') {
        if (!msg?.data?.sid) { clearTimeout(timer); return finish(() => reject(new Error('bm-no-sid'))); }
        try { const out = await cb(send); clearTimeout(timer); finish(() => resolve(out)); }
        catch (e) { clearTimeout(timer); finish(() => reject(e)); }
      } else if (pending[msg.rid]) {
        const r = pending[msg.rid];
        delete pending[msg.rid];
        r(msg?.data?.data);
      }
    });
    ws.on('error', () => { if (!done) { clearTimeout(timer); reject(new Error('bm-ws-error')); } });
  });
}

log('\n═══════════ BETMOMO TENNIS — CARTOGRAPHIE MARKETS ═══════════');

await swarmSession(async (send) => {
  // Liste matchs tennis (prematch + live pour couvrir les 2 cas)
  for (const [modeLabel, gameType] of [['PREMATCH', 0], ['LIVE', 1]]) {
    log(`\n────── ${modeLabel} (type=${gameType}) ──────`);
    const games = await send(
      { game: ['id', 'team1_name', 'team2_name', 'is_live'] },
      { sport: { id: { '@eq': TENNIS_SID } }, game: { type: { '@eq': gameType } } },
    );
    const sport = Object.values(games?.sport || {})[0];
    const region = Object.values(sport?.region || {})[0];
    const competition = Object.values(region?.competition || {})[0];
    const gameList = Object.values(competition?.game || {});
    log(`  ${gameList.length} matchs tennis ${modeLabel}`);
    if (!gameList.length) continue;

    // Prendre 2 matchs pour cartographie
    for (const g of gameList.slice(0, 2)) {
      log(`\n  ══ MATCH : ${g.team1_name} vs ${g.team2_name} — id=${g.id} ══`);
      const oddsData = await send(
        {
          game: ['id'],
          market: ['name', 'type', 'col_count', 'group_name', 'group_id', 'display_key', 'display_sub_key'],
          event: ['name', 'price', 'base', 'type_1', 'type'],
        },
        { game: { id: { '@eq': Number(g.id) } } },
      );
      const gg = Object.values(oddsData?.game || {})[0];
      const markets = gg ? Object.values(gg.market || {}) : [];
      log(`     ${markets.length} markets`);

      // Group by group_name pour meilleure lisibilité
      const grouped = {};
      for (const m of markets) {
        const key = m.group_name || 'NO_GROUP';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(m);
      }

      for (const [groupName, mkts] of Object.entries(grouped)) {
        log(`\n     ┌─── GROUP: "${groupName}" (${mkts.length} markets) ───`);
        for (const m of mkts) {
          const events = Array.isArray(m.event) ? m.event : Object.values(m.event || {});
          const outcomes = events.map((e) => {
            const label = e.type_1 || e.type || e.name || '?';
            const base = e.base != null ? `[base=${e.base}]` : '';
            return `${label}${base}=${e.price}`;
          }).join(' | ');
          log(`     │ TYPE="${m.type}" NAME="${m.name}" col=${m.col_count} display_key="${m.display_key || ''}" sub="${m.display_sub_key || ''}"`);
          log(`     │   outcomes: ${outcomes}`);
        }
      }
    }
  }
});

log('\n═══════════ DONE — analyse manuelle requise ═══════════');
