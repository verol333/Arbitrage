// Listing prématch + live football 1xbet (port fidèle de matchCore.ts).
import { FEED, COUNTRY, PARTNER, viaWorker, mapXItems, isFakeTeam, isVirtual } from './api.js';

function isRealChamp(name) {
  return !/spéci|special|player|joueur|team vs|vs player|winner|vainqueur|to win|outright|long.?term/i.test(name || '');
}

export async function listPrematch() {
  const champs = await viaWorker(`${FEED}/service-api/LineFeed/GetChampsZip?sport=1&lng=en&country=${COUNTRY}&partner=${PARTNER}`);
  const champIds = [...new Set((champs?.Value || [])
    .filter((c) => isRealChamp(c.LE || c.L))
    .map((c) => c.LI || c.CI)
    .filter(Boolean))];
  if (!champIds.length) {
    const top = await viaWorker(`${FEED}/service-api/LineFeed/Get1x2_VZip?sports=1&count=100&lng=en&mode=4&country=${COUNTRY}&partner=${PARTNER}&getEmpty=true`);
    return mapXItems(top?.Value);
  }
  const seen = new Set(); const all = [];
  const BATCH = 12;
  for (let i = 0; i < champIds.length; i += BATCH) {
    const batch = champIds.slice(i, i + BATCH);
    const res = await Promise.all(batch.map((ci) =>
      viaWorker(`${FEED}/service-api/LineFeed/Get1x2_VZip?champs=${ci}&count=100&lng=en&mode=4&country=${COUNTRY}&partner=${PARTNER}&getEmpty=true`)
    ));
    for (const r of res) {
      for (const m of mapXItems(r?.Value)) {
        if (!seen.has(m.id)) { seen.add(m.id); all.push(m); }
      }
    }
  }
  return all;
}

export async function listLive() {
  const raw = await viaWorker(`${FEED}/service-api/LiveFeed/Get1x2_VZip?sports=1&count=500&lng=en&mode=4&country=${COUNTRY}&partner=${PARTNER}&getEmpty=true`);
  return (raw?.Value || [])
    .filter((m) => m.I && m.O1 && m.O2 && !isFakeTeam(m.O1) && !isFakeTeam(m.O2) && !isVirtual(m.O1, m.O2, m.LE || m.L || ''))
    .map((m) => ({ id: m.I, home: m.O1, away: m.O2, league: m.LE || m.L || '', start: m.S ? m.S * 1000 : null }));
}
