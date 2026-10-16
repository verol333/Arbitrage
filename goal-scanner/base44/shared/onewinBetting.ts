// ═══════════════════════════════════════════════════════════════════
// 1WIN (via top-parser gateway) — connexion par JETON + placement de pari.
//
// Le login direct 1win (/api/web/v1/auth/login) est protégé par un captcha
// GeetestV4 IMPOSSIBLE à reproduire côté serveur. On ne peut donc pas
// automatiser la connexion login/mot de passe.
//
// SOLUTION : l'utilisateur se connecte manuellement sur 1win dans son
// navigateur, puis copie le jeton « token » (en-tête de la requête
// make-bet-v2, base64 de { id, token }). Ce jeton autorise ensuite le
// placement de paris via la passerelle top-parser.
//
// Flux capturé en F12 :
//   BET  POST https://api-gateway.top-parser.com/bets/make-bet-v2
//        headers { token, x-external-partner-id, x-lang, x-user-location }
//        body { currencyCode, amount, coupon:{amount, selections:[{oddId,cf,matchId}]},
//               idempotencyKey, meta:{isDirtyAmountField:true}, wallet:{type:"real"} }
//   AMT  POST https://api-gateway.top-parser.com/bets/get-auto-bet-amount-v2
// ═══════════════════════════════════════════════════════════════════

import { pickOnewinWallet } from "./onewinWallet.ts";

const GATEWAY = "https://api-gateway.top-parser.com";
const PARTNER_ID = "44ba10e5-7df2-47ab-a44d-dc93803c7a6e";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

function gatewayHeaders(token: string): Record<string, string> {
  return {
    "accept": "application/json",
    "accept-language": "fr-FR,fr;q=0.8",
    "content-type": "application/json",
    "origin": "https://1win.com",
    "referer": "https://1win.com/",
    "token": token,
    "x-external-partner-id": PARTNER_ID,
    "x-lang": "fr-CI",
    "x-user-location": "cg",
    "user-agent": UA,
  };
}

/** Décode le jeton base64 { id, token } pour vérifier qu'il est bien formé. */
function isTokenWellFormed(token: string): boolean {
  try {
    const decoded = JSON.parse(atob(token.trim()));
    return !!(decoded && decoded.id && decoded.token);
  } catch (_e) {
    return false;
  }
}

/**
 * Lit le solde réel du compte via le cookie de session 1win.
 * Il suffit du cookie « session-id » (récupéré en F12 sur la requête
 * api-v1-balances-get-activated). Renvoie la balance XAF si présente.
 */
/**
 * Extrait le session-id, même si l'utilisateur colle tout le paquet de cookies.
 * Cherche « session-id=… » puis « 1w_token=… », sinon renvoie la valeur brute
 * (cas où seul l'UUID a été collé).
 */
export function extractOnewinSessionId(raw: string): string {
  const v = (raw || "").trim();
  const m = v.match(/(?:session-id|session_id|1w_token|sessionid)\s*=\s*([0-9a-f-]{20,})/i);
  if (m) return m[1].trim();
  // UUID isolé collé directement
  const uuid = v.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return uuid ? uuid[0] : v;
}

/** true si l'entrée ressemble à un bloc de cookies (paires clé=valeur). */
function looksLikeOnewinCookies(raw: string): boolean {
  const v = (raw || "").trim();
  return /=/.test(v) && (/;/.test(v) || /session|token|1w_/i.test(v));
}

export async function getOnewinBalance(sessionId: string, accountCurrency?: string): Promise<
  | { success: true; balance: number; currency: string; all: Array<{ currency: string; balance: number }> }
  | { success: false; error: string; status?: number }
