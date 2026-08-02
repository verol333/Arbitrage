// Cartographie BetMomo TENNIS — v2 avec diagnostic sport IDs.
// D'abord liste TOUS les sports disponibles avec compte de matchs,
// puis pour tennis dump 2 matchs avec TOUS leurs markets.
import WebSocket from 'ws';

const ENDPOINT = 'wss://eu-swarm-newm.betconstruct.com/';
const SITE_ID = 122;
const log = (m) => console.log(m);

async function swarmSession(cb, { timeoutMs = 60_000 } = {}) {
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

log('\n═══════════ BETMOMO — DIAG SPORTS ═══════════');

await swarmSession(async (send) => {
  // Etape 1: liste TOUS les sports avec compte de matchs (aucun filtre)
  log('\n────── Etape 1 : Sports disponibles ──────');
  const allSports = await send({ sport: ['id', 'name', 'alias'] }, {});
  const sportMap = allSports?.sport || {};
  for (const [sid, s] of Object.entries(sportMap)) {
    log(`  sport.id=${sid} name="${s.name}" alias="${s.alias || ''}"`);
  }

  // Etape 2: chercher tennis (soit par nom, soit par id 4)
  const tennisEntry = Object.entries(sportMap).find(([sid, s]) =>
    /tennis/i.test(s.name || '') || /tennis/i.test(s.alias || ''),
  );
  if (!tennisEntry) {
    log('\n⚠️ Aucun sport "tennis" trouvé dans la liste.');
    return;
  }
  const [tennisSid, tennisInfo] = tennisEntry;
  log(`\n────── Etape 2 : Tennis identifié — sport.id=${tennisSid} name="${tennisInfo.name}" ──────`);

  // Etape 3: liste matchs tennis (sans filtre type)
  for (const [modeLabel, gameType] of [['ALL', null], ['LIVE', 1], ['PREMATCH', 0]]) {
    const where = gameType === null
      ? { sport: { id: { '@eq': Number(tennisSid) } } }
      : { sport: { id: { '@eq': Number(tennisSid) } }, game: { type: { '@eq': gameType } } };
    const games = await send({ game: ['id', 'team1_name', 'team2_name', 'is_live', 'type'] }, where);
    const sport = Object.values(games?.sport || {})[0];
    let allGames = [];
    for (const region of Object.values(sport?.region || {})) {
      for (const competition of Object.values(region?.competition || {})) {
        for (const g of Object.values(competition?.game || {})) allGames.push(g);
      }
    }
    log(`\n  ${modeLabel}: ${allGames.length} matchs tennis`);
    if (modeLabel === 'ALL' && allGames.length) {
      log(`  Sample : ${allGames.slice(0, 3).map((g) => `"${g.team1_name} vs ${g.team2_name}" (live=${g.is_live}, type=${g.type})`).join(' | ')}`);

      // Etape 4: pour 2 premiers matchs, dump markets complet
      for (const g of allGames.slice(0, 2)) {
        log(`\n  ══ MATCH : ${g.team1_name} vs ${g.team2_name} — id=${g.id} live=${g.is_live} type=${g.type} ══`);
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

        // Group by group_name
        const grouped = {};
        for (const m of markets) {
          const key = m.group_name || 'NO_GROUP';
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(m);
        }
        for (const [groupName, mkts] of Object.entries(grouped)) {
          log(`\n     ┌─── GROUP: "${groupName}" (${mkts.length}) ───`);
          for (const m of mkts) {
            const events = Array.isArray(m.event) ? m.event : Object.values(m.event || {});
            const outcomes = events.map((e) => `${e.type_1 || e.type || e.name || '?'}${e.base != null ? `[base=${e.base}]` : ''}=${e.price}`).join(' | ');
            log(`     │ TYPE="${m.type}" NAME="${m.name}" col=${m.col_count} display_key="${m.display_key || ''}" sub="${m.display_sub_key || ''}"`);
            log(`     │   outcomes: ${outcomes}`);
          }
        }
      }
    }
  }
});

log('\n═══════════ DONE ═══════════');
