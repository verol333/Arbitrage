// Listing Betika : pagination /v1/uo/matches. La liste ne porte que les 3 cotes
// 1X2 — les marches complets se lisent match par match via /v1/uo/match.
import { btkFetchMatches, BETIKA_SPORT_IDS } from './api.js';

// start_time est en UTC ("2026-09-03 12:30:00").
function toIso(s) {
  const t = Date.parse(String(s || '').replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function toMatch(ev, live) {
  const home = String(ev?.home_team || '').trim();
  const away = String(ev?.away_team || '').trim();
  if (!home || !away || !ev?.parent_match_id) return null;
  return {
    id: String(ev.parent_match_id),
    home,
    away,
    league: [ev?.category, ev?.competition_name].filter(Boolean).join(' — '),
    start: toIso(ev.start_time),
    live,
  };
}

export async function listBetika({ sport = 'football', live = false, horizonHours = 48 } = {}) {
  const sportId = BETIKA_SPORT_IDS[sport];
  if (!sportId) return [];
  const out = [];
  const seen = new Set();
  const maxTs = Date.now() + horizonHours * 3600_000;
  for (let page = 1; page <= 12; page++) {
    const root = await btkFetchMatches({ sportId, live, page, limit: 100 });
    const rows = Array.isArray(root?.data) ? root.data : [];
    if (!rows.length) break;
    for (const ev of rows) {
      const m = toMatch(ev, live);
      if (!m || seen.has(m.id)) continue;
      // En pre-match on borne l'horizon ; en live aucune borne temporelle.
      if (!live && m.start && Date.parse(m.start) > maxTs) continue;
      seen.add(m.id);
      out.push(m);
    }
    if (rows.length < 100) break;
  }
  return out;
}
