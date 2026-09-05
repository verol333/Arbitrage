// Casongo (Congo-Brazzaville) — skin de la plateforme Velisports.
// prod-api.velisports.com refuse les IP de datacenter (Cloudflare) : chaque
// lecture passe par le relais Jina en proxy residentiel. Cette voie ne demande
// AUCUN jeton utilisateur (l'ancien CASONGO_TOKEN expirait tous les 30 jours et
// laissait le book muet des qu'il tombait).
const BASE = 'https://prod-api.velisports.com/websitewebapi';
const PARTNER = 'CurrencyId=CDF&LanguageId=fr&PartnerId=2&PartnerName=casongo&TimeZone=0';

const jinaKeys = () => [process.env.JINA_API_KEY, process.env.JINA_API_KEY_2].filter(Boolean);

export async function casongoGet(path, { timeoutMs = 60_000 } = {}) {
  const sep = path.includes('?') ? '&' : '?';
  const target = `${BASE}${path}${sep}${PARTNER}`;
  for (const key of jinaKeys()) {
    try {
      const res = await fetch(`https://r.jina.ai/${target}`, {
        headers: { authorization: `Bearer ${key}`, 'x-respond-with': 'text', 'x-proxy': 'auto' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const txt = await res.text();
      if (txt.startsWith('{')) {
        try { return JSON.parse(txt); } catch { /* tronque : cle suivante */ }
      }
      console.log(`[casongo] ${path} relais=${res.status} ${txt.slice(0, 100)}`);
    } catch (e) { console.log(`[casongo] ${path} err=${e.message}`); }
  }
  return null;
}
