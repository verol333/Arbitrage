// Casongo (Congo-Brazzaville) — skin de la plateforme Velisports.
// Lecture DIRECTE via la couche furtive (rotation d'empreintes navigateur +
// retries), exactement comme YellowBet : aucun relais payant pour scanner.
// Le relais Jina reste uniquement un dernier recours si Cloudflare bloque les
// trois tentatives — il est reserve a la prise de pari.
import { stealthGetJson } from '../../net/stealth.js';

const BASE = 'https://prod-api.velisports.com/websitewebapi';
const PARTNER = 'CurrencyId=CDF&LanguageId=fr&PartnerId=2&PartnerName=casongo&TimeZone=0';
const SITE_HEADERS = {
  origin: 'https://casongo.cg',
  referer: 'https://casongo.cg/',
  accept: 'application/json, text/plain, */*',
};

const jinaKeys = () => [process.env.JINA_API_KEY, process.env.JINA_API_KEY_2].filter(Boolean);

// Dernier recours : le relais repond en JSON MEME quand il refuse
// ({"code":402,"name":"InsufficientBalanceError"}), donc on exige le succes HTTP
// et l'absence d'enveloppe d'erreur avant d'accepter la reponse.
async function viaRelay(target, timeoutMs) {
  for (const [i, key] of jinaKeys().entries()) {
    try {
      const res = await fetch(`https://r.jina.ai/${target}`, {
        headers: { authorization: `Bearer ${key}`, 'x-respond-with': 'text', 'x-proxy': 'auto' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const txt = await res.text();
      if (res.ok && txt.startsWith('{')) {
        const json = JSON.parse(txt);
        if (!json?.code && !json?.readableMessage) return json;
      }
      console.log(`[casongo] relais cle #${i + 1} refuse (${res.status})`);
    } catch (e) { console.log(`[casongo] relais err=${e.message}`); }
  }
  return null;
}

export async function casongoGet(path, { timeoutMs = 25_000, allowRelay = true } = {}) {
  const sep = path.includes('?') ? '&' : '?';
  const target = `${BASE}${path}${sep}${PARTNER}`;

  const direct = await stealthGetJson(target, { headers: SITE_HEADERS, timeoutMs });
  if (direct && !direct.code) return direct;

  if (!allowRelay) return null;
  console.log('[casongo] lecture directe bloquee — bascule sur le relais');
  return viaRelay(target, 60_000);
}
