// Casongo (Congo-Brazzaville) — bookmaker sur plateforme Velisports/VeliGroup.
// L'API prod-api.velisports.com est protégée par Cloudflare Bot Management (403
// depuis toute IP cloud). Elle demande aussi un JWT Bearer utilisateur (format
// custom Velisports, expire ~30 jours). On passe par Scrape.do super=true pour
// résidentialiser l'IP, exactement comme la stratégie PremierBet historique.
// Le token est stocké en GitHub Secret CASONGO_TOKEN.
const BASE = 'https://prod-api.velisports.com/websitewebapi';
const QS_BASE = 'CurrencyId=XAF&LanguageId=fr&PartnerId=2&PartnerName=casongo&TimeZone=1';

function browserHeaders(token) {
  return {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'fr-FR,fr;q=0.8',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    origin: 'https://launcher.velisports.com',
    referer: 'https://launcher.velisports.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    'vsb-integration-token': '',
    'vsb-start-time': new Date().toISOString(),
    'vsb-trace-id': 'TRACEWEBAPPproduction' + Math.random().toString(36).slice(2, 22),
  };
}

// Fetch via Scrape.do (super=true active les résidentiels — CF laisse passer).
// customHeaders=true → Scrape.do forwarde nos headers au serveur cible.
// geoCode=us : residentiel US (test empirique 2026-08-10 : geoCode=fr bloque
// TOUT en 401, US laisse passer GetPrematchTree mais bloque GetMatchById 401.
// Cause probable : le token est lie au fingerprint session cote Velisports,
// non transposable a une IP arbitraire pour endpoints auth-strict).
export async function casongoGet(path, { timeoutMs = 30_000, noCache = false } = {}) {
  const token = process.env.CASONGO_TOKEN;
  const sdKey = process.env.SCRAPE_DO_KEY;
  if (!token) { console.log('[casongo] CASONGO_TOKEN absent'); return null; }
  if (!sdKey) { console.log('[casongo] SCRAPE_DO_KEY absent'); return null; }
  const sep = path.includes('?') ? '&' : '?';
  const target = `${BASE}${path}${sep}${QS_BASE}${noCache ? `&_t=${Date.now()}` : ''}`;
  const proxied = `https://api.scrape.do/?token=${sdKey}&url=${encodeURIComponent(target)}&customHeaders=true&super=true&geoCode=us`;
  try {
    const res = await fetch(proxied, { signal: AbortSignal.timeout(timeoutMs), headers: browserHeaders(token) });
    if (!res.ok) { console.log(`[casongo] ${path} status=${res.status}`); return null; }
    const txt = await res.text();
    try { return JSON.parse(txt); } catch { console.log(`[casongo] ${path} non-JSON len=${txt.length}`); return null; }
  } catch (e) { console.log(`[casongo] ${path} err=${e.message}`); return null; }
}