> {
  const sid = extractOnewinSessionId(sessionId);
  if (!sid) return { success: false, error: "no_session" };

  // Cookies bruts si l'utilisateur les a collés ; sinon on reconstruit le minimum.
  const cookieHeader = looksLikeOnewinCookies(sessionId)
    ? sessionId.trim().replace(/\s*\n\s*/g, "; ")
    : `session-id=${sid}; 1w_token=${sid}`;

  // La lecture du solde échoue par intermittence (coupure réseau, 500/429 de
  // 1win, challenge Cloudflare passager). Un seul essai suffisait à afficher
  // « impossible de lire la somme » alors que le compte était bien approvisionné.
  // On réessaie donc jusqu'à 3 fois sur ces incidents passagers — mais JAMAIS
  // sur un 401/403, qui signale une vraie session morte.
  let lastErr: { success: false; error: string; status?: number } = { success: false, error: "balance_error" };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 600 * attempt));

    let res: Response;
    try {
      res = await fetch("https://1win.com/api/USER-SERVICE-API/api-v1-balances-get-activated", {
        method: "GET",
        headers: {
          "accept": "*/*",
          "referer": "https://1win.com/fr-CI/betting",
          "x-origin": "1win.com",
          "user-agent": UA,
          "cookie": cookieHeader,
        },
        signal: AbortSignal.timeout(20000),
      });
    } catch (_e) {
      lastErr = { success: false, error: "network_error" };
      continue; // incident réseau : on retente
    }

    if (res.status === 401 || res.status === 403) {
      return { success: false, error: "session_expired", status: res.status };
    }
    // ⚠️ CAUSE RACINE DES FAUX « SOLDE ILLISIBLE » (constat du 07/09/2026).
    // Quand la session est morte, ce service NE répond PAS 401/403 : il répond
    // HTTP 400 avec { errorCode: "FT01", code: "common.badRequest" }. Vérifié
    // en direct : cookie absent, cookie bidon ou cookie non conforme donnent
    // tous les trois exactement cette réponse.
    // L'ancien code y voyait un incident passager : il retentait trois fois pour
    // rien, renvoyait un solde vide, et le moteur annonçait « 1win : solde
    // illisible — aucune mise placée » en boucle. Surtout, la reconnexion
    // automatique par identifiant + mot de passe ne se déclenchait jamais,
    // puisqu'elle attend « session expirée ». D'où des sessions 1win qui
    // « expiraient » sans que l'utilisateur touche à quoi que ce soit.
    if (res.status === 400) {
      const body = await res.text().catch(() => "");
      if (/FT01|common\.badRequest/i.test(body)) {
        return { success: false, error: "session_expired", status: 400 };
      }
      lastErr = { success: false, error: "balance_error", status: 400 };
      continue;
    }
    if (!res.ok) {
      lastErr = { success: false, error: "balance_error", status: res.status };
      continue; // 429 / 5xx : incident passager, on retente
    }

    let list: Array<{ currency: string; balance: number }> = [];
    try { list = await res.json(); } catch (_e) { lastErr = { success: false, error: "bad_response" }; continue; }
    if (!Array.isArray(list) || list.length === 0) {
      // Réponse vide sur une session par ailleurs vivante = anomalie passagère
      // du service, pas nécessairement une session morte : on retente.
      lastErr = { success: false, error: "session_expired" };
      continue;
    }

    // Choix du portefeuille : voir shared/onewinWallet.ts (compte principal en
    // devise réelle, sinon le portefeuille réel le mieux approvisionné). Évite
    // d'annoncer un solde crypto résiduel à un compte crédité en francs CFA.
    const pick = pickOnewinWallet(list, accountCurrency) || list[0];
    return { success: true, balance: Number(pick.balance), currency: pick.currency, all: list };
  }
  return lastErr;
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * FABRICATION AUTOMATIQUE DU JETON DE MISE (fin du recollage manuel).
 *
 * Chaîne complète découverte en F12 :
 *   1) GET  1win.com/api/v1/betting/getToken   (cookie de session, valide 1 an)
 *        → { "token": "<80 caractères>" }      ← le « publicToken »
 *   2) POST api-gateway.top-parser.com/auth/login  body { publicToken }
 *        → { result: { sessionToken: "<base64 {id,token}>", userId } }
 *
 * Le « sessionToken » renvoyé EST exactement le jeton attendu dans l'en-tête
 * « token » de make-bet-v2. Il est de courte durée — on le refabrique donc
 * juste avant chaque pari, à partir du seul cookie de session.
 * ═══════════════════════════════════════════════════════════════════
 */
export async function mintOnewinBetToken(cookies: string): Promise<
  { ok: true; token: string } | { ok: false; error: string; status?: number }
