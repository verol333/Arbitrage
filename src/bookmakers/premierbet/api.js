// VRAI flux PremierBet (verifie 08/09/2026).
// Cloudflare bloque les IP de datacenter sur les routes /cg/, /cd/, /ci/, /gh/,
// mais PAS sur /cm/ (Cameroun) : meme serveur, meme sportsbook, meme livre.
// Comparaison faite sur FC Bruges - Aston Villa (Ligue des Champions, 08/09/2026),
// cotes Congo (event 7448484) vs cotes lues ici (event 7448464, providerId
// betradar 74165870) : 1X2 2.60/3.55/2.60, 2 Buts d'avance 2.55/3.48/2.55,
// Total de buts 0.5 -> 5.5 = 1.03/11.00, 1.19/4.50, 1.63/2.25, 2.50/1.52,
// 4.40/1.20, 8.00/1.07 -> IDENTIQUES au centieme, memes onglets, meme ordre.
// Avant ce correctif on lisait Guinee Games (country=GN group=g6) comme
// approximation : autre groupe de cotes, donc marges potentiellement differentes.
// Le pont entre les deux pays se fait par providerId (id betradar global) ;
// les ids internes d'event diffferent d'un pays a l'autre.
const BASE = 'https://sports-api.premierbet.com/cm/v1';
const PARAMS = { country: 'CM', group: 'g1', platform: 'desktop', locale: 'fr' };

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  'Referer': 'https://www.premierbet.com/',
  'Origin': 'https://www.premierbet.com',
};

// noCache=true -> ajoute _t=timestamp pour casser tout cache upstream (CDN, proxy).
// Utilise en live et au re-fetch confirm pour garantir des cotes fraiches.
export async function mget(path, extra = {}, timeoutMs = 20_000, { noCache = false } = {}) {
  const params = { ...PARAMS, ...extra };
  if (noCache) params._t = String(Date.now());
  const ps = new URLSearchParams(params);
  const targetUrl = `${BASE}${path}?${ps}`;
  try {
    const res = await fetch(targetUrl, {
      headers: noCache ? { ...HEADERS, 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } : HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) { console.log(`[premierbet] ${path} status=${res.status}`); return null; }
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
