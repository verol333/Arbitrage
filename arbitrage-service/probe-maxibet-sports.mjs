// Sonde Swarm (BetConstruct) pour MaxiBet.
// 1) VALIDE les parseurs hockey + basket contre les vraies donnees Swarm (affiche
//    les cles canoniques produites). 2) Decouvre les types de marchés volley + table tennis.
// Autonome : importe 'ws' directement (resolu depuis arbitrage-service/node_modules).
// Les parseurs n'importent pas 'ws' — import sûr depuis ../src/.
import WebSocket from 'ws';
import { maxibetHockeyFlatOdds } from '../src/bookmakers/maxibet/parseHockey.js';
import { maxibetBasketFlatOdds } from '../src/bookmakers/maxibet/parseBasket.js';

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

async function gamesFor(id, nComps = 5) {
  const compsRes = await swarmSession([{
    rid: 'c',
    params: { source: 'betting', what: { region: ['id', 'name'], competition: ['id', 'name'], game: '@count' }, where: { sport: { id }, game: { type: TYPE_PREMATCH } } },
  }]);
  const regions = compsRes.c?.region || {};
  const compIds = [];
  for (const rk of Object.keys(regions)) for (const ck of Object.keys(regions[rk].competition || {})) { const c = regions[rk].competition[ck]; if ((c.game || 0) > 0) compIds.push(c.id); }
  if (!compIds.length) return [];
  const gamesRes = await swarmSession([{
    rid: 'g',
    params: { source: 'betting', what: { competition: ['id', 'name'], game: ['id', 'team1_name', 'team2_name', 'start_ts'], market: ['id', 'name', 'type'], event: ['id', 'name', 'price', 'type_1', 'base'] }, where: { sport: { id }, game: { type: TYPE_PREMATCH }, competition: { id: { '@in': compIds.slice(0, nComps) } } } },
  }]);
  const comps = gamesRes.g?.competition || {};
  const rows = [];
  for (const ck of Object.keys(comps)) for (const gk of Object.keys(comps[ck].game || {})) rows.push({ game: comps[ck].game[gk], markets: Object.values(comps[ck].game[gk].market || {}) });
  return rows;
}

// --- Validation parseurs hockey + basket ---
log('=== VALIDATION HOCKEY (id=2) ===');
const hk = await gamesFor(2);
log('Matchs: ' + hk.length);
let hkWith = 0; const hkKeys = new Set();
for (const r of hk) { const o = maxibetHockeyFlatOdds(r.markets); if (Object.keys(o).length) hkWith++; for (const k of Object.keys(o)) hkKeys.add(k); }
log('Matchs avec cotes: ' + hkWith + ' | Cles canoniques distinctes: ' + hkKeys.size);
log('Cles: ' + [...hkKeys].sort().join(', '));
if (hk[0]) log('Sample match: ' + hk[0].game.team1_name + ' vs ' + hk[0].game.team2_name + ' -> ' + JSON.stringify(maxibetHockeyFlatOdds(hk[0].markets)));

log('\n=== VALIDATION BASKET (id=3) ===');
const bk = await gamesFor(3);
log('Matchs: ' + bk.length);
let bkWith = 0; const bkKeys = new Set();
for (const r of bk) { const o = maxibetBasketFlatOdds(r.markets); if (Object.keys(o).length) bkWith++; for (const k of Object.keys(o)) bkKeys.add(k); }
log('Matchs avec cotes: ' + bkWith + ' | Cles canoniques distinctes: ' + bkKeys.size);
log('Cles: ' + [...bkKeys].sort().join(', '));
if (bk[0]) log('Sample match: ' + bk[0].game.team1_name + ' vs ' + bk[0].game.team2_name + ' -> ' + JSON.stringify(maxibetBasketFlatOdds(bk[0].markets)));

// --- Decouverte volley + table tennis ---
for (const { label, id } of [{ label: 'volleyball', id: 5 }, { label: 'table_tennis', id: 41 }]) {
  log('\n========================================');
  log('=== ' + label.toUpperCase() + ' (sport id=' + id + ') ===');
  const rows = await gamesFor(id);
  log('Matchs: ' + rows.length);
  if (!rows.length) continue;
  const typeMap = {};
  for (const r of rows) for (const m of r.markets) { const t = m.type; if (!t) continue; if (!typeMap[t]) typeMap[t] = { name: m.name, type_1: new Set(), bases: new Set() }; for (const e of Object.values(m.event || {})) { if (e.type_1) typeMap[t].type_1.add(e.type_1); if (e.base != null) typeMap[t].bases.add(String(e.base)); } }
  log('Types de marchés distincts: ' + Object.keys(typeMap).length);
  for (const [t, info] of Object.entries(typeMap)) log('  type="' + t + '"  name="' + info.name + '"  type_1=[' + [...info.type_1].join(',') + ']  bases=[' + [...info.bases].slice(0, 8).join(',') + ']');
}
log('\n=== FIN SONDE ===');
