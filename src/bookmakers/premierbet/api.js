import { stealthGetJson } from '../../net/stealth.js';
import { fetchJson } from '../../net/fetcher.js';

const BASE = 'https://premierbetzone.com/rest';

export async function pget(path) {
  const url = `${BASE}/${path}`;
  const j = await stealthGetJson(url, { timeoutMs: 15_000 });
  if (j && j.code === 200) return j.data;
  const j2 = await fetchJson(url, { timeoutMs: 20_000 });
  return j2 && j2.code === 200 ? j2.data : null;
}

export const isVirtual = (s) => /\bcyber|esoccer|e-?soccer|virtual|simulated|\bsrl\b/i.test(s || '');
export const isOutright = (s) => /outright|winner|to win the|top scorer|qualif|advance|group [a-z] winner/i.test(s || '');
export function splitTeams(name) {
  const parts = String(name || '').split(' - ');
  if (parts.length < 2) return null;
  return { home: parts[0].trim(), away: parts.slice(1).join(' - ').trim() };
}
