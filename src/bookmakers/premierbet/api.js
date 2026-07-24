// PremierBet (Editec) — CF Worker (fiable) + proxy Jina (fallback).
import { proxyFetchText, fetchJson } from '../../net/fetcher.js';

const BASE = 'https://premierbetzone.com/rest';

const CF_WORKERS = [
  'https://hidden-pine-7436.veolalex3.workers.dev',
  'https://billowing-sea-2d8e.alvecapital60.workers.dev',
];

async function viaCfWorker(url) {
  for (const w of CF_WORKERS) {
    const j = await fetchJson(`${w}/?url=${encodeURIComponent(url)}`, { timeoutMs: 12_000 });
    if (j) return j;
  }
  return null;
}

export async function pget(path) {
  const url = `${BASE}/${path}`;
  const j = await viaCfWorker(url);
  if (j && j.code === 200) return j.data;
  const text = await proxyFetchText(url, { timeoutMs: 30_000 });
  if (!text || text.length < 2) return null;
  try { const p = JSON.parse(text); return p && p.code === 200 ? p.data : null; } catch { return null; }
}

export const isVirtual = (s) => /\bcyber|esoccer|e-?soccer|virtual|simulated|\bsrl\b/i.test(s || '');
export const isOutright = (s) => /outright|winner|to win the|top scorer|qualif|advance|group [a-z] winner/i.test(s || '');
export function splitTeams(name) {
  const parts = String(name || '').split(' - ');
  if (parts.length < 2) return null;
  return { home: parts[0].trim(), away: parts.slice(1).join(' - ').trim() };
}
