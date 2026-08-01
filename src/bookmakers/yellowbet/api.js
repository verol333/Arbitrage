import { stealthGetJson } from '../../net/stealth.js';
import { fetchJson } from '../../net/fetcher.js';

const BASE = 'https://yellowbet.cg/services/evapi';
const SET_HEADERS = { brandid: '122', channelid: '4', language: 'fr', terminal: 'yellowbet.cg' };

export async function evapi(url) {
  const j = await stealthGetJson(url, { headers: SET_HEADERS, timeoutMs: 15_000 });
  if (j) return j;
  return fetchJson(url, { headers: SET_HEADERS, timeoutMs: 20_000 });
}

export function isVirtual(ev) {
  const s = `${ev.h || ''} ${ev.a || ''} ${ev.ln || ''}`.toLowerCase();
  return /\bsrl\b|simulated|\besoccer\b|e-?soccer|\bcyber\b|\bvirtual\b|\besports?\b|\bfifa\b/i.test(s);
}

export function toMatch(ev) {
  // Best-effort : YellowBet evapi expose parfois score via ev.hs/ev.as/ev.sc et minute via ev.mm/ev.t.
  const hs = ev.hs ?? ev.homeScore ?? null;
  const as = ev.as ?? ev.awayScore ?? null;
  const score = (hs != null && as != null) ? `${hs}-${as}` : (ev.sc || null);
  const minute = ev.mm ?? ev.mn ?? ev.min ?? ev.t ?? null;
  const period = ev.sst ?? ev.stat ?? ev.per ?? null;
  return {
    id: String(ev.id),
    home: ev.h || '', away: ev.a || '', league: ev.ln || '',
    start: ev.gt ? new Date(ev.gt).getTime() : null,
    __raw: { bts: Array.isArray(ev.bts) ? ev.bts : [] },
    live: { score, minute: Number.isFinite(minute) ? minute : null, period },
  };
}

export const BASE_URL = BASE;

// Re-fetch les cotes fraîches d'un match unique (utilisé au confirm live).
// L'API YellowBet expose /event/GetEventDetails?id=XXX qui renvoie l'objet
// ev complet avec bts (bet types = cotes) frais.
export async function fetchMatchBts(matchId) {
  const url = `${BASE}/event/GetEventDetails?id=${encodeURIComponent(matchId)}`;
  const j = await evapi(url).catch(() => null);
  const ev = j?.data;
  return Array.isArray(ev?.bts) ? ev.bts : [];
}
