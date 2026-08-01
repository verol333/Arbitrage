// BetPawa football listing + odds : fait UN appel protobuf qui retourne
// à la fois les matchs ET leurs cotes 1X2 (+ marketTypes additionnels).
// On mémorise le raw dans __raw pour le parser dans getOdds sans refetch.
import { bpGetStrings, buildEventsUrl, isVirtual, splitTeams } from './api.js';
import { betpawaFlatOdds } from './parse.js';

export async function listMatches({ live = false, horizonHours = 168, maxMatches = 600 } = {}) {
  const nowMs = Date.now();
  const horizonMs = nowMs + horizonHours * 3600 * 1000;
  const eventType = live ? 'LIVE' : 'UPCOMING';

  // BetPawa paginate via skip/take. On boucle jusqu'à épuiser (take=100/page).
  const seen = new Set();
  const out = [];
  const PAGE = 100;

  for (let skip = 0; skip < maxMatches && skip < 3000; skip += PAGE) {
    const url = buildEventsUrl({ eventType, skip, take: PAGE });
    const strings = await bpGetStrings(url);
    if (!strings.length) break;

    // Parse matches from string stream — cherche IDs (8 chiffres) suivis de
    // "Home - Away" (nom complet du match). Copie fidèle de la logique
    // Worker CF du user, mais sans limite 20 et avec extraction odds étendue.
    const matches = parseMatchesFromStrings(strings);
    if (!matches.length) break;

    let addedThisPage = 0;
    for (const m of matches) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      if (isVirtual(`${m.home} ${m.away}`)) continue;
      // eventType UPCOMING → tous futurs (pas de champ start dans protobuf
      // extrait par ASCII — on filtre par horizon plus tard si dispo).
      out.push({
        id: m.id, home: m.home, away: m.away, league: '',
        start: null,
        __raw: { strings, matchIndex: m.strIndex },
      });
      addedThisPage++;
    }
    if (addedThisPage === 0) break; // Fin de pagination
  }

  console.log(`[betpawa] ${eventType} : ${out.length} matchs foot (unique après filtres)`);
  return out;
}

// Parse : parcourt les strings, détecte les blocs match par pattern
// "8 chiffres" suivi de "Home - Away". Retourne { id, home, away, strIndex }.
function parseMatchesFromStrings(strings) {
  const out = [];
  const MARKET_TYPE_IDS = new Set(['28000810', '28000850']);  // exclusions
  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    if (!/^\d{7,10}$/.test(s)) continue;
    if (MARKET_TYPE_IDS.has(s)) continue;
    const name = strings[i + 1] || '';
    if (!name.includes(' - ') || /1X2|UP|LIVE|UPCOMING/.test(name)) continue;
    const teams = splitTeams(name);
    if (!teams) continue;
    out.push({ id: s, home: teams.home, away: teams.away, strIndex: i });
    i += 3;
  }
  return out;
}
