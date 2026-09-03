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

// Parse ev.lv qui, pour les vrais LIVE, est une string JSON contenant
// { hs, as, t, p, hcc, acc, hyc, ayc, ... }. Pour les non-live c'est absent.
function parseLv(ev) {
  const raw = ev?.lv;
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function toMatch(ev) {
  const lv = parseLv(ev);
  // Priorite : payload lv (vrai LIVE) > fallback flat fields.
  const hs = lv?.hs ?? ev.hs ?? ev.homeScore ?? null;
  const as = lv?.as ?? ev.as ?? ev.awayScore ?? null;
  const score = (hs != null && as != null) ? `${hs}-${as}` : (ev.sc || null);
  const minRaw = lv?.t ?? ev.mm ?? ev.mn ?? ev.min ?? ev.t ?? null;
  const minute = minRaw != null ? Number(minRaw) : null;
  const period = lv?.p ?? ev.sst ?? ev.stat ?? ev.per ?? null;
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
  // GetEventDetails repond 403 systematiquement (800 refus sur le run live du
  // 03/09/2026) ; GetEvents?eventIds= renvoie le meme objet ev complet (bts frais).
  const url = `${BASE}/event/GetEvents?eventIds=${encodeURIComponent(matchId)}&take=1`;
  const j = await evapi(url).catch(() => null);
  const ev = Array.isArray(j?.data) ? j.data[0] : j?.data;
  return Array.isArray(ev?.bts) ? ev.bts : [];
}