> {
  const cookieHeader = (cookies || "").trim().replace(/\s*\n\s*/g, "; ");
  if (!cookieHeader) return { ok: false, error: "no_cookies" };

  // Le jeton de mise est fabriqué en deux appels (getToken → /auth/login) qui
  // échouent par intermittence (429, 5xx, Cloudflare, coupure réseau). Un seul
  // essai suffisait à faire déclarer 1win « déconnecté » alors que la session
  // était vivante. On retente donc jusqu'à 3 fois. Même un 401/403 sur getToken
  // est retenté : ce minting n'est lancé qu'après une lecture de solde RÉUSSIE
  // (session prouvée vivante), un 401 ici est donc bien plus souvent une
  // limitation de débit déguisée qu'une vraie expiration.
  let lastErr: { ok: false; error: string; status?: number } = { ok: false, error: "get_token_error" };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 700 * attempt));

    // ── 1) Jeton public, délivré par 1win contre le cookie de session ──
    let r1: Response;
    try {
      r1 = await fetch("https://1win.com/api/v1/betting/getToken", {
        method: "GET",
        headers: {
          "accept": "application/json",
          "referer": "https://1win.com/fr-CI/betting",
          "x-origin": "1win.com",
          "cookie": cookieHeader,
          "user-agent": UA,
        },
        signal: AbortSignal.timeout(20000),
      });
    } catch (_e) {
      lastErr = { ok: false, error: "get_token_error" };
      continue;
    }
    if (r1.status === 401 || r1.status === 403) {
      lastErr = { ok: false, error: "session_expired", status: r1.status };
      continue;
    }
    if (!r1.ok) { lastErr = { ok: false, error: "get_token_error", status: r1.status }; continue; }

    let publicToken = "";
    try { publicToken = String((await r1.json())?.token || ""); } catch (_e) { /* ignore */ }
    if (!publicToken) { lastErr = { ok: false, error: "no_public_token" }; continue; }

    // ── 2) Échange du jeton public contre le jeton de mise ──
    let r2: Response;
    try {
      r2 = await fetch(`${GATEWAY}/auth/login`, {
        method: "POST",
        headers: {
          "accept": "application/json",
          "accept-language": "fr-FR,fr;q=0.8",
          "content-type": "application/json",
          "origin": "https://1win.com",
          "referer": "https://1win.com/",
          "x-external-partner-id": PARTNER_ID,
          "x-lang": "fr-CI",
          "x-user-location": "cg",
          "user-agent": UA,
        },
        body: JSON.stringify({ publicToken }),
        signal: AbortSignal.timeout(20000),
      });
    } catch (_e) {
      lastErr = { ok: false, error: "auth_login_error" };
      continue;
    }
    if (!r2.ok) { lastErr = { ok: false, error: "auth_login_error", status: r2.status }; continue; }

    let sessionToken = "";
    try { sessionToken = String((await r2.json())?.result?.sessionToken || ""); } catch (_e) { /* ignore */ }
    if (!sessionToken || !isTokenWellFormed(sessionToken)) { lastErr = { ok: false, error: "no_session_token" }; continue; }

    return { ok: true, token: sessionToken };
  }
  return lastErr;
}

/**
 * Extrait le jeton top-parser base64 ({id, token}) même si l'utilisateur colle
 * du texte autour. Renvoie "" si aucun jeton bien formé n'est trouvé.
 */
export function extractOnewinToken(raw: string): string {
  const v = (raw || "").trim();
  if (isTokenWellFormed(v)) return v;
  // Cherche une sous-chaîne base64 qui décode en { id, token }.
  const b64 = v.match(/[A-Za-z0-9+/=]{40,}/g) || [];
  for (const cand of b64) {
    if (isTokenWellFormed(cand)) return cand;
  }
  return "";
}

/**
 * Valide un jeton top-parser 1win via la passerelle : /bets/get-auto-bet-amount-v2
 * répond {"result":{}} quand le jeton est valide, et
 * {"errors":[{"code":"unauthenticated_error"}]} quand il ne l'est pas.
 * C'est le seul moyen fiable de vérifier la connexion (le login est bloqué
 * par captcha, et le solde n'est pas exposé par la passerelle).
 */
