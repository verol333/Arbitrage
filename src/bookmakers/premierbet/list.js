// Liste des matchs foot PremierBet Congo (prématch + live).
//   Prématch : /events/upcoming?date=YYYY-MM-DD sur J+0…J+ceil(horizon/24).
//   Live     : /events/live?sportId=1&zoomSportId=61 (liste plate).
// La dédoublonnage se fait par eventId ; les virtuels/outrights sont écartés.
import { pbGet, extractEvents, splitTeams, leagueOf, isVirtual, isOutright } from './api.js';

const SPORT_ID_FOOT = '1';
// Guinee = UTC+0. timeOffset envoye a l'API = 0.
const TZ_OFFSET_MS = 0;

function dayKey(ms) {
  const d = new Date(ms + TZ_OFFSET_MS);
  return d.toISOString().slice(0, 10);
}

function liveMeta(ev) {
  const sb = ev?.scoreboard || {};
  const home = sb.homeScore ?? sb.home ?? null;
  const away = sb.awayScore ?? sb.away ?? null;
  const score = (home != null && away != null) ? `${home}-${away}` : (sb.score || null);
  const minute = sb.minute ?? sb.currentMinute ?? sb.gameMinute ?? null;
  const period = sb.periodName || sb.period || ev?.state || null;
  return { score, minute: minute != null ? Number(minute) : null, period };
}

function buildMatch(ev, { withLive = false } = {}) {
  const teams = splitTeams(ev);
  if (!teams) return null;
  const league = leagueOf(ev);
  const label = `${teams.home} ${teams.away} ${league}`;
  if (isVirtual(label) || isOutright(ev?.eventName || ev?.name || '')) return null;
  const start = Number(ev?.startTime) || null;
  return {
    id: String(ev.id),
    home: teams.home,
    away: teams.away,
    league,
    start,
    __raw: { markets: ev?.markets || null, marketGroups: ev?.marketGroups || null },
    ...(withLive ? { live: liveMeta(ev) } : {}),
  };
}

export async function listPrematch({ horizonHours = 72 } = {}) {
  const nowMs = Date.now();
  const horizonMs = nowMs + horizonHours * 3600 * 1000;
  const days = Math.max(1, Math.ceil(horizonHours / 24) + 1);
  const dates = [];
  for (let i = 0; i < days; i++) dates.push(dayKey(nowMs + i * 24 * 3600 * 1000));

  const seen = new Set();
  const out = [];
  let filteredHorizon = 0, filteredDuplicate = 0, filteredVirtual = 0;

  const pages = await Promise.all(dates.map((date) => pbGet(
    '/events/upcoming', { timeOffset: '0', sportId: SPORT_ID_FOOT, date }, { long: true },
  )));
  // On enrichit aussi via highlights (matchs "à la une" pas toujours dans upcoming).
  pages.push(await pbGet('/events/highlights', { sportId: SPORT_ID_FOOT, timeOffset: '0' }, { long: true }));

  for (const page of pages) {
    for (const ev of extractEvents(page)) {
      if (seen.has(ev.id)) { filteredDuplicate++; continue; }
      const m = buildMatch(ev);
      if (!m) { filteredVirtual++; continue; }
      if (!m.start || m.start <= nowMs + 60 * 1000 || m.start > horizonMs) { filteredHorizon++; continue; }
      seen.add(ev.id);
      out.push(m);
    }
  }
  console.log(`[premierbet] prematch kept=${out.length} dedup=${filteredDuplicate} horizon=${filteredHorizon} virtual/outright=${filteredVirtual}`);
  return out;
}

export async function listLive() {
  const page = await pbGet('/events/live', {
    sportId: SPORT_ID_FOOT, zoomSportId: '61',
  }, { long: false });
  const events = extractEvents(page);
  const out = [];
  for (const ev of events) {
    const m = buildMatch(ev, { withLive: true });
    if (m) out.push(m);
  }
  console.log(`[premierbet] live kept=${out.length}`);
  return out;
}

export async function listMatches({ live = false, horizonHours = 72 } = {}) {
  return live ? listLive() : listPrematch({ horizonHours });
}
