// PremierBet mobile API — direct access (no proxy needed).
// Discovered via Android app capture (BlueStacks + mitmproxy).
// Base: sports-api.premierbet.com/cg/v1
const BASE = 'https://sports-api.premierbet.com/cg/v1';
const PARAMS = { country: 'CG', group: 'g5', platform: 'mobile', locale: 'fr' };

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9',
};

const SDO_KEY = typeof process !== 'undefined' && process.env?.SCRAPE_DO_KEY;

export async function mget(path, extra = {}, timeoutMs = 20_000) {
  const ps = new URLSearchParams({ ...PARAMS, ...extra });
  const targetUrl = `${BASE}${path}?${ps}`;

  // Try direct first
  try {
    const res = await fetch(targetUrl, {
      headers: HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return res.json();

    // 403/503 → try Scrape.do fallback if key is available
    if ((res.status === 403 || res.status === 503) && SDO_KEY) {
      return sdoFetch(targetUrl, timeoutMs);
    }
    console.log(`[premierbet] ${path} status=${res.status}`);
    return null;
  } catch (e) {
    // Network error → try Scrape.do if available
    if (SDO_KEY) {
      try { return sdoFetch(targetUrl, timeoutMs); }
      catch { /* fall through */ }
    }
    console.log(`[premierbet] ${path} err=${e.message}`);
    return null;
  }
}

async function sdoFetch(targetUrl, timeoutMs) {
  const qs = new URLSearchParams({ token: SDO_KEY, url: targetUrl });
  const res = await fetch(`https://api.scrape.do/?${qs}`, {
    signal: AbortSignal.timeout(Math.max(timeoutMs, 30_000)),
  });
  if (!res.ok) {
    console.log(`[premierbet/sdo] status=${res.status}`);
    return null;
  }
  return res.json();
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
