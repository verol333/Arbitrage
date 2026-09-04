// Sonde Swarm (BetConstruct) pour MaxiBet : liste tous les sports et dump les
// types de marchés du basket / hockey / volley afin d'écrire les parseurs avec
// les VRAIS noms de types (pas de devinette — évite tout arbitrage fantaisiste).
import { swarmSession, TYPE_PREMATCH } from '../src/bookmakers/maxibet/ws.js';

const log = (m) => console.log(m);

// 1) Liste de tous les sports exposés par Swarm pour ce site.
const sportsRes = await swarmSession([{ rid: 'sports', params: { source: 'betting', what: { sport: ['id', 'name'] } } }]);
const sports = sportsRes.sports?.sport || {};
log('=== SPORTS Swarm (site 1870852) ===');
const allIds = [];
for (const k of Object.keys(sports)) { const s = sports[k]; allIds.push(s.id); log('  id=' + s.id + '  name=' + s.name); }
log('Total sports: ' + allIds.length);

// 2) Pour chaque sport candidat : competitions -> quelques matchs -> types de marchés.
const CANDIDATES = [
  { label: 'basket', id: 2 },
  { label: 'hockey', id: 3 },
  { label: 'volleyball', id: 6 },
];

for (const { label, id } of CANDIDATES) {
  log('\n========================================');
  log('=== ' + label.toUpperCase() + ' (sport id=' + id + ') ===');
  const compsRes = await swarmSession([{
    rid: 'c',
    params: {
      source: 'betting',
      what: { region: ['id', 'name'], competition: ['id', 'name'], game: '@count' },
      where: { sport: { id }, game: { type: TYPE_PREMATCH } },
    },
  }]);
  const regions = compsRes.c?.region || {};
  const compIds = [];
  for (const rk of Object.keys(regions)) {
    for (const ck of Object.keys(regions[rk].competition || {})) {
      const c = regions[rk].competition[ck];
      if ((c.game || 0) > 0) compIds.push(c.id);
    }
  }
  log('Competitions avec matchs: ' + compIds.length);
  if (!compIds.length) { log('  -> Aucune competition, sport id probablement faux.'); continue; }

  const batch = compIds.slice(0, 5);
  const gamesRes = await swarmSession([{
    rid: 'g',
    params: {
      source: 'betting',
      what: {
        competition: ['id', 'name'],
        game: ['id', 'team1_name', 'team2_name', 'start_ts'],
        market: ['id', 'name', 'type'],
        event: ['id', 'name', 'price', 'type_1', 'base'],
      },
      where: { sport: { id }, game: { type: TYPE_PREMATCH }, competition: { id: { '@in': batch } } },
    },
  }]);
  const comps = gamesRes.g?.competition || {};
  const typeMap = {};
  let gameCount = 0;
  for (const ck of Object.keys(comps)) {
    for (const gk of Object.keys(comps[ck].game || {})) {
      gameCount++;
      for (const m of Object.values(comps[ck].game[gk].market || {})) {
        const t = m.type;
        if (!t) continue;
        if (!typeMap[t]) typeMap[t] = { name: m.name, type_1: new Set(), bases: new Set() };
        for (const e of Object.values(m.event || {})) {
          if (e.type_1) typeMap[t].type_1.add(e.type_1);
          if (e.base != null) typeMap[t].bases.add(String(e.base));
        }
      }
    }
  }
  log('Matchs lus: ' + gameCount + '  |  Types de marchés distincts: ' + Object.keys(typeMap).length);
  for (const [t, info] of Object.entries(typeMap)) {
    log('  type="' + t + '"  name="' + info.name + '"  type_1=[' + [...info.type_1].join(',') + ']  bases=[' + [...info.bases].slice(0, 8).join(',') + ']');
  }
}
log('\n=== FIN SONDE ===');
