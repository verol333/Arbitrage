// BETKING (Nigeria) — cotes servies par l'application AL VE CAPITAL.
//
// Le site protège son API par Cloudflare : le défi « Just a moment… » bloque
// toute IP serveur, runners GitHub compris. La collecte est donc faite par
// l'application depuis un vrai navigateur (qui franchit le défi), mise en
// cache, puis exposée ici en vocabulaire standard du scanner :
// match_1 / match_X / match_2 / dc_… / btts_… / dnb_… / match_over_x.5.
const FEED_URL = process.env.BETKING_FEED_URL || 'https://al-ve-pro.base44.app/functions/betkingOddsFeed';
const TTL_MS = 120_000;

let cache = { at: 0, data: null };

// `refresh` : demandé une fois par cycle par listMatches. Le serveur ne relève
// le bookmaker que si son cache dépasse 15 minutes (une session navigateur au
// maximum tous les quarts d'heure, jamais à chaque match).
export async function feed(horizonHours = 72, { refresh = false } = {}) {
  if (!refresh && cache.data && Date.now() - cache.at < TTL_MS) return cache.data;
  const res = await fetch(FEED_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ horizonHours, refresh }),
    signal: AbortSignal.timeout(refresh ? 120_000 : 30_000),
  });
  if (!res.ok) throw new Error('betking_feed_' + res.status);
  const json = await res.json().catch(() => ({}));
  const matches = Array.isArray(json.matches) ? json.matches : [];
  if (matches.length) cache = { at: Date.now(), data: matches };
  return matches;
}
