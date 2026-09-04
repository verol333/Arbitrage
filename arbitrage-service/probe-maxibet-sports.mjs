// Sonde Swarm (BetConstruct) pour MaxiBet : liste tous les sports et dump les
// types de marchés du volley / table tennis afin d'écrire les parseurs avec
// les VRAIS noms de types (pas de devinette — évite tout arbitrage fantaisiste).
// Autonome : importe 'ws' directement (resolu depuis arbitrage-service/node_modules).
import WebSocket from 'ws';

const HOST = 'wss://eu-swarm-android.betconstruct.com/';
const SITE_ID = 1870852;
const LANG = 'eng';
const TYPE_PREMATCH = 2;

function swarmSession(steps, { timeoutMs = 90_000 } = {}) {
  return new Promise((resolve) => {
    const results = {};
    if (!steps.length) return resolve(results);
    let ws; let settled = false; let idx = 0;
    const finish = () => { if (settled) return; settled = true; clearTimeout(hard); try { ws.close(); } catch {} resolve(results); };
    const hard = setTimeout(finish, timeoutMs);
    try { ws = new WebSocket(HOST); } catch { clearTimeout(hard); return resolve(results); }
    const send = () => { if (idx >= steps.length) return finish(); ws.send(JSON.stringify({ command: 'get', params: steps[idx].params, rid: steps[idx].rid })); };
    ws.on('open', () => ws.send(JSON.stringify({ command: 'request_session', params: { language: LANG, site_id: String(SITE_ID), source: 42 }, rid: 'sess' })));
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.rid === 'sess') { if (msg.code !== 0) return finish(); return send(); }
      const s = steps[idx];
      if (s && msg.rid === s.rid) { results[s.rid] = msg.data?.data || {}; idx++; send(); }
    });
    ws.on('error', finish);
    ws.on('close', finish);
  });
}

const log = (m) => console.log(m);
const CANDIDATES = [
  { label: 'volleyball', id: 5 },
  { label: 'table_tennis', id: 41 },
];

for (const { label, id } of CANDIDATES) {
  log('\n========================================');
  log('=== ' + label.toUpperCase() + ' (sport id=' + id + ') ===');
  const compsRes = await swarmSession([{
    rid: 'c',
    params: { source: 'betting', what: { region: ['id', 'name'], competition: ['id', 'name'], game: '@count' }, where: { sport: { id }, game: { type: TYPE_PREMATCH } } },
  }]);
  const regions = compsRes.c?.region || {};
  const compIds = [];
  for (const rk of Object.keys(regions)) for (const ck of Object.keys(regions[rk].competition || {})) { const c = regions[rk].competition[ck]; if ((c.game || 0) > 0) compIds.push(c.id); }
  log('Competitions avec matchs: ' + compIds.length);
  if (!compIds.length) { log('  -> Aucune competition, sport id probablement faux.'); continue; }

  const batch = compIds.slice(0, 5);
  const gamesRes = await swarmSession([{
    rid: 'g',
    params: {
      source: 'betting',
      what: { competition: ['id', 'name'], game: ['id', 'team1_name', 'team2_name', 'start_ts'], market: ['id', 'name', 'type'], event: ['id', 'name', 'price', 'type_1', 'base'] },
      where: { sport: { id }, game: { type: TYPE_PREMATCH }, competition: { id: { '@in': batch } } },
    },
  }]);
  const comps = gamesRes.g?.competition || {};
  const typeMap = {};
  let gameCount = 0;
  for (const ck of Object.keys(comps)) for (const gk of Object.keys(comps[ck].game || {})) {
    gameCount++;
    for (const m of Object.values(comps[ck].game[gk].market || {})) {
      const t = m.type; if (!t) continue;
      if (!typeMap[t]) typeMap[t] = { name: m.name, type_1: new Set(), bases: new Set() };
      for (const e of Object.values(m.event || {})) { if (e.type_1) typeMap[t].type_1.add(e.type_1); if (e.base != null) typeMap[t].bases.add(String(e.base)); }
    }
  }
  log('Matchs lus: ' + gameCount + '  |  Types de marchés distincts: ' + Object.keys(typeMap).length);
  for (const [t, info] of Object.entries(typeMap)) log('  type="' + t + '"  name="' + info.name + '"  type_1=[' + [...info.type_1].join(',') + ']  bases=[' + [...info.bases].slice(0, 8).join(',') + ']');
}
log('\n=== FIN SONDE ===');
