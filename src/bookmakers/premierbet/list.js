import { mget, isVirtual, isOutright, splitTeams } from './api.js';

// SportId guineegames validés via probe-pb-tennis-raw (04/08/2026) :
//   1=Football, 2=Basketball (WNBA/BSN/Euroligue), 3=Baseball, 4=Ice Hockey (KHL),
//   5=Tennis (ATP/WTA/Challenger).
// L'ancien mapping 2=Tennis etait faux (validation obsolete).
const SPORT_IDS = { football: '1', tennis: '5', basket: '2', hockey: '4' };
// Regex "non-foot" appliquée UNIQUEMENT en mode football (filtre les catégories
// tennis/basket/etc. leakées dans le feed foot). En tennis on ne filtre pas.
const NON_FOOT_RE = /tennis|baseball|basketball|volleyball|hockey|mma|boxing|cricket|\bnfl\b|\bnba\b|\bnhl\b|\bmlb\b|table tennis|snooker|darts|handball|rugby|badminton|golf|esports?|counter.?strike|dota|starcraft|league of legends/i;
// Regex tennis-specific : exclut les leagues qui ne sont pas du vrai tennis
// (esport tennis, cyber tennis, etc.). Utilisé UNIQUEMENT quand sport=tennis.
const NON_TENNIS_RE = /\be-?tennis\b|cyber tennis|virtual tennis|simulated tennis/i;

function extractEvents(result) {
  if (!result || !result.data) return [];
  const data = result.data;
  if (Array.isArray(data)) return data;
  const out = [];
  for (const cat of (data.categories || [])) {
    for (const comp of (cat.competitions || [])) {
      out.push(...(comp.events || []));
    }
  }
  return out;
}

export async function listMatches({ live = false, horizonHours = 168, maxMatches = 600, sport = 'football' } = {}) {
  const SPORT_ID = SPORT_IDS[sport];
  if (!SPORT_ID) return [];
  const nowMs = Date.now();
  const horizonMs = nowMs + horizonHours * 3600_000;
  const ids = new Map();

  // Pour upcoming, iterer sur plusieurs dates (couvre horizon complet).
  // Foot : 4 jours ; tennis : idem car ATP/WTA sur plusieurs jours.
  // Sans multi-date : listing sous-echantillonne (ex: PB tennis passait de
  // 200 → 7 events car seulement date=today).
  const upcomingDates = [];
  if (!live) {
    const daysAhead = Math.min(Math.ceil(horizonHours / 24), 4);
    for (let d = 0; d < daysAhead; d++) {
      const date = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
      upcomingDates.push(date);
    }
  }
  const endpoints = live
    ? [{ path: '/events/live', extra: { sportId: SPORT_ID, zoomSportId: '61' } }]
    : [
        ...upcomingDates.map((date) => ({
          path: '/events/upcoming',
          extra: { sportId: SPORT_ID, timeOffset: '-60', date },
        })),
        { path: '/events/highlights', extra: { sportId: SPORT_ID } },
      ];

  const results = await Promise.all(endpoints.map(({ path, extra }) => mget(path, extra)));
  const counts = {};

  for (let i = 0; i < results.length; i++) {
    const path = endpoints[i].path;
    const date = endpoints[i].extra?.date;
    const key = path === '/events/upcoming' && date ? `upcoming[${date}]` : path.split('/').pop();
    const events = extractEvents(results[i]);
    counts[key] = events.length;
    for (const ev of events) {
      if (!ev.id || ids.has(ev.id)) continue;
      ids.set(ev.id, ev);
    }
  }

  const out = [];
  let filtered = { outright: 0, virtual: 0, horizon: 0, noTeams: 0, nonFoot: 0 };

  for (const ev of ids.values()) {
    const teams = splitTeams(ev.eventNames);
    if (!teams) { filtered.noTeams++; continue; }
    // Doubles tennis (ex: "Nadal / Federer" vs "Djokovic / Murray") : autorise
    // seulement en tennis. En foot on filtre.
    if (sport === 'football' && (teams.home.includes(' / ') || teams.away.includes(' / '))) { filtered.nonFoot++; continue; }
    const cat = [ev.categoryName, ev.competitionName].filter(Boolean).join(' ');
    if (sport === 'football' && NON_FOOT_RE.test(cat)) { filtered.nonFoot++; continue; }
    if (sport === 'tennis' && NON_TENNIS_RE.test(cat)) { filtered.nonFoot++; continue; }
    const label = `${teams.home} ${teams.away} ${cat}`;
    if (isOutright(ev.eventNames?.join?.(' ') || '')) { filtered.outright++; continue; }
    if (isVirtual(label)) { filtered.virtual++; continue; }
    if (!live) {
      const st = ev.startTime;
      if (!st || st <= nowMs + 2 * 60_000 || st > horizonMs) { filtered.horizon++; continue; }
    }
    out.push({
      id: String(ev.id),
      home: teams.home,
      away: teams.away,
      league: ev.competitionName || ev.categoryName || '',
      start: ev.startTime || null,
    });
    if (out.length >= maxMatches) break;
  }

  const src = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`[premierbet] ${src} unique=${ids.size} kept=${out.length} filtered=(outright:${filtered.outright} virtual:${filtered.virtual} horizon:${filtered.horizon} noTeams:${filtered.noTeams} nonFoot:${filtered.nonFoot})`);
  return out;
}
