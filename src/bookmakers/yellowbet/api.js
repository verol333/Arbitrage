import { stealthGetJson } from '../../net/stealth.js';
import { proxyFetchJson } from '../../net/fetcher.js';

const BASE = 'https://yellowbet.cg/services/evapi';
const SET_HEADERS = { brandid: '122', channelid: '4', language: 'fr', terminal: 'yellowbet.cg' };

export async function evapi(url) {
  const j = await stealthGetJson(url, { headers: SET_HEADERS, timeoutMs: 15_000 }).catch(() => null);
  if (j) return j;
  return proxyFetchJson(url, { setHeaders: SET_HEADERS, timeoutMs: 30_000 });
}

export function isVirtual(ev) {
  const s = `${ev.h || ''} ${ev.a || ''} ${ev.ln || ''}`.toLowerCase();
  return /\bsrl\b|simulated|\besoccer\b|e-?soccer|\bcyber\b|\bvirtual\b|\besports?\b|\bfifa\b/i.test(s);
}

export function toMatch(ev) {
  return {
    id: String(ev.id),
    home: ev.h || '', away: ev.a || '', league: ev.ln || '',
    start: ev.gt ? new Date(ev.gt).getTime() : null,
    __raw: { bts: Array.isArray(ev.bts) ? ev.bts : [] },
  };
}

export const BASE_URL = BASE;
