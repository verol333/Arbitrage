// ═══════════════════════════════════════════════════════════════════
// MAXIMUM DE MISE RÉEL D'UNE SÉLECTION 1xBet — LU AVANT LA MISE.
//
// Le plafond ne dépend PAS du marché en général : il dépend du match ET de la
// sélection ET de l'instant (208 000 F sur une sélection, 19 100 F sur une
// autre du même marché). Une limite « apprise par refus » est donc fausse dès
// le match suivant.
//
// Mesuré le 14/09/2026 : l'app mobile 1xBet interroge
// POST /MobileLiveBetX/MobileMaxBet avec la sélection exacte, et 1xBet répond
// { Value: 208000, Success: true }. Aucune mise n'est engagée par cet appel.
// C'est donc le vrai plafond, lisible AVANT d'engager quoi que ce soit.
// ═══════════════════════════════════════════════════════════════════

import { ipHeaders, userIdFromToken } from "./onexbetMobileApi.ts";
import { getWorkingIp, RU_IPS } from "./onexbetRuIps.ts";

const BASE = "https://aio-sworl.com";
const HEADERS: Record<string, string> = {
  "x-devicemodel": "iPhone 14 Pro Max",
  "x-bundleid": "1-xbet.publish",
  "user-agent": "1xBet/256.1.0 CFNetwork/3860.700.1 Darwin/25.6.0",
  "x-referral": "1", whence: "25", "x-whence": "25", "x-group": "1359",
  "x-language": "fr_FR", "x-fcountry": "1", accept: "*/*",
  "content-type": "application/json; charset=utf-8",
};

// Le plafond bouge avec la liquidité : une lecture ne vaut que quelques
// secondes, juste le temps de calculer les mises et de poser.
const TTL_MS = 10_000;
const cache = new Map<string, { max: number; at: number }>();

export function isOnexbetBook(book: string): boolean {
  return /^1xbet/.test(String(book || "").toLowerCase());
}

/**
 * Plafond de mise que 1xBet accepte MAINTENANT sur cette sélection précise.
 * Renvoie null si 1xBet ne répond pas — on ne bloque jamais une mise faute de
 * plafond lisible, les autres garde-fous restent en place.
 */
export async function readOnexbetMaxBet(
  conn: { token?: string; app_guid?: string; user_uuid?: unknown },
  selection: { gameId?: number | string; mainGameId?: number | string; betType?: number; param?: unknown; kind?: number; coef?: unknown },
): Promise<number | null> {
  const token = conn?.token;
  const gameId = Number(selection?.gameId) || 0;
  const betType = Number(selection?.betType) || 0;
  if (!token || !gameId || !betType) return null;

  const key = `${gameId}|${betType}|${selection?.param ?? 0}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.max;

  const appGuid = String(conn?.app_guid || "");
  const userId = Number(conn?.user_uuid) || userIdFromToken(token);
  const body = {
    Source: 25, AppGuid: appGuid, partner: 1, Lng: "fr_FR",
    UserId: userId, UserIdBonus: userId, Vid: 0, CfView: 3, specialTypes: 1,
    Events: [{
      Type: betType,
      Coef: String(selection?.coef ?? "1.5"),
      PlayerId: 0,
      MainGameId: Number(selection?.mainGameId) || gameId,
      Kind: Number(selection?.kind) || 1,
      GameId: gameId,
      Param: String(selection?.param ?? 0),
      UiFeature: 7,
    }],
  };

  try {
    const res = await fetch(`${BASE}/MobileLiveBetX/MobileMaxBet`, {
      method: "POST",
      headers: { ...HEADERS, appguid: appGuid, "x-auth": `Bearer ${token}`, ...ipHeaders(getWorkingIp() || RU_IPS[0]) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json().catch(() => null);
    const max = Number(json?.Value);
    if (!json?.Success || !Number.isFinite(max) || max <= 0) return null;
    const floored = Math.floor(max);
    cache.set(key, { max: floored, at: Date.now() });
    return floored;
  } catch {
    return null;
  }
}