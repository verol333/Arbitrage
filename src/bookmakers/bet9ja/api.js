// Bet9ja — flux public des sports / compétitions / matchs / marchés.
//
// Aucun compte, aucun jeton : l'API du site est anonyme. Akamai exige en
// revanche l'origine, le referer et un accept-language, sinon 403. L'IP de la
// machine compte aussi : Akamai refuse la plupart des sorties de datacenter.
// D'où trois chemins essayés dans l'ordre :
//   1. direct           — marche depuis une sortie résidentielle / AWS
//   2. proxy du dépôt   — Jina / relais Cloudflare quand ils sont configurés
//   3. relais AWS (HF)  — espace verol333-alve-relay, sortie AWS, autorisé
//      pour les hôtes Bet9ja dans relay.py (ALLOW_HOSTS).
import { proxyFetchJson } from '../../net/fetcher.js';

export const B9_FEED = 'https://sports.bet9ja.com/desktop/feapi/PalimpsestAjax';
export const B9_VERSION = '1.331.0.251';
const RELAY_SPACE = 'https://verol333-alve-relay.hf.space';
const TIMEOUT_MS = 20_000;

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

async function directJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: B9_HEADERS, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function proxyRepoJson(url) {
  try {
    return await proxyFetchJson(url, { headers: B9_HEADERS, timeoutMs: TIMEOUT_MS });
  } catch {
    return null;
  }
}

// Relais AWS (espace HF) : il rend déjà l'objet JSON upstream.
async function relayJson(url) {
  try {
    const opening = await fetch(RELAY_SPACE + '/gradio_api/call/relay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: [JSON.stringify({ url, method: 'GET', body: null })] }),
      signal: AbortSignal.timeout(30_000),
    });
    const ticket = await opening.json().catch(() => null);
    if (!ticket || !ticket.event_id) return null;
    const stream = await fetch(RELAY_SPACE + '/gradio_api/call/relay/' + ticket.event_id, {
      headers: { accept: 'text/event-stream' },
      signal: AbortSignal.timeout(60_000),
    });
    const text = await stream.text();
    const line = text.split('\n').find((row) => row.startsWith('data:'));
    if (!line) return null;
    const answer = JSON.parse(JSON.parse(line.slice(5).trim() || '[]')[0] || '{}');
    if (answer.error || !answer.body) return null;
    return JSON.parse(answer.body);
  } catch {
    return null;
  }
}

async function b9Json(url) {
  const direct = await directJson(url);
  if (direct) return direct;
  const proxied = await proxyRepoJson(url);
  if (proxied) return proxied;
  const relayed = await relayJson(url);
  if (relayed) return relayed;
  throw new Error('bet9ja_unreachable:' + url.split('?')[0].split('/').pop());
}

export async function feedD(route, { noCache = false } = {}) {
  const sep = route.includes('?') ? '&' : '?';
  const url = B9_FEED + '/' + route + (noCache ? sep + '_t=' + Date.now() : '');
  const j = await b9Json(url);
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
