// Listing Betika : pagination /v1/uo/matches (pre-match uniquement).
// La liste ne porte que les 3 cotes 1X2 — les marches complets se lisent match
// par match via /v1/uo/match.
// IMPORTANT : le parametre `tab` est ignore par l'API publique (tab=live,
// today, inplay renvoient tous le meme programme a venir, dates futures). Il
// n'existe donc AUCUN flux in-play exploitable ici — se servir de tab=live
// produirait de faux surebets live sur des matchs pas encore commences.
// Le flux allume (live-cd.betika.com) est derriere Cloudflare 403.
import { btkFetchMatches, BETIKA_SPORT_IDS } from './api.js';

// start_time est deja en UTC ("2026-09-03 16:00:00" = 16:00 UTC, verifie le
// 03/09 sur 54 affiches communes avec SportyBet : ecart 0 minute). Aucune
// conversion de fuseau.
// IMPORTANT : `start` doit etre un NOMBRE de millisecondes, comme tous les
// autres bookmakers — l'appariement compare les heures numeriquement, une
// chaine ISO ne matche jamais (cause du betika:0 des premiers cycles).
function toMs(s) {
  const t = Date.parse(String(s || '').replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? t : null;
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
    start: toMs(ev.start_time),
    live,
  };
}

export async function listBetika({ sport = 'football', live = false, horizonHours = 72 } = {}) {
  const sportId = BETIKA_SPORT_IDS[sport];
  if (!sportId || live) return [];
  const out = [];
  const seen = new Set();
  const maxTs = Date.now() + horizonHours * 3600_000;
  for (let page = 1; page <= 60; page++) {
    const root = await btkFetchMatches({ sportId, live, page, limit: 100 });
    const rows = Array.isArray(root?.data) ? root.data : [];
    if (!rows.length) break;
    // Flux trie par heure de debut croissante : une page entierement au-dela de
    // l'horizon signifie que tout le reste l'est aussi.
    let beyond = 0;
    for (const ev of rows) {
      const m = toMatch(ev, false);
      if (!m) continue;
      if (m.start && m.start > maxTs) { beyond++; continue; }
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
    if (beyond === rows.length || rows.length < 100) break;
  }
  return out;
}
