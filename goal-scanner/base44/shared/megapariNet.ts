// ═══════════════════════════════════════════════════════════════════
// RÉSEAU MEGAPARI / 1xBET — économie du quota des relais Cloudflare.
//
// CONSTAT MESURÉ LE 18/09/2026 : les deux relais (workers.dev, offre gratuite
// = 100 000 requêtes/jour chacun) répondaient « Error 1027 : daily request
// limit » dès 07h10 UTC. À partir de là, plus AUCUN code coupon ne sortait
// (22 échecs sur 25 générations en une heure), jusqu'à la remise à zéro de
// minuit UTC. C'est exactement le « ça marche un moment puis plus rien »
// signalé par les utilisateurs depuis des jours.
//
// Le quota partait dans les LECTURES DE COTES (GetGameZip, Get1x2, sous-jeux…
// des milliers par construction de base et par génération), alors que ces
// lectures passent parfaitement en appel direct depuis nos serveurs. Seul le
// SaveCoupon (POST qui produit le code) exige un relais : en direct, le
// bookmaker répond « Ошибка ! » code 99.
//
// Règle : lecture = direct d'abord, relais seulement en secours.
//         SaveCoupon = un relais à la fois (pas les deux en parallèle).
// ═══════════════════════════════════════════════════════════════════

export const CF_WORKERS = [
  "https://hidden-pine-7436.veolalex3.workers.dev",
  "https://billowing-sea-2d8e.alvecapital60.workers.dev",
];

/** Relais privé (18/09/2026) : troisième quota quotidien pour les codes coupon.
 *  Il n'accepte la requête que si elle porte son mot de passe (x-alve-secret). */
interface Relay { url: string; auth?: Record<string, string> }

function allRelays(): Relay[] {
  const list: Relay[] = CF_WORKERS.map((url) => ({ url }));
  const own = (Deno.env.get("YB_CF_URL") || "").replace(/\/+$/, "");
  const secret = Deno.env.get("YB_CF_SECRET") || "";
  if (own && secret) list.push({ url: own, auth: { "x-alve-secret": secret } });
  return list;
}

let rr = 0;
/** Relais dans l'ordre de préférence, en tournante (répartit la charge). */
export function workersInOrder(): Relay[] {
  const all = allRelays();
  const start = rr++ % all.length;
  return all.map((_, i) => all[(start + i) % all.length]);
}

const viaWorker = (w: Relay, url: string) => `${w.url}/?url=${encodeURIComponent(url)}`;

async function getJson(u: string, headers: Record<string, string>, timeout: number): Promise<any | null> {
  try {
    const r = await fetch(u, { headers, signal: AbortSignal.timeout(timeout) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** Relais Deno (gratuit, sans quota Cloudflare) : passe AVANT les workers Cloudflare pour économiser leurs 100 000 requêtes/jour. */
export async function relayGet(url: string, headers: Record<string, string>, timeout = 12000): Promise<any | null> {
  const relay = Deno.env.get("YB_RELAY_URL");
  if (!relay) return null;
  try {
    const r = await fetch(relay, { method: "POST", headers: { "content-type": "application/json", "x-relay-secret": Deno.env.get("YB_RELAY_SECRET") || "" },
      body: JSON.stringify({ requests: [{ path: url, method: "GET", headers }] }), signal: AbortSignal.timeout(timeout) });
    const first = r.ok ? (await r.json())?.results?.[0] : null;
    return first?.status === 200 ? JSON.parse(first.text) : null;
  } catch { return null; }
}

/** Lecture de flux : direct d'abord, puis relais Deno, puis Cloudflare en dernier secours. */
export async function feedGet(url: string, headers: Record<string, string>, timeout = 8000): Promise<any | null> {
  const direct = await getJson(url, headers, timeout);
  if (direct) return direct;
  const viaRelay = await relayGet(url, headers);
  if (viaRelay) return viaRelay;
  for (const w of workersInOrder()) {
    const j = await getJson(viaWorker(w, url), { ...headers, ...(w.auth || {}) }, timeout);
    if (j) return j;
  }
  return null;
}

/** SaveCoupon : un relais à la fois, le second seulement si le premier ne répond pas. */
export async function couponPost(url: string, headers: Record<string, string>, payload: unknown, timeout = 9000): Promise<any | null> {
  const body = JSON.stringify(payload);
  for (const w of workersInOrder()) {
    try {
      const r = await fetch(viaWorker(w, url), { method: "POST", headers: { ...headers, ...(w.auth || {}) }, body, signal: AbortSignal.timeout(timeout) });
      if (r.ok) return await r.json();
    } catch { /* relais suivant */ }
  }
  return null;
}