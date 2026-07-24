// Listing Congobet multi-sport (par catégorie feuille) + live.
import { CONGO_API, congoJson } from './api.js';

const SPORT_IDS = { football: '101', tennis: '103' };

async function listLeafCategories(sportId) {
  const cats = await congoJson(`${CONGO_API}eventCategories/${sportId}?l=fr`);
  if (!Array.isArray(cats)) return [];
  const leaves = [];
  const walk = (node) => {
    const subs = node.subCategories || [];
    if (!subs.length) { if ((node.eventsCount || 0) > 0) leaves.push({ id: node.id, count: node.eventsCount }); }
    else subs.forEach(walk);
  };
  cats.forEach(walk);
  return leaves;
}

const congoSportId = (ev) => (ev.categoryPath || '').split('/').filter(Boolean)[0] || '?';

export async function listPrematch({ sport = 'football' } = {}) {
  const SPORT_ID = SPORT_IDS[sport] || SPORT_IDS.football;
  const seen = new Set(); const out = [];
  const addItems = (items) => {
    for (const ev of items) {
      if (ev.isVirtual || seen.has(ev.id)) continue;
      seen.add(ev.id);
      out.push({
        id: ev.id, home: ev.homeTeamName, away: ev.awayTeamName,
        league: ev.categoryPath || (ev.categories || [])[0] || '',
        start: ev.expectedStart ? new Date(ev.expectedStart).getTime() : null,
      });
    }
  };
  const leaves = await listLeafCategories(SPORT_ID);
  if (leaves.length) {
    const BATCH = 8;
    for (let i = 0; i < leaves.length; i += BATCH) {
      const batch = leaves.slice(i, i + BATCH);
      await Promise.all(batch.map(async (lf) => {
        for (let off = 0; off < 400; off += 20) {
          const page = await congoJson(`${CONGO_API}events?eventCategoryIds=${lf.id}&offset=${off}&length=50&fetchEventBetTypesMode=0&betTypeId=10001&l=fr`);
          const items = Array.isArray(page) ? page : (page?.data || null);
          if (!Array.isArray(items) || !items.length) break;
          addItems(items);
          if (items.length < 20) break;
        }
      }));
    }
  }
  let empty = 0;
  for (let p = 0; p < 6; p++) {
    const page = await congoJson(`${CONGO_API}events?eventCategoryIds=${SPORT_ID}&offset=${p * 50}&length=50&fetchEventBetTypesMode=0&betTypeId=10001&l=fr`);
    const items = Array.isArray(page) ? page : (page?.data || null);
    if (!Array.isArray(items) || !items.length) { if (++empty >= 2) break; continue; }
    empty = 0;
    addItems(items);
  }
  return out;
}

const isVirtual = (ev) => {
  if (ev.isVirtual) return true;
  const s = `${ev.homeTeamName || ''} ${ev.awayTeamName || ''} ${(ev.categories || [])[0] || ''}`.toLowerCase();
  return /\bsrl\b|simulated|\besoccer\b|e-?soccer|\bcyber\b|\bvirtual\b|\besports?\b|\bfifa\b/i.test(s);
};

export async function listLive({ sport = 'football' } = {}) {
  const SPORT_ID = SPORT_IDS[sport] || SPORT_IDS.football;
  const raw = await congoJson(`${CONGO_API}events/sports/live?offset=0&length=200`);
  return (Array.isArray(raw) ? raw : [])
    .filter((ev) => congoSportId(ev) === SPORT_ID && !isVirtual(ev))
    .map((ev) => ({
      id: ev.id, home: ev.homeTeamName, away: ev.awayTeamName,
      league: (ev.categories || [])[0] || '',
      start: ev.expectedStart ? new Date(ev.expectedStart).getTime() : null,
    }));
}
