// PremierBet est protégé par Cloudflare (Scrape.do 429 constants). On utilise
// Guinée Games — bookmaker guinéen qui partage les MÊMES codes marché
// (id=3 1X2, id=7 BTTS, id=17 DC, id=29 Total, id=353/352 team totals, etc.).
// Structure JSON identique : data.categories[].competitions[].events[].markets[].outcomes[].
// On expose ces cotes SOUS L'ETIQUETTE "premierbet" dans le scan (le user les
// utilise comme cotes PB — même sportsbook technique, différents pays).
const BASE = 'https://sports-api.guineegames.com/v1';
const PARAMS = { country: 'GN', group: 'g6', platform: 'desktop', locale: 'fr' };

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  'Referer': 'https://www.guineegames.com/',
  'Origin': 'https://www.guineegames.com',
};

export async function mget(path, extra = {}, timeoutMs = 20_000) {
  const ps = new URLSearchParams({ ...PARAMS, ...extra });
  const targetUrl = `${BASE}${path}?${ps}`;
  try {
    const res = await fetch(targetUrl, {
      headers: HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) { console.log(`[premierbet/gg] ${path} status=${res.status}`); return null; }
    return res.json();
  } catch (e) {
    console.log(`[premierbet/gg] ${path} err=${e.message}`);
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
