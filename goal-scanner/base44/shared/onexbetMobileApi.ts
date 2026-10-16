// ═══════════════════════════════════════════════════════════════════
// API MOBILE 1xBet (aio-sworl.com) — refresh + solde + placement.
//
// CONTOURNEMENT DU GEOFENCING (erreur 157662) — sans aucun proxy.
//
// Ce qui a été établi par mesure directe (2026-08-20) :
//   • Deno.createHttpClient est INDISPONIBLE dans ce runtime : aucun proxy
//     HTTP/SOCKS n'est utilisable côté serveur. L'ancienne mécanique de proxy
//     ne routait donc rien du tout et retombait toujours en direct.
//   • Notre IP de sortie est FIXE (IPv6) et blacklistée : 12 essais sur 12
//     bloqués. La faire tourner est impossible.
//   • MAIS 1xBet fait confiance aux EN-TÊTES d'IP transmis : une IP russe
//     dans X-Forwarded-For & co, combinée à x-fcountry=1, fait disparaître
//     le 157662 et renvoie un vrai token (Success:true).
//
// C'est donc cette voie qui est utilisée : en-têtes d'IP russes + fcountry=1,
// avec rotation automatique sur la liste d'IP si l'une se fait bloquer.
// ═══════════════════════════════════════════════════════════════════

import { GEO_BLOCK_CODE, ipsToTry, setWorkingIp } from "./onexbetRuIps.ts";
import { parseOnexbetBetResponse, mobileSelectionPrice } from "./onexbetBetResponse.ts";
import { resolvePendingBet } from "./onexbetPending.ts";
import { bookGet } from "./bookFeed.ts";

const MOBILE_BASE = "https://aio-sworl.com";

const BASE_HEADERS: Record<string, string> = {
  "x-devicemodel": "iPhone 14 Pro Max",
  "x-bundleid": "1-xbet.publish",
  "user-agent": "1xBet/256.1.0 CFNetwork/3860.700.1 Darwin/25.6.0",
  "x-referral": "1",
  "whence": "25",
  "x-whence": "25",
  "x-group": "1359",
  "x-language": "fr_FR",
  // ⚠️ fcountry=1 (Russie) : avec 93 (Congo) 1xBet refuse systématiquement,
  // même avec une IP russe dans les en-têtes. Les deux vont de pair.
  "x-fcountry": "1",
  "accept": "*/*",
  "accept-language": "fr-FR,fr;q=0.9",
  "content-type": "application/json; charset=utf-8",
};

/** En-têtes d'IP — c'est EUX que 1xBet lit pour déterminer le pays. */
export function ipHeaders(ip: string): Record<string, string> {
  if (!ip) return {};
  return {
    "X-Forwarded-For": ip,
    "X-Real-IP": ip,
    "CF-Connecting-IP": ip,
    "True-Client-IP": ip,
    "X-Client-IP": ip,
    "X-Forwarded": `for=${ip}`,
    "Forwarded": `for=${ip}`,
  };
}

interface MobileResponse {
  json: any;
  text: string;
  status: number;
  via: string;
}

/**
 * Appel à l'API mobile avec contournement géo par en-têtes.
 * Essaie les IP russes une à une tant que 1xBet renvoie 157662, puis
 * mémorise celle qui passe pour les appels suivants.
 */
