// PremierBet (Editec) — l'API bloque les IP datacenter → passe par proxy.
// Port fidèle de shared/premierbetClient.ts.
import { proxyFetchText } from '../../net/fetcher.js';

const BASE = 'https://premierbetzone.com/rest';

// Retour attendu : le proxy renvoie du texte JSON avec { code:200, data:... }.
export async function pget(path) {
  const text = await proxyFetchText(`${BASE}/${path}`, { timeoutMs: 45_000 });
  if (!text || text.length < 2) return null;
  try { const j = JSON.parse(text); return j && j.code === 200 ? j.data : null; } catch { return null; }
}

export const isVirtual = (s) => /\bcyber|esoccer|e-?soccer|virtual|simulated|\bsrl\b/i.test(s || '');
export const isOutright = (s) => /outright|winner|to win the|top scorer|qualif|advance|group [a-z] winner/i.test(s || '');
export function splitTeams(name) {
  const parts = String(name || '').split(' - ');
  if (parts.length < 2) return null;
  return { home: parts[0].trim(), away: parts.slice(1).join(' - ').trim() };
}
