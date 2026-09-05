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
  for (const [i, key] of jinaKeys().entries()) {
    try {
      const res = await fetch(`https://r.jina.ai/${target}`, {
        headers: { authorization: `Bearer ${key}`, 'x-respond-with': 'text', 'x-proxy': 'auto' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const txt = await res.text();
      // Le relais repond en JSON MEME quand il refuse (credits epuises :
      // {"code":402,"name":"InsufficientBalanceError",...}). Un simple parse
      // prendrait ce refus pour un flux vide, donc on exige le succes HTTP et
      // l'absence d'enveloppe d'erreur avant d'accepter la reponse.
      if (res.ok && txt.startsWith('{')) {
        try {
          const json = JSON.parse(txt);
          if (!json?.code && !json?.readableMessage) return json;
        } catch { /* tronque : cle suivante */ }
      }
      console.log(`[casongo] cle #${i + 1} refusee (${res.status}) ${txt.slice(0, 90)}`);
    } catch (e) { console.log(`[casongo] ${path} err=${e.message}`); }
  }
  console.log('[casongo] aucune cle de relais disponible — book muet ce cycle');
  return null;
}
