// Liste des matchs LNB Pari. `start` est en MILLISECONDES comme tous les autres
// books (l'appariement compare les coups d'envoi numeriquement).
//
// Pre-match : GetTournamentsBySport(sport, 1, {}) donne les ~240 competitions,
// puis GetEventsByTournamentId est appele pour toutes en parallele sur des
// sessions partagees (lots de 60 abonnements).
// Direct : GetLiveEventsBySport(sport, {}) rend tout d'un coup.
//
// Les competitions et matchs marques isCybersport (ESportsBattle, FIFA simule,
// "(replays)") sont ECARTES : ce sont des simulations, sans arbitrage possible.
import { feedInvoke, feedOne, SPORT_CODE, STAGE_PREMATCH } from './api.js';

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function toMatch(ev, league) {
  const v = ev.value || {};
  const teams = v.competitors || [];
  const home = clean(teams[0] && teams[0].name);
  const away = clean(teams[1] && teams[1].name);
  if (!home || !away) return null;
  const ts = Number(v.startTime);
  return {
    id: String(ev.key),
    home,
    away,
    league: clean(league || ''),
    start: Number.isFinite(ts) ? ts * 1000 : null,
    __raw: { stage: v.stage },
  };
}

export async function listPrematch(horizonHours = 72, sport = 'football') {
  const code = SPORT_CODE[sport];
  if (!code) return [];
  const tours = (await feedOne('GetTournamentsBySport', [code, STAGE_PREMATCH, {}]))
    .filter((t) => t.value && !t.value.isCybersport && Number(t.value.prematchEventsCount) > 0);
  if (!tours.length) return [];

  const now = Date.now() / 1000;
  const max = now + horizonHours * 3600;
  const out = [];
  const CHUNK = 60;
  for (let i = 0; i < tours.length; i += CHUNK) {
    const slice = tours.slice(i, i + CHUNK);
    const res = await feedInvoke(slice.map((t) => ({
      target: 'GetEventsByTournamentId', args: [t.key, {}],
    })));
    slice.forEach((t, k) => {
      for (const ev of (res.get(k) || [])) {
        const v = ev.value || {};
        if (ev.isRemoved || v.isCybersport) continue;
        if (Number(v.stage) !== STAGE_PREMATCH) continue;
        const ts = Number(v.startTime);
        if (!Number.isFinite(ts) || ts > max) continue;
        const m = toMatch(ev, t.value.name);
        if (m) out.push(m);
      }
    });
  }
  return out;
}

export async function listLive(sport = 'football') {
  const code = SPORT_CODE[sport];
  if (!code) return [];
  const evs = await feedOne('GetLiveEventsBySport', [code, {}]);
  const ids = [...new Set(evs.map((e) => e.value && e.value.tournamentId).filter(Boolean))];
  // Noms de competitions : un seul appel groupe.
  const names = new Map();
  if (ids.length) {
    for (const t of await feedOne('GetTournamentsByIds', [ids, {}])) {
      if (t.value) names.set(t.key, t.value.name);
    }
  }
  const out = [];
  for (const ev of evs) {
    const v = ev.value || {};
    if (ev.isRemoved || v.isCybersport) continue;
    const m = toMatch(ev, names.get(v.tournamentId));
    if (m) out.push(m);
  }
  return out;
}