async function fetchMobile(
  path: string,
  options: { method: string; headers: Record<string, string>; body?: string; timeoutMs?: number },
): Promise<MobileResponse> {
  const { method, headers, body, timeoutMs = 12000 } = options;
  let last: MobileResponse | null = null;
  // An interrupted money-moving POST may already have reached the bookmaker.
  // Never resend it automatically on another IP.
  const placingBet = path === "/MobileLiveBetX/MobileMakeBet";

  // ═══════════════════════════════════════════════════════════════════
  // ⚠️ CAUSE RACINE DES DÉCONNEXIONS 1xBet (mesurée le 12/09/2026).
  //
  // Le refresh token est À USAGE UNIQUE et 1xBet détecte sa réutilisation :
  // présenter DEUX FOIS le même jeton révoque toute la chaîne du compte.
  //
  // Or, en cas de coupure réseau ou de dépassement du délai, cette boucle
  // repartait sur l'IP suivante AVEC LE MÊME JETON. Si le premier appel avait
  // en réalité abouti côté 1xBet (rotation faite, réponse perdue en route), le
  // second appel présentait un jeton déjà consommé : 1xBet répondait
  // « NotValid » (code 3) et la chaîne était morte pour de bon, alors que le
  // compte était parfaitement sain. Constat en base : 1 982 refus, TOUS
  // « NotValid », et chaque session mourait exactement APRÈS un renouvellement
  // réussi. Vérifié : un jeton ainsi mort est refusé par les 18 IP du pool —
  // ce n'est donc ni le pays, ni l'IP, ni une mise refusée.
  //
  // Un jeton qui tourne ne doit donc être présenté QU'UNE SEULE FOIS.
  // Le blocage géographique (157662) reste réessayable : il est renvoyé avant
  // toute vérification du jeton, sans le consommer.
  // ═══════════════════════════════════════════════════════════════════
  const rotatingToken = path === "/UserAuth/RefreshToken";
  const noRetry = placingBet || rotatingToken;

  // ⚠️ Le blocage géographique (157662) est renvoyé AVANT toute vérification :
  // il ne consomme ni le jeton, ni la mise. Changer d'IP dans ce cas est donc
  // sans danger — et indispensable, sinon une seule IP bloquée suffirait à
  // condamner tous les renouvellements. Ce qui est interdit pour un appel
  // sensible, c'est de rejouer un appel dont la réponse n'est jamais arrivée
  // (voir le `throw` ci-dessous) : là, 1xBet a peut-être déjà agi.
  for (const ip of ipsToTry()) {
    let res: Response;
    try {
      res = await fetch(`${MOBILE_BASE}${path}`, {
        method,
        headers: { ...headers, ...ipHeaders(ip) },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      // Un appel interrompu qui CONSOMME quelque chose (pari, rotation de
      // jeton) ne doit jamais être rejoué : côté 1xBet il a peut-être abouti.
      if (noRetry) throw e;
      console.log(`[1xBet] IP ${ip} — échec réseau : ${(e as Error).message}`);
      continue;
    }

    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    const current: MobileResponse = { json, text, status: res.status, via: `ru:${ip}` };

    if (json?.ErrorCode === GEO_BLOCK_CODE) {
      console.log(`[1xBet] IP ${ip} géo-bloquée (157662) — essai suivant`);
      last = current;
      continue;
    }

    setWorkingIp(ip);
    return current;
  }

  return last ?? { json: null, text: "", status: 0, via: "aucune_ip_disponible" };
}

/**
 * Extrait l'App GUID DEPUIS le refresh token lui-même (claim « app » du JWT).
 *
 * Le refresh token 1xBet embarque l'App GUID de l'appareil qui l'a généré.
 * En le relisant, on envoie toujours un en-tête appguid cohérent avec le token,
 * quel que soit l'appareil de l'utilisateur — l'utilisateur n'a donc rien à
 * saisir d'autre que son refresh token.
 */
export function appGuidFromRefreshToken(refreshToken: string): string | null {
  try {
    const payload = (refreshToken || "").split(".")[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/")
      .padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const json = JSON.parse(atob(b64));
    const app = json?.app || json?.App || json?.appGuid || json?.AppGuid;
    return app ? String(app).toUpperCase() : null;
  } catch {
    return null;
  }
}

/**
 * Identifiant NUMÉRIQUE du compte 1xBet, lu dans le jeton (claim « sub »).
 * Indispensable au placement : envoyer l'e-mail donne « UserId: 0 » et 1xBet
 * refuse alors toute pose (ErrorCode 304).
 */
export function userIdFromToken(token: string): number {
  try {
    const payload = (token || "").split(".")[1];
    if (!payload) return 0;
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/")
      .padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const json = JSON.parse(atob(b64));
    // Le claim « sub » vaut « 50/1681795997 » : l'identifiant du compte est la
    // dernière partie. Le lire en entier donne 0 et 1xBet refuse toute pose.
    const raw = String(json?.sub ?? json?.Sub ?? json?.userId ?? json?.UserId ?? "");
    const last = raw.split("/").pop() || "";
    return Number(last.replace(/\D/g, "")) || 0;
  } catch {
    return 0;
  }
}

export interface RefreshResult {
  ok: boolean;
  /** L'appel n'a pas abouti : 1xBet a peut-être tourné le jeton sans qu'on le sache. */
  interrupted?: boolean;
  error?: string;
  errorCode?: number;
  token?: string;
  refreshToken?: string;
  tokenExpiry?: number;
  via?: string;
  raw?: string;
}

/**
 * Refresh le token mobile 1xBet.
 * `userIp` est conservé pour compatibilité des appelants mais n'est plus
 * utilisé : le pays est déterminé par les IP russes du pool.
 */
export async function refreshMobileToken(
  refreshToken: string,
  appGuid: string,
  _userIp?: string,
): Promise<RefreshResult> {
  try {
    const { json, text, status, via } = await fetchMobile("/UserAuth/RefreshToken", {
      method: "POST",
      headers: { ...BASE_HEADERS, appguid: appGuid },
      body: JSON.stringify({ RefreshToken: refreshToken, Language: "fr_FR" }),
      // Délai généreux : une réponse abandonnée en route coûtait la session
      // entière (le jeton est consommé côté 1xBet mais sa remplaçante est
      // perdue). Mieux vaut attendre que perdre la chaîne.
      timeoutMs: 25000,
    });

    const v = json?.Value || {};
    // 1xBet peut renvoyer le nouveau refresh token sous plusieurs noms.
    const newRefreshToken =
      v.RefreshToken || v.refresh_token || v.refreshToken || v.NewRefreshToken ||
      v.NewRefresh || v.token || (v.Token && v.Token !== v.AccessToken ? v.Token : undefined) ||
      undefined;

    console.log("[1xBet Refresh] via:", via,
      "status:", status,
      "Success:", json?.Success,
      "ErrorCode:", json?.ErrorCode,
      "hasToken:", !!v.Token,
      "hasRefreshToken:", !!newRefreshToken,
      "tokenExpiry:", v.TokenExpiry);

    return {
      ok: !!json?.Success,
      error: json?.Error ?? undefined,
      errorCode: json?.ErrorCode ?? undefined,
      token: v.Token ?? undefined,
      refreshToken: newRefreshToken,
      tokenExpiry: v.TokenExpiry ?? undefined,
      via,
      raw: json ? undefined : text.slice(0, 500),
    };
  } catch (e: any) {
    // Réponse jamais reçue : on ne sait PAS si 1xBet a tourné le jeton.
    // L'appelant doit s'abstenir de le re-présenter en rafale.
    return { ok: false, interrupted: true, error: `renouvellement interrompu (${e.message})` };
  }
}

export interface BalanceResult {
  ok: boolean;
  balance?: number;
  currency?: string;
  error?: string;
  errorCode?: number;
  /** true = 1xBet a refusé le JETON (périmé/révoqué), pas le compte. */
  authExpired?: boolean;
  via?: string;
  raw?: string;
}

/**
 * Codes par lesquels 1xBet signale un JETON refusé.
 * 1 = Unauthorized / session invalide, 101 = jeton expiré, 103 = jeton révoqué.
 * Ces cas se réparent tout seuls (renouvellement par le refresh token) : les
 * confondre avec « solde non disponible » faisait abandonner toute la tentative
 * à l'étape connexion — c'est l'origine des 34 abandons « Solde non disponible »
 * relevés sur la paire 1xBet+1win.
 */
const AUTH_CODES = new Set([1, 101, 103, 401]);

// CurrencyId 1xBet → code ISO. 26 = XAF (Franc CFA BEAC, Congo).
const CURRENCY_MAP: Record<number, string> = { 26: "XAF" };

/** Lit le solde via l'API mobile 1xBet. */
export async function getMobileBalance(
  token: string,
  appGuid: string,
  _userIp?: string,
): Promise<BalanceResult> {
  try {
    const { json, text, via, status } = await fetchMobile(
      "/Account/v1/Mb/GetUserBalance?Group=1359&Language=fr_FR&Partner=1&Whence=25",
      {
        method: "GET",
        headers: { ...BASE_HEADERS, appguid: appGuid, "x-auth": `Bearer ${token}` },
        timeoutMs: 10000,
      },
    );
    if (json?.Success && Array.isArray(json.Value) && json.Value.length) {
      const v = json.Value[0];
      return {
        ok: true,
        balance: v.Money,
        currency: CURRENCY_MAP[v.CurrencyId] || "XAF",
        via,
      };
    }
    // ⚠️ On remonte le motif RÉEL de 1xBet. « Solde non disponible » masquait
    // aussi bien un jeton périmé (réparable en 1 s) qu'une vraie panne.
    const code = Number(json?.ErrorCode) || 0;
    const authExpired = status === 401 || Number(json?.status) === 401 || AUTH_CODES.has(code) || /token|auth|unauthor|session/i.test(String(json?.Error || ""));
    return {
      ok: false,
      errorCode: code || undefined,
      authExpired,
      error: authExpired
        ? `jeton d'accès refusé par 1xBet${code ? ` (code ${code})` : ""}`
        : json?.Error || `solde illisible${code ? ` (code ${code})` : ""}`,
      via,
      raw: text.slice(0, 300),
    };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/**
 * Cote telle que l'APP MOBILE la voit (groupe 1359).
 *
 * ⚠️ Indispensable : la cote lue sur le site .cg / megapari n'est PAS celle que
 * MobileMakeBet compare. Envoyer la cote du site fait refuser le pari en
 * ErrorCode 130 (« les cotes ont été modifiées ») quasiment à chaque fois.
 */
export async function getMobileCoef(
  gameId: number,
  betType: number,
  param = 0,
  live = false,
): Promise<{ coef: number | null; reason?: string }> {
  // ⚠️ CAUSE MESURÉE LE 12/09/2026 (23 abandons sur 28 tentatives) :
  // sur l'hôte mobile aio-sworl.com, « /LiveFeed/GetGameZip » RÉPOND 404 —
  // l'adresse n'existe pas pour le direct — et « /LineFeed/GetGameZip »
  // répond « Impossible de trouver le match » puisque le match est en cours.
  // Autrement dit AUCUNE cote live de 1xBet n'était lisible : ce n'était pas
  // un creux passager mais une adresse morte. On lit donc le direct sur le
  // flux du bookmaker déjà utilisé par le scanner (megapari /service-api),
  // qui répond, et on ne garde l'hôte mobile que pour le pré-match.
  const feeds = live ? ["LiveFeed", "LineFeed"] : ["LineFeed", "LiveFeed", "LineFeed"];
  for (let i = 0; i < feeds.length; i++) {
    const { json } = await fetchMobile(
      `/${feeds[i]}/GetGameZip?id=${gameId}&lng=fr_FR&isSubGames=true&GroupEvents=true&countevents=3000&grMode=4&partner=1&gr=1359&marketType=1`,
      { method: "GET", headers: { ...BASE_HEADERS }, timeoutMs: 12000 },
    );
    const root = json?.Value;
    if (root) {
      const price = mobileSelectionPrice(root, gameId, betType, param);
      if (price.coef !== null) return price;
    }
  }

  // Repli : flux du bookmaker (celui du scanner), seul flux qui expose le
  // direct depuis nos serveurs. Même structure de réponse, donc même lecture.
  // ⚠️ `getEmpty=true` est INDISPENSABLE : sans lui le flux renvoie bien le
  // match (équipes, score) mais AUCUNE cote — c'est exactement ce qui faisait
  // croire à un flux vide (vérifié sur Spezia-Livorno : 0 cote sans, 47 avec).
  const path = `/service-api/${live ? "LiveFeed" : "LineFeed"}/GetGameZip?id=${gameId}&lng=fr&country=93&partner=192&getEmpty=true&gr=1213`;
  const data = await bookGet(path).catch(() => null);
  if (data?.Value) return mobileSelectionPrice(data.Value, gameId, betType, param);

  return { coef: null, reason: "feed_mobile_indisponible" };
}

/**
 * Sous-jeux d'un match (mi-temps, sets, quart-temps, corners, cartons…) lus sur
 * l'API MOBILE.
 *
 * ⚠️ Pourquoi ici et pas sur 1xbet.cg : mesuré le 05/09/2026, le site .cg est
 * injoignable depuis nos serveurs (pare-feu). Résultat : 100 % des marchés de
 * mi-temps / set / statistique restaient « en attente de rattachement » et
 * AUCUN pari automatique ne partait sur ces marchés (dont tout le tennis par
 * set). L'API mobile, elle, répond — c'est la même liste SG.
 */
export async function getMobileSubgames(gameId: string | number, live = false): Promise<any[] | null> {
  // Même insistance que pour la cote : une réponse vide passagère ne doit pas
  // faire conclure « marché absent » et abandonner l'opportunité.
  for (const feed of live ? ["LiveFeed", "LineFeed"] : ["LineFeed", "LiveFeed"]) {
    const { json } = await fetchMobile(
      `/${feed}/GetGameZip?id=${gameId}&lng=fr_FR&isSubGames=true&GroupEvents=false&partner=1&gr=1359&marketType=1`,
      { method: "GET", headers: { ...BASE_HEADERS }, timeoutMs: 12000 },
    );
    if (Array.isArray(json?.Value?.SG) && json.Value.SG.length) return json.Value.SG;
  }
  // Même repli que pour la cote : en direct, l'hôte mobile ne répond pas.
  const data = await bookGet(
    `/service-api/${live ? "LiveFeed" : "LineFeed"}/GetGameZip?id=${gameId}&lng=fr&country=93&partner=192&getEmpty=true&gr=1213&isSubGames=true`,
  ).catch(() => null);
  return Array.isArray(data?.Value?.SG) && data.Value.SG.length ? data.Value.SG : null;
}

// ═══════════════════════════════════════════════════════════════════
// PLACEMENT DE PARI — API mobile 1xBet (MobileMakeBet)
//
// ⚠️ AUCUNE SIGNATURE N'EST ENVOYÉE — et c'est volontaire.
//
// Vérifié empiriquement (paris réels placés le 2026-08-19) :
//   • Sign+Date PRÉSENTS  → ErrorCode 304 « Impossible de placer le pari »,
//     quelle que soit leur valeur (paire capturée, chaîne vide, zéros).
//   • Sign+Date ABSENTS du corps → le pari est traité normalement et accepté
//     (Success:true, ticket dans Value.Id).
//
// Conclusion : on omet ces deux champs. Aucune capture manuelle nécessaire.
// ═══════════════════════════════════════════════════════════════════

export interface MobileBetEvent {
  gameId: number;       // sous-jeu (la sélection précise)
  mainGameId: number;   // match principal (onexbet_match_id)
  type: number;         // betType
  coef: string;
  param: string;
  kind: number;
}

export interface MobileBetInput {
  token: string;
  appGuid: string;
  userIp?: string;
  userId: number;
  summ: number;
  events: MobileBetEvent[];
  /** Tolérance aux variations de cote : 0 = refuse, 1 = accepte la hausse, 2 = accepte tout. */
  checkCf?: number;
  /** Solde de référence facultatif (compatibilité). Jamais utilisé comme preuve de placement. */
  balanceBefore?: number | null;
}

// A balance change (or lack of change) cannot settle a specific bet: other
// wagers, settlements and delayed debits may change it independently.
export type PendingVerdict = "accepte" | "refuse" | "indetermine";
export function judgePendingBet(balanceBefore, balanceAfter, _stake): { verdict: PendingVerdict; drop: number } {
  const drop = balanceBefore != null && balanceAfter != null && Number.isFinite(Number(balanceBefore)) && Number.isFinite(Number(balanceAfter))
    ? Number(balanceBefore) - Number(balanceAfter) : 0;
  return { verdict: "indetermine", drop };
}

export interface MobileBetResult {
  success: boolean;
  ticketId?: string;
  appliedOdds?: number;
  acceptedStake?: number;
  balance?: number;
  error?: string;
  errorCode?: number;
  authExpired?: boolean;
  ambiguous?: boolean;
  status?: number;
  ticket?: any;
}

/**
 * Verdict d'un pari 1xBet mis en attente : relit le pari par son betGUID.
 * Lecture SEULE — elle ne peut pas créer de second pari.
 */
async function resolvePendingMobileBet(
  guid: string,
  input: MobileBetInput,
  waitSeconds: number,
): Promise<MobileBetResult | null> {
  const verdict = await resolvePendingBet(guid, async (g) => {
    const { json, status } = await fetchMobile(
      `/MobileLiveBetX/GetBets?betsGuid=${encodeURIComponent(g)}&Lng=fr_FR&partner=1&gr=1359`,
      { method: "GET", headers: { ...BASE_HEADERS, appguid: input.appGuid, "x-auth": `Bearer ${input.token}` }, timeoutMs: 12000 },
    );
    return { status, json };
  }, waitSeconds).catch(() => null);
  return verdict as MobileBetResult | null;
}

export async function placeOnexbetMobileBet(input: MobileBetInput): Promise<MobileBetResult> {
  const body = {
    Source: 25,
    AppGuid: input.appGuid,
    CalcSystemsMin: false,
    partner: 1,
    Summ: String(input.summ),
    CheckCf: input.checkCf ?? 0,
    UserIdBonus: input.userId,
    // Request a final response; the provider may STILL return a pending GUID.
    notWait: false,
    Lng: "fr_FR",
    IsPowerBet: false,
    IsExpressBoost: false,
    // ⚠️ Ni « Sign » ni « Date » : les envoyer déclenche la vérification de
    // signature (ErrorCode 304). Les omettre fait accepter le pari.
    VIPBetSumm: false,
    Events: input.events.map((e) => ({
      Type: e.type,
      Coef: e.coef,
      PlayerId: 0,
      MainGameId: e.mainGameId,
      Kind: e.kind,
      UiFeature: 7,
      GameId: e.gameId,
      Param: e.param,
    })),
    avanceBet: false,
    specialTypes: 1,
    Vid: 0,
    CfView: 3,
    OneClickBet: 2,
    UserId: input.userId,
  };

  try {
    const { json, status } = await fetchMobile("/MobileLiveBetX/MobileMakeBet", {
      method: "POST",
      headers: {
        ...BASE_HEADERS,
        appguid: input.appGuid,
        "x-auth": `Bearer ${input.token}`,
      },
      body: JSON.stringify(body),
      timeoutMs: 15000,
    });

    const first = parseOnexbetBetResponse(json, status);

    // ── VALIDATION DIFFÉRÉE 1xBET : ON VA CHERCHER LE VERDICT ──────────────
    // En direct, 1xBet ne répond presque JAMAIS tout de suite : il renvoie un
    // `betGUID` + un `waitTime` et tranche quelques secondes plus tard. Le
    // verdict n'était pas relu : toutes les tentatives live finissaient donc en
    // « réponse non confirmée — vérifiez à la main », y compris les paris
    // parfaitement acceptés. Le point de lecture du verdict est
    // GET /MobileLiveBetX/GetBets?betsGuid={guid} (vérifié le 15/09/2026).
    const guid = first?.ticket?.betGUID;
    if (first.ambiguous && guid) {
      const wait = Number(first.ticket?.waitTime) || 0;
      const verdict = await resolvePendingMobileBet(String(guid), input, wait);
      if (verdict) return verdict;
    }
    return first;
  } catch (e: any) {
    return { success: false, ambiguous: true, error: `bet_not_confirmed — réponse de placement 1xBet interrompue (${e.message})` };
  }
}