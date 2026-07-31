// PremierBet mobile API — direct access (no proxy needed).
// Discovered via Android app capture (BlueStacks + mitmproxy).
// Base: sports-api.premierbet.com/cg/v1
const BASE = 'https://sports-api.premierbet.com/cg/v1';
const PARAMS = { country: 'CG', group: 'g5', platform: 'mobile', locale: 'fr' };

export async function mget(path, extra = {}, timeoutMs = 20_000) {
  const ps = new URLSearchParams({ ...PARAMS, ...extra });
  const url = `${BASE}${path}?${ps}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      console.log(`[premierbet] ${path} status=${res.status}`);
      return null;
    }
    return res.json();
  } catch (e) {
    console.log(`[premierbet] ${path} err=${e.message}`);
    return null;
  }
}

export const isVirtual = (s) => /\bcyber|esoccer|e-?soccer|virtual|simulated|\bsrl\b/i.test(s || '');
export const isOutright = (s) => /outright|winner|to win the|top scorer|qualif|advance|group [a-z] winner/i.test(s || '');
export function splitTeams(names) {
  if (Array.isArray(names) && names.length >= 2) return { home: names[0].trim(), away: names[1].trim() };
  const s = String(names || '');
  const parts = s.split(' - ');
  if (parts.length < 2) return null;
  return { home: parts[0].trim(), away: parts.slice(1).join(' - ').trim() };
}
