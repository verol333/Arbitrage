// Bet9ja — flux public des sports / compétitions / matchs / marchés.
// Aucun compte, aucun jeton : l'API du site est anonyme. Akamai exige en
// revanche l'origine, le referer et un accept-language, sinon 403.
import { proxyFetchJson } from '../../net/fetcher.js';

export const B9_FEED = 'https://sports.bet9ja.com/desktop/feapi/PalimpsestAjax';
export const B9_VERSION = '1.331.0.251';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';

export const B9_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'fr-FR,fr;q=0.9',
  'user-agent': UA,
  origin: 'https://sports.bet9ja.com',
  referer: 'https://sports.bet9ja.com/',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
};

// Toutes les lectures passent par la couche proxy commune (fetcher.js) : Bet9ja
// refuse les IP de datacenter sans referer/origine, et certains egress (Cloudflare)
// sont bloques par Akamai.
export async function feedD(route, { noCache = false } = {}) {
  const sep = route.includes('?') ? '&' : '?';
  const url = B9_FEED + '/' + route + (noCache ? sep + '_t=' + Date.now() : '');
  const j = await proxyFetchJson(url, { headers: B9_HEADERS, timeoutMs: 20000 });
  if (j && j.R && j.R !== 'OK') throw new Error('bet9ja_feed:' + String(j.R).slice(0, 60));
  return (j && j.D) || {};
}

// Palette complète des sports (sports, zones, compétitions, prochaine date).
export async function b9Palette() {
  const D = await feedD('GetSports?DISP=0&v_cache_version=' + B9_VERSION);
  return D.PAL || {};
}

// Tous les marchés d'un match, avec le dictionnaire de signes de l'événement.
export async function b9Event(eventId, { noCache = false } = {}) {
  return feedD('GetEvent?EVENTID=' + encodeURIComponent(String(eventId)) + '&v_cache_version=' + B9_VERSION, { noCache });
}
