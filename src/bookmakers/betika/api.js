// Betika (skin Betika Congo, api-cd.betika.com) — API JSON publique, aucune
// authentification, aucun Cloudflare : joignable en direct depuis les runners
// GitHub (verifie 2026-09-03 : HTTP 200, 116 Ko sur un match de Liga).
//   /v1/uo/matches?sport_id=3&tab=upcoming|live  → liste paginee
//   /v1/uo/match?parent_match_id=<id>             → tous les marches + cotes
const BASE = 'https://api-cd.betika.com';

const HDR = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'fr',
  origin: 'https://www.betika.com',
  referer: 'https://www.betika.com/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
};

// sport_id Betika : 3 = football (verifie sur le flux reel ; 14 renvoie vide).
export const BETIKA_SPORT_IDS = { football: 3 };

async function getJson(url, timeoutMs = 20_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: HDR, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (_e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export function btkFetchMatches({ sportId, live = false, page = 1, limit = 100 }) {
  const tab = live ? 'live' : 'upcoming';
  return getJson(`${BASE}/v1/uo/matches?page=${page}&limit=${limit}&sport_id=${sportId}&tab=${tab}`);
}

export function btkFetchMatch(parentMatchId) {
  return getJson(`${BASE}/v1/uo/match?parent_match_id=${parentMatchId}`);
}
