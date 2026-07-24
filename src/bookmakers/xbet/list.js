import { FEED, COUNTRY, PARTNER, viaWorker, mapXItems, isFakeTeam, isVirtual } from './api.js';
import { teamSim } from '../../core/text.js';

const SPORT_ID = 1;

function isRealChamp(name) {
  return !/spéci|special|player|joueur|team vs|vs player|winner|vainqueur|to win|outright|long.?term/i.test(name || '');
}

// Un même match peut apparaître sous plusieurs "champs" (main league + variantes/spéciaux).
// On garde le premier vu, on ignore les duplicatas (teams similaires ± 15min).
function dedupeMatches(matches) {
  const kept = [];
  for (const m of matches) {
    const dup = kept.find((k) => {
      if (!m.start || !k.start) return false;
      if (Math.abs(m.start - k.start) > 15 * 60 * 1000) return false;
      const s = (teamSim(m.home, k.home) + teamSim(m.away, k.away)) / 2;
      return s >= 0.75;
    });
    if (!dup) kept.push(m);
  }
  return kept;
}

export async function listPrematch() {
  const champs = await viaWorker(`${FEED}/service-api/LineFeed/GetChampsZip?sport=${SPORT_ID}&lng=en&country=${COUNTRY}&partner=${PARTNER}`);
  const champIds = [...new Set((champs?.Value || [])
    .filter((c) => isRealChamp(c.LE || c.L))
    .map((c) => c.LI || c.CI)
    .filter(Boolean))];
  if (!champIds.length) {
    const top = await viaWorker(`${FEED}/service-api/LineFeed/Get1x2_VZip?sports=${SPORT_ID}&count=100&lng=en&mode=4&country=${COUNTRY}&partner=${PARTNER}&getEmpty=true`);
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
  return dedupeMatches(all);
}

export async function listLive() {
  const raw = await viaWorker(`${FEED}/service-api/LiveFeed/Get1x2_VZip?sports=${SPORT_ID}&count=500&lng=en&mode=4&country=${COUNTRY}&partner=${PARTNER}&getEmpty=true`);
  const list = (raw?.Value || [])
    .filter((m) => m.I && m.O1 && m.O2 && !isFakeTeam(m.O1) && !isFakeTeam(m.O2) && !isVirtual(m.O1, m.O2, m.LE || m.L || ''))
    .map((m) => ({ id: m.I, home: m.O1, away: m.O2, league: m.LE || m.L || '', start: m.S ? m.S * 1000 : null }));
  return dedupeMatches(list);
}
