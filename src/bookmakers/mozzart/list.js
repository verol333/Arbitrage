// Listing Mozzartbet : un seul appel /betOffer2 rend tout le programme du sport
// (1163 matchs foot mesures le 05/09/2026). Le parametre currentPage est ignore
// par l'API, donc aucune pagination : on borne par `size`.
// startTime est un timestamp en MILLISECONDES UTC — meme unite que les autres
// bookmakers, aucune conversion de fuseau.
import { mozFetchOffer, MOZ_SPORT_IDS } from './api.js';

function toMatch(ev) {
  const parts = Array.isArray(ev?.participants) ? ev.participants : [];
  const home = String(parts[0]?.name || '').trim();
  const away = String(parts[1]?.name || '').trim();
  if (!home || !away || !ev?.id) return null;
  const start = Number(ev.startTime);
  return {
    id: String(ev.id),
    home,
    away,
    league: String(ev?.competition?.name || ev?.competition_name_en || '').trim(),
    start: Number.isFinite(start) ? start : null,
    live: false,
    __raw: { gameCounts: ev.gameCounts },
  };
}

export async function listMozzart({ sport = 'football', live = false, horizonHours = 72 } = {}) {
  const sportId = MOZ_SPORT_IDS[sport];
  if (!sportId || live) return [];
  const root = await mozFetchOffer(sportId);
  const rows = Array.isArray(root?.matches) ? root.matches : [];
  const now = Date.now();
  const maxTs = now + horizonHours * 3600000;
  const out = [];
  const seen = new Set();
  for (const ev of rows) {
    const m = toMatch(ev);
    if (!m || seen.has(m.id)) continue;
    // Un match deja commence n'a plus de cotes pre-match fiables ici : le flux
    // ne distingue pas l'in-play, on s'en tient donc au strictement a venir.
    if (!m.start || m.start < now + 60000 || m.start > maxTs) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}
