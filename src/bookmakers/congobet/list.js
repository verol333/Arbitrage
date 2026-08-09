import { CONGO_API, congoJson } from './api.js';

// Sport IDs Congobet (validés via probe v3, sample d'événements) :
//   101=Football (K-League 2 etc.), 102=Basketball (VBA), 103=Tennis (ATP),
//   104=Rugby XV (Currie Cup), 105=Canadian Football (CFL), 107=Baseball (MLB).
// Hockey/Volley : non identifiés dans le catalogue Congobet (probe testé 101..115).
const SPORT_IDS = { football: '101', tennis: '103', basket: '102' };

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

function sportIdFor(sport) { return SPORT_IDS[sport] || null; }

const isVirtual = (ev) => {
  if (ev.isVirtual) return true;
  const s = `${ev.homeTeamName || ''} ${ev.awayTeamName || ''} ${(ev.categories || [])[0] || ''}`.toLowerCase();
  return /\bsrl\b|simulated|\besoccer\b|e-?soccer|\bcyber\b|\bvirtual\b|\besports?\b|\bfifa\b/i.test(s);
};

export async function listPrematch(sport = 'football') {
  const SPORT_ID = sportIdFor(sport);
  if (!SPORT_ID) return [];
  const seen = new Set(); const out = [];
  const addItems = (items) => {
    for (const ev of items) {
      if (isVirtual(ev) || seen.has(ev.id)) continue;
      seen.add(ev.id);
      out.push({
        id: ev.id, home: ev.homeTeamName, away: ev.awayTeamName,
        league: ev.categoryPath || (ev.categories || [])[0] || '',
        start: ev.expectedStart ? new Date(ev.expectedStart).getTime() : null,
      });
    }
  };
  // Query params : le param betTypeId=10001 (id 1X2 foot) filtre les events
  // qui n'ont PAS ce marche → retourne 0 pour tennis (pas de 1X2 en tennis).
  // Fix : omettre betTypeId pour les sports != football. Probe v2 confirme :
  //   events?eventCategoryIds=54994&betTypeId=10001 → 0
  //   events?eventCategoryIds=54994                 → 8 (De Minaur vs Tsitsipas)
  const btParam = sport === 'football' ? '&fetchEventBetTypesMode=0&betTypeId=10001' : '';
  const leaves = await listLeafCategories(SPORT_ID);
  if (leaves.length) {
    const BATCH = 16;
    for (let i = 0; i < leaves.length; i += BATCH) {
      const batch = leaves.slice(i, i + BATCH);
      await Promise.all(batch.map(async (lf) => {
        for (let off = 0; off < 400; off += 20) {
          const page = await congoJson(`${CONGO_API}events?eventCategoryIds=${lf.id}&offset=${off}&length=50${btParam}&l=fr`);
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
    const page = await congoJson(`${CONGO_API}events?eventCategoryIds=${SPORT_ID}&offset=${p * 50}&length=50${btParam}&l=fr`);
    const items = Array.isArray(page) ? page : (page?.data || null);
    if (!Array.isArray(items) || !items.length) { if (++empty >= 2) break; continue; }
    empty = 0;
    addItems(items);
  }
  return out;
}

function congoLiveMeta(ev) {
  const home = ev.homeTeamScore != null ? ev.homeTeamScore : null;
  const away = ev.awayTeamScore != null ? ev.awayTeamScore : null;
  const score = (home != null && away != null) ? `${home}-${away}` : (ev.score || null);
  // stateDetails ex: "Pause1", "Period1" — utilisable comme période.
  const period = ev.stateDetails || ev.state || null;
  // Congobet ne renvoie pas la minute courante ; laissé à null.
  return { score, minute: null, period };
}

export async function listLive(sport = 'football') {
  const SPORT_ID = sportIdFor(sport);
  if (!SPORT_ID) return [];
  const raw = await congoJson(`${CONGO_API}events/sports/live?offset=0&length=200`, { noCache: true });
  return (Array.isArray(raw) ? raw : [])
    .filter((ev) => congoSportId(ev) === SPORT_ID && !isVirtual(ev))
    .map((ev) => ({
      id: ev.id, home: ev.homeTeamName, away: ev.awayTeamName,
      league: (ev.categories || [])[0] || '',
      start: ev.expectedStart ? new Date(ev.expectedStart).getTime() : null,
      live: congoLiveMeta(ev),
    }));
}
