// Mozzartbet Kenya (www.mozzartbet.co.ke) — API JSON publique du site, aucune
// authentification, aucun Cloudflare : joignable en direct depuis les runners
// GitHub (verifie 2026-09-05 : HTTP 200, 1163 matchs foot, 422 cotes/match).
//   GET  /getAllGames                                 -> catalogue des marches par sport
//   POST /betOffer2   { sportIds, date, size, ... }    -> programme (sans cotes)
//   POST /getBettingOdds { matchIds[], subgames[] }    -> cotes par lot de matchs
// Les cotes NE SONT PAS dans /betOffer2 : il faut toujours /getBettingOdds avec
// la liste des sous-jeux (ids numeriques issus de /getAllGames).
const BASE = 'https://www.mozzartbet.co.ke';

const HDR = {
  accept: 'application/json, text/plain, */*',
  'content-type': 'application/json',
  'x-requested-with': 'XMLHttpRequest',
  origin: BASE,
  referer: BASE + '/en',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

// Identifiants de sport Mozzart. Seul le football est ouvert pour l'instant :
// les autres sports n'ont pas encore de parseur verifie.
export const MOZ_SPORT_IDS = { football: 1 };

async function post(path, body, timeout = 20000) {
  const r = await fetch(BASE + path, {
    method: 'POST', headers: HDR, body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

/** Programme complet d'un sport. `currentPage` est ignore par l'API : on demande
 *  directement une taille couvrant tout le programme. */
export async function mozFetchOffer(sportId, size = 1500) {
  return post('/betOffer2', {
    sportIds: [sportId], competitionIds: [], date: 'all', type: 'betting',
    sort: 'bytime', size, currentPage: 0, specials: null, mostPlayed: false,
    numberOfGames: 0, activeCompleteOffer: false, subgames: [], lang: 'en',
  }, 30000);
}

/** Sous-jeux disponibles pour un sport (ids numeriques a passer a getBettingOdds). */
export async function mozSubgameIds(sportId) {
  const r = await fetch(BASE + '/getAllGames', { headers: HDR, signal: AbortSignal.timeout(20000) });
  if (!r.ok) return [];
  const games = await r.json().catch(() => null);
  const groups = games?.[String(sportId)] || [];
  return [...new Set(groups.flatMap((g) => g?.subgameIds || []))];
}

/** Cotes de plusieurs matchs en UN appel -> Map(matchId -> kodds). */
export async function mozFetchOdds(matchIds, subgames) {
  const rows = await post('/getBettingOdds', { matchIds, subgames }, 30000);
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.id && row.kodds) out.set(String(row.id), row.kodds);
  }
  return out;
}
