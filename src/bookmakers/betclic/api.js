// Client Betclic — via le RELAIS Base44.
//
// Betclic bloque les IP des serveurs GitHub : chaque appel direct repondait
// HTTP 464 (verifie le 03/09/2026 sur toutes les pages), d'ou un catalogue a 0.
// Depuis nos serveurs Base44 le meme backend repond normalement (1600+ matchs,
// jusqu'a 95 marches par affiche). Le scanner passe donc par la fonction
// betclicRelay : la lecture protobuf gRPC-web est faite cote Base44.
const RELAY_TIMEOUT_MS = 120_000;
const ODDS_BATCH = 12; // plafond impose par le relais

function relayUrl() {
  const wh = process.env.WEBHOOK_URL || '';
  if (wh.includes('/functions/')) return wh.replace(/\/functions\/.*$/, '/functions/betclicRelay');
  return 'https://al-ve-pro.base44.app/functions/betclicRelay';
}

async function relay(payload) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), RELAY_TIMEOUT_MS);
  try {
    const res = await fetch(relayUrl(), {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-webhook-secret': process.env.WEBHOOK_SECRET || '' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`betclic_relay_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Mapping sport scanner -> slug Betclic (les slugs diffèrent pour basket/hockey).
export const BETCLIC_SPORTS = { football: 'football', tennis: 'tennis', basket: 'basketball', hockey: 'ice_hockey', volleyball: 'volleyball' };
export const BETCLIC_PAGE = 40;

/** Programme complet d'un sport : [{ id, home, away, league, start }]. */
export async function bcListAll(sport = 'football', { regulation = 'CI' } = {}) {
  const slug = BETCLIC_SPORTS[sport] || sport;
  try {
    const data = await relay({ mode: 'list', sport: slug, regulation });
    return (data.matches || []).filter((m) => m.id && m.home && m.away);
  } catch (e) {
    console.warn(`⚠️ betclic relay list: ${e.message}`);
    return [];
  }
}

/** Tous les marches d'un match : [{ id, name, suspended, selections }]. */
export async function bcMatchMarkets(matchId, { regulation = 'CI' } = {}) {
  try {
    const data = await relay({ mode: 'odds', ids: [matchId], regulation });
    return data.markets?.[String(matchId)] || [];
  } catch (e) {
    console.warn(`⚠️ betclic relay odds ${matchId}: ${e.message}`);
    return [];
  }
}

/** Lecture groupee : { [matchId]: marches }. Un appel pour ODDS_BATCH matchs. */
export async function bcMatchMarketsBatch(ids, { regulation = 'CI' } = {}) {
  const out = {};
  for (let i = 0; i < ids.length; i += ODDS_BATCH) {
    const chunk = ids.slice(i, i + ODDS_BATCH);
    try {
      const data = await relay({ mode: 'odds', ids: chunk, regulation });
      Object.assign(out, data.markets || {});
    } catch (e) {
      console.warn(`⚠️ betclic relay batch: ${e.message}`);
    }
  }
  return out;
}
