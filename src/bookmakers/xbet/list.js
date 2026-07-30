import { FEED, COUNTRY, PARTNER, viaWorker, viaWorkerCritical, mapXItems, isFakeTeam, isVirtual } from './api.js';
import { teamSim } from '../../core/text.js';

// Sport IDs 1xBet (standards) : 1=Football, 2=Ice Hockey, 3=Basketball,
// 4=Tennis, 12=Volleyball.
const SPORT_IDS = { football: 1, tennis: 4, basketball: 3, hockey: 2, volleyball: 12 };

function isRealChamp(name) {
  return !/spéci|special|alternative|player|joueur|team vs|vs player|winner|vainqueur|to win|outright|long.?term|handicap match|first goalscorer|corner match|booking|cards?( match)?/i.test(name || '');
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

export async function listPrematch({ sport = 'football' } = {}) {
  const sid = SPORT_IDS[sport];
  if (!sid) return [];
  // Appel critique : retry + timeout 10s pour eviter les faux 0 sur les
  // sports secondaires (basket/tennis/hockey) quand 1xbet.cg a un hoquet.
  const champs = await viaWorkerCritical(`${FEED}/service-api/LineFeed/GetChampsZip?sport=${sid}&lng=en&country=${COUNTRY}&partner=${PARTNER}`);
  const champIds = [...new Set((champs?.Value || [])
    .filter((c) => isRealChamp(c.LE || c.L))
    .map((c) => c.LI || c.CI)
    .filter(Boolean))];
  if (!champIds.length) {
    const top = await viaWorkerCritical(`${FEED}/service-api/LineFeed/Get1x2_VZip?sports=${sid}&count=100&lng=en&mode=4&country=${COUNTRY}&partner=${PARTNER}&getEmpty=true`);
    return dedupeMatches(mapXItems(top?.Value));
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

function xbetLiveMeta(m) {
  const sc = m.SC || {};
  const fs = sc.FS || {};
  const s1 = fs.S1, s2 = fs.S2;
  const score = (s1 != null && s2 != null) ? `${s1}-${s2}` : null;
  const minute = sc.TS != null ? Math.floor(Number(sc.TS) / 60) : null;
  const period = sc.CPS || sc.TN || null;
  return { score, minute, period };
}

export async function listLive({ sport = 'football' } = {}) {
  const sid = SPORT_IDS[sport];
  if (!sid) return [];
  const raw = await viaWorkerCritical(`${FEED}/service-api/LiveFeed/Get1x2_VZip?sports=${sid}&count=500&lng=en&mode=4&country=${COUNTRY}&partner=${PARTNER}&getEmpty=true`);
  const list = (raw?.Value || [])
    .filter((m) => m.I && m.O1 && m.O2 && !isFakeTeam(m.O1) && !isFakeTeam(m.O2) && !isVirtual(m.O1, m.O2, m.LE || m.L || ''))
    .map((m) => ({ id: m.I, home: m.O1, away: m.O2, league: m.LE || m.L || '', start: m.S ? m.S * 1000 : null, live: xbetLiveMeta(m) }));
  return dedupeMatches(list);
}
