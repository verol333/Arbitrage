// Sonde Swarm (BetConstruct) pour MaxiBet : VALIDE les 4 parseurs hockey,
// basket, volleyball, table tennis contre les vraies donnees Swarm (affiche
// les cles canoniques produites + un match d'exemple). Autonome (import 'ws').
import WebSocket from 'ws';
import { maxibetHockeyFlatOdds } from '../src/bookmakers/maxibet/parseHockey.js';
import { maxibetBasketFlatOdds } from '../src/bookmakers/maxibet/parseBasket.js';
import { maxibetVolleyballFlatOdds } from '../src/bookmakers/maxibet/parseVolleyball.js';
import { maxibetTableTennisFlatOdds } from '../src/bookmakers/maxibet/parseTableTennis.js';

const HOST = 'wss://eu-swarm-android.betconstruct.com/';
const SITE_ID = 1870852, LANG = 'eng', TYPE_PREMATCH = 2;

function swarmSession(steps, { timeoutMs = 90_000 } = {}) {
  return new Promise((resolve) => {
    const results = {};
    if (!steps.length) return resolve(results);
    let ws, settled = false, idx = 0;
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
    ws.on('error', finish); ws.on('close', finish);
  });
}
const log = (m) => console.log(m);

async function gamesFor(id, nComps = 8) {
  const compsRes = await swarmSession([{ rid: 'c', params: { source: 'betting', what: { region: ['id', 'name'], competition: ['id', 'name'], game: '@count' }, where: { sport: { id }, game: { type: TYPE_PREMATCH } } } }]);
  const regions = compsRes.c?.region || {};
  const compIds = [];
  for (const rk of Object.keys(regions)) for (const ck of Object.keys(regions[rk].competition || {})) { const c = regions[rk].competition[ck]; if ((c.game || 0) > 0) compIds.push(c.id); }
  if (!compIds.length) return [];
  const gamesRes = await swarmSession([{ rid: 'g', params: { source: 'betting', what: { competition: ['id', 'name'], game: ['id', 'team1_name', 'team2_name', 'start_ts'], market: ['id', 'name', 'type'], event: ['id', 'name', 'price', 'type_1', 'base'] }, where: { sport: { id }, game: { type: TYPE_PREMATCH }, competition: { id: { '@in': compIds.slice(0, nComps) } } } } }]);
  const comps = gamesRes.g?.competition || {};
  const rows = [];
  for (const ck of Object.keys(comps)) for (const gk of Object.keys(comps[ck].game || {})) rows.push({ game: comps[ck].game[gk], markets: Object.values(comps[ck].game[gk].market || {}) });
  return rows;
}

const PARSERS = [
  { label: 'HOCKEY', id: 2, fn: maxibetHockeyFlatOdds },
  { label: 'BASKET', id: 3, fn: maxibetBasketFlatOdds },
  { label: 'VOLLEYBALL', id: 5, fn: maxibetVolleyballFlatOdds },
  { label: 'TABLE_TENNIS', id: 41, fn: maxibetTableTennisFlatOdds },
];

for (const { label, id, fn } of PARSERS) {
  log('\n=== VALIDATION ' + label + ' (id=' + id + ') ===');
  const rows = await gamesFor(id);
  log('Matchs: ' + rows.length);
  if (!rows.length) continue;
  let withOdds = 0; const keys = new Set(); let sample = null;
  for (const r of rows) { const o = fn(r.markets); if (Object.keys(o).length) { withOdds++; if (!sample) sample = { name: r.game.team1_name + ' vs ' + r.game.team2_name, o }; } for (const k of Object.keys(o)) keys.add(k); }
  log('Matchs avec cotes: ' + withOdds + ' | Cles canoniques distinctes: ' + keys.size);
  log('Cles: ' + [...keys].sort().join(', '));
  if (sample) log('Sample: ' + sample.name + ' -> ' + JSON.stringify(sample.o));
}
log('\n=== FIN SONDE ===');
