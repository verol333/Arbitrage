// YellowBet evapi — passe par CF Worker (fiable) ou Jina (fallback).
import { proxyFetchJson, fetchJson } from '../../net/fetcher.js';
import { config } from '../../config.js';

const BASE = 'https://yellowbet.cg/services/evapi';
const SET_HEADERS = { brandid: '122', channelid: '4', language: 'fr', terminal: 'yellowbet.cg' };

const CF_WORKERS = [
  'https://hidden-pine-7436.veolalex3.workers.dev',
  'https://billowing-sea-2d8e.alvecapital60.workers.dev',
];

async function viaCfWorker(url) {
  const headers = {};
  for (const [k, v] of Object.entries(SET_HEADERS)) headers[`x-forward-${k}`] = v;
  for (const w of CF_WORKERS) {
    const j = await fetchJson(`${w}/?url=${encodeURIComponent(url)}`, { headers, timeoutMs: 12_000 });
    if (j) return j;
  }
  return null;
}

export async function evapi(url) {
  const j = await viaCfWorker(url);
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