// ⚠️ TRÈS IMPORTANT — pourquoi 1win « se déconnectait » sans arrêt :
// l'ancienne version considérait comme « jeton expiré » TOUT ce qui n'était pas
// une réponse parfaite : coupure réseau, délai dépassé, erreur 500 de la
// passerelle, limitation de débit (429)… Le jeton était pourtant toujours
// valide (c'est bien le même que celui recollé à la main). Résultat : la
// surveillance s'arrêtait et redemandait une reconnexion inutile.
//
// Désormais, on ne déclare le jeton mort QUE si la passerelle le dit
// explicitement (code d'authentification, HTTP 401/403). Tout le reste est un
// simple incident passager : le jeton est conservé.
type OnewinTokenState = "valid" | "expired" | "unknown";

async function validateOnewinToken(token: string): Promise<OnewinTokenState> {
  try {
    const res = await fetch(`${GATEWAY}/bets/get-auto-bet-amount-v2`, {
      method: "POST",
      headers: gatewayHeaders(token),
      body: JSON.stringify({ currencyCode: "XAF" }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401 || res.status === 403) return "expired";
    if (!res.ok) return "unknown"; // 429, 5xx… incident passager
    const j = await res.json().catch(() => null);
    if (!j) return "unknown";
    const errs = Array.isArray(j?.errors) ? j.errors.map((e: any) => e?.code) : [];
    if (errs.includes("unauthenticated_error")) return "expired";
    return "valid";
  } catch (_e) {
    return "unknown"; // réseau/timeout : on ne casse PAS la session
  }
}

/**
 * Connexion 1win par JETON top-parser (celui de l'en-tête make-bet-v2).
 * On valide réellement le jeton via la passerelle. Le solde n'étant pas exposé
 * par la passerelle, il reste null (affiché « — ») — la connexion est néanmoins
 * confirmée.
 */
export async function loginOnewin(rawInput: string, cookies?: string): Promise<
  | { success: true; session: { sessionId: string; token: string; account: { login: string; currency: string; balance: number | null } } }
  | { success: false; error: string; status?: number }
> {
  const v = (rawInput || "").trim();
  const token = extractOnewinToken(v);

  // ⚠️ Le jeton top-parser (gateway) expire rapidement (quelques minutes à
  // quelques heures), alors que le cookie de session 1w_token dure 1 AN.
  // Si on valide d'abord via la gateway, le jeton est souvent "expired" même
  // si la session est encore valide → fausse déconnexion.
  //
  // STRATÉGIE : si des cookies sont fournis, on valide d'abord via la lecture
  // du solde (cookie 1w_token). Si le solde est lisible, la session est valide.
  // On ne valide via la gateway QUE si les cookies échouent ou sont absents.
  if (cookies && cookies.trim()) {
    const bal = await getOnewinBalance(cookies).catch(() => null);
    if (bal?.success) {
      // ⚠️ SÉCURITÉ — le solde lisible ne suffit PAS pour parier.
      // Le cookie 1w_token dure 1 an et permet de LIRE le solde, mais le
      // placement passe par le jeton top-parser, qui expire en quelques
      // minutes. Sans ce contrôle, 1win était annoncé « connecté », la
      // première jambe partait chez l'autre book, puis 1win refusait avec
      // « unauthenticated_error » → pari à découvert (cas réel : 5 500 F
      // engagés seuls sur 1xBet le 19/08 à 02:06). On exige donc un jeton
      // de placement réellement valide AVANT de déclarer 1win utilisable.
      //
      // ✅ Le jeton de mise est désormais REFABRIQUÉ automatiquement à partir
      // du cookie de session (getToken → /auth/login). Plus aucun collage
      // manuel : à chaque pari, 1win reçoit un jeton neuf de quelques
      // secondes d'âge, donc jamais expiré au moment du placement.
      const minted = await mintOnewinBetToken(cookies);
      let betToken = minted.ok ? minted.token : token;

      // ⚠️ La lecture du solde vient de RÉUSSIR : la session (cookie 1w_token,
      // valable 1 AN) est donc prouvée vivante. Si la fabrication du jeton de
      // mise échoue malgré les retentatives, c'est un incident passager du
      // service — PAS une session morte. L'ancienne version renvoyait ici
      // « session expirée » : l'utilisateur voyait « reconnectez votre compte »
      // alors qu'il était connecté et approvisionné, en boucle.
      if (!minted.ok) {
        // Repli : le jeton enregistré, s'il est encore valide, suffit à parier.
        if (betToken) {
          let state = await validateOnewinToken(betToken);
          if (state === "unknown") {
            await new Promise((r) => setTimeout(r, 800));
            state = await validateOnewinToken(betToken);
          }
          if (state === "expired") betToken = "";
        }
        // Aucun jeton de mise utilisable À CET INSTANT : indisponibilité
        // temporaire (reprise automatique au prochain cycle), jamais une
        // demande de reconnexion. On n'engage rien tant que le jeton manque —
        // aucune jambe seule possible.
        if (!betToken) return { success: false, error: "token_unavailable", status: 503 };
      }

      return {
        success: true,
        session: {
          sessionId: extractOnewinSessionId(cookies),
          token: betToken || "",
          account: {
            login: "1win",
            currency: bal.currency,
            balance: bal.balance,
          },
        },
      };
    }
    // Cookies expirés (401/403) → session réellement morte.
    if (bal && (bal.status === 401 || bal.status === 403 || bal.error === "session_expired")) {
      return { success: false, error: "session_expired", status: bal.status };
    }
    // Non-auth error (réseau/timeout/500/429/Cloudflare) : le cookie 1w_token
    // dure 1 an, la session est probablement encore valide. On ne déclare PAS
    // la session morte — on renvoie succès avec solde null.
    // L'ancienne version tombait sur la validation gateway (jeton top-parser
    // qui expire en quelques minutes) → fausse déconnexion systématique.
    return {
      success: true,
      session: {
        sessionId: extractOnewinSessionId(cookies),
        token: token || "",
        account: { login: "1win", currency: "XAF", balance: null },
      },
    };
  }

  // 2) Validation via le jeton top-parser (gateway) — repli sans cookies.
  if (token) {
    let state = await validateOnewinToken(token);
    if (state === "unknown") {
      await new Promise((r) => setTimeout(r, 1200));
      state = await validateOnewinToken(token);
    }
    if (state === "expired") return { success: false, error: "token_expired", status: 401 };
    const bal = await getOnewinBalance(cookies || v).catch(() => null);
    return {
      success: true,
      session: {
        sessionId: extractOnewinSessionId(v),
        token,
        account: {
          login: "1win",
          currency: bal?.success ? bal.currency : "XAF",
          balance: bal?.success ? bal.balance : null,
        },
      },
    };
  }

  // 2) Repli : cookie de session collé → tenter la lecture du solde 1win.
  const sid = extractOnewinSessionId(v);
  if (!looksLikeOnewinCookies(v) && (!sid || sid.length < 20)) {
    return { success: false, error: "bad_token_format" };
  }
  const bal = await getOnewinBalance(v);
  if (!bal.success && (bal.status === 401 || bal.status === 403 || bal.error === "session_expired")) {
    return { success: false, error: "session_expired", status: bal.status };
  }
  return {
    success: true,
    session: {
      sessionId: sid,
      token: "",
      account: { login: "1win", currency: bal.success ? bal.currency : "XAF", balance: bal.success ? bal.balance : null },
    },
  };
}

export interface OnewinSelection {
  oddId: string;   // ex: "10:21612258419570790:1"
  cf: number;      // cote (ex: 1.56)
  matchId: number; // ex: 37786322
}

export interface OnewinBetRequest {
  amount: number;                 // mise (ex: 200)
  currencyCode?: string;          // "XAF" par défaut
  selections: OnewinSelection[];
}

/**
 * Traduit un code d'erreur 1win en message clair et DÉFINITIF.
 * Ces refus sont explicites : le pari n'est pas passé. Les remonter tels quels
 * (au lieu de « aucun numéro de ticket ») évite qu'ils soient pris pour une
 * réponse ambiguë — sans quoi le rattrapage refusait d'agir « par sécurité ».
 */
function onewinErrorMessage(err: any): string {
  const code = String(err?.code || "").toLowerCase();
  switch (code) {
    case "not_enough_funds": return "1win : fonds insuffisants sur le compte";
    case "min_bet_amount": return `1win : mise sous le minimum autorisé (${err?.payload?.minBetAmount || "?"} min)`;
    case "max_bet_amount": return `1win : mise au-dessus du maximum autorisé (${err?.payload?.maxBetAmount || "?"} max)`;
    case "odd_changed": case "coefficient_changed": case "cf_changed": return "1win : la cote a changé avant la pose";
    case "event_finished": case "event_not_available": case "market_closed": return "1win : marché fermé ou indisponible";
    default: return `1win a refusé le pari (${err?.code})`;
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * VALIDATION À BLANC DU COUPON — aucun franc engagé.
 *
 * POURQUOI. Mesuré sur les 400 dernières tentatives : 1win accepte presque
 * toujours (12 % de refus seulement), il est donc posé EN DERNIER. Mais quand
 * il refuse quand même, l'autre jambe est déjà engagée et l'argent reste nu :
 * c'est la totalité des découverts qui subsistaient (1 050 F sur « sélection
 * refusée », 6 000 F sur « maximum autorisé 0 »). Aucun ordre de pose ne peut
 * les éviter — seule une validation PRÉALABLE peut.
 *
 * COMMENT. get-auto-bet-amount-v2 est l'appel que fait le site quand on ouvre
 * un coupon : il renvoie le montant autorisé pour CES sélections. Interrogé
 * avec notre coupon exact, il annonce donc à l'avance ce que make-bet dirait —
 * sélection injouable, plafond à 0, minimum non atteint — sans miser.
 *
 * Verdicts : « refused » = 1win dit non, on n'engage RIEN ; « unknown » = la
 * passerelle n'a pas répondu clairement, on ne bloque pas le pari pour autant.
 * ═══════════════════════════════════════════════════════════════════
 */
export async function checkOnewinCoupon(token: string, bet: OnewinBetRequest): Promise<
  { state: "ok" | "refused" | "unknown"; reason?: string; min?: number; max?: number }
> {
  let res: Response;
  try {
    res = await fetch(`${GATEWAY}/bets/get-auto-bet-amount-v2`, {
      method: "POST",
      headers: gatewayHeaders(token.trim()),
      body: JSON.stringify({
        currencyCode: bet.currencyCode || "XAF",
        amount: bet.amount,
        coupon: {
          amount: bet.amount,
          selections: bet.selections.map((s) => ({ oddId: s.oddId, cf: s.cf, matchId: s.matchId })),
        },
        wallet: { type: "real" },
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (_e) {
    return { state: "unknown", reason: "passerelle injoignable" };
  }
  if (!res.ok) return { state: "unknown", reason: `HTTP ${res.status}` };

  const data: any = await res.json().catch(() => null);
  if (!data) return { state: "unknown", reason: "réponse illisible" };

  // Refus explicite : même vocabulaire que make-bet-v2 (selections_errors,
  // max_bet_amount, min_bet_amount, event_not_available…).
  const errs: any[] = Array.isArray(data?.errors) ? data.errors
    : data?.result?.error ? [data.result.error]
    : data?.error ? [data.error] : [];
  const real = errs.filter((e) => e?.code && String(e.code).toLowerCase() !== "unauthenticated_error");
  if (real.length) return { state: "refused", reason: onewinErrorMessage(real[0]) };

  // Bornes de mise annoncées pour CE coupon.
  const r = data?.result ?? data;
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
  const max = num(r?.maxBetAmount ?? r?.maxAmount ?? r?.max);
  const min = num(r?.minBetAmount ?? r?.minAmount ?? r?.min);
  const stake = Number(bet.amount) || 0;
  if (Number.isFinite(max) && max <= 0) {
    return { state: "refused", reason: "1win : cette sélection n'accepte aucune mise en ce moment (maximum 0)", max: 0 };
  }
  if (Number.isFinite(max) && stake > max) {
    return { state: "refused", reason: `1win : mise au-dessus du maximum autorisé (${max} max)`, max };
  }
  if (Number.isFinite(min) && min > 0 && stake < min) {
    return { state: "refused", reason: `1win : mise sous le minimum autorisé (${min} min)`, min };
  }
  return {
    state: Number.isFinite(max) || Number.isFinite(min) ? "ok" : "unknown",
    reason: Number.isFinite(max) || Number.isFinite(min) ? undefined : "aucune borne renvoyée",
    ...(Number.isFinite(min) ? { min } : {}),
    ...(Number.isFinite(max) ? { max } : {}),
  };
}

/** Place un pari 1win via la passerelle top-parser avec un jeton déjà validé. */
export async function placeOnewinBet(token: string, bet: OnewinBetRequest) {
  const idempotencyKey = crypto.randomUUID();
  const payload = {
    currencyCode: bet.currencyCode || "XAF",
    idempotencyKey,
    amount: bet.amount,
    coupon: {
      amount: bet.amount,
      selections: bet.selections.map((s) => ({ oddId: s.oddId, cf: s.cf, matchId: s.matchId })),
    },
    meta: { isDirtyAmountField: true },
    wallet: { type: "real" },
  };

  const res = await fetch(`${GATEWAY}/bets/make-bet-v2`, {
    method: "POST",
    headers: gatewayHeaders(token.trim()),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });

  const raw = await res.text();
  let data: unknown = null;
  try { data = JSON.parse(raw); } catch (_e) { data = raw; }

  if (!res.ok) {
    return { success: false, error: "bet_failed", status: res.status, detail: data };
  }

  // ⚠️ 1win renvoie HTTP 200 MÊME quand le pari est refusé : le motif est alors
  // dans result.error.code (not_enough_funds, min_bet_amount, odd_changed…).
  // Sans ce traitement, la réponse passait pour « succès sans ticket » →
  // confirmTicket la masquait en « aucun numéro de ticket » → classée AMBIGUË →
  // le rattrapage refusait d'agir. On remonte donc un refus DÉFINITIF et
  // explicite, ce qui déclenche la couverture (reprise puis repli ailleurs).
  const errObj = (data as any)?.result?.error || (data as any)?.error || null;
  if (errObj?.code) {
    const code = String(errObj.code).toLowerCase();
    // ⚠️ CONSTAT DU 15/09/2026 — « selections_errors » N'EST PAS UN REFUS.
    // Vérifié sur le compte réel : le pari « Moins de 24.5 » (2 700 F) apparaît
    // bel et bien dans l'historique 1win alors que la passerelle avait renvoyé
    // ce code. Nous l'avions traité comme un refus définitif : la jambe betPawa
    // a été déclarée « à découvert » à tort, et le rattrapage a cherché à
    // reposer la même mise — d'où des paris en double du même côté.
    // Ce code est donc AMBIGU : on n'engage plus rien de plus et on demande la
    // vérification du ticket.
    const AMBIGUOUS_CODES = ["selections_errors", "selection_error", "unknown_error", "internal_error"];
    // ── LE VRAI MOTIF EST DANS LE DÉTAIL PAR SÉLECTION ─────────────────
    // Constat du 17/09/2026 : « selections_errors » n'est qu'une enveloppe.
    // Le détail disait exactement pourquoi :
    //   result.error.selections[0].error.code = "odd_closed"
    // — la cote précise venait d'être FERMÉE par 1win (suspension live d'une
    // seconde), alors que son flux la publiait encore. Rien n'est enregistré :
    // c'est un refus certain, pas une réponse douteuse. Le traiter en « peut-être
    // passé » interdisait la couverture et faisait rejouer six fois la même cote
    // morte, jambe adverse nue pendant tout ce temps.
    const subCodes: string[] = (Array.isArray(errObj?.selections) ? errObj.selections : [])
      .map((s: any) => String(s?.error?.code || "").toLowerCase()).filter(Boolean);
    const DEFINITIVE_SUB = ["odd_closed", "odd_blocked", "odd_not_found", "odd_changed", "cf_changed", "event_finished", "event_not_available", "market_closed"];
    const hardSub = subCodes.find((c) => DEFINITIVE_SUB.includes(c));
    if (hardSub) {
      return {
        success: false, definitive: true, code: hardSub,
        error: hardSub === "odd_closed" || hardSub === "odd_blocked"
          ? `1win : cette cote vient d'être fermée par le bookmaker (${hardSub}) — rien n'est engagé chez lui`
          : onewinErrorMessage({ code: hardSub }),
        detail: data,
      };
    }
    if (AMBIGUOUS_CODES.includes(code)) {
      return {
        success: false,
        ambiguous: true,
        code,
        error: `1win : réponse non concluante (${code}) — le pari a peut-être été enregistré, vérification du ticket requise`,
        detail: data,
      };
    }
    return { success: false, definitive: true, code, error: onewinErrorMessage(errObj), detail: data };
  }
  return { success: true, status: res.status, ticket: data };
}