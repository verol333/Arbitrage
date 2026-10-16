// ═══════════════════════════════════════════════════════════════════
// YELLOWBET (yellowbet.cg) — module de connexion + placement de pari.
//
// Flux capturé en F12 :
//   LOGIN   POST  https://yellowbet.cg/services/clapi/api/Authentication/LoginUser
//           body { userName, password, phoneCountryCode:"+242",
//                  registrationType:2, isPrePaid:false }
//           → { isSuccessfull, data:{...}, userInfo:{ balance, ... } }
//           Le token de session est retourné dans data (à confirmer) et/ou
//           dans un cookie de session.
//   BET     POST  https://yellowbet.cg/services/clapi/api/bet/executeorder
//           → { orderNumber, barcode, netStake, totalOdds, maxPayout, userInfo:{...} }
//           ⚠️ Le PAYLOAD de executeorder n'a pas encore été capturé.
//
// Aucun identifiant n'est stocké : on relogue à chaque placement.
// ═══════════════════════════════════════════════════════════════════

const API_BASE = "https://yellowbet.cg/services/clapi/api";
// UA iPhone Safari (capturé en F12 — correspond au trafic mobile réel du site).
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1";

// Headers capturés en F12 sur le POST LoginUser — indispensables pour que le
// backend YellowBet accepte la requête (channelid, terminal, brandid, language).
const BASE_HEADERS: Record<string, string> = {
  "accept": "*, application/json",
  "accept-language": "fr-FR,fr;q=0.9",
  "content-type": "application/json",
  "origin": "https://yellowbet.cg",
  "referer": "https://yellowbet.cg/fr/authentication/login",
  "user-agent": UA,
  "channelid": "4",
  "terminal": "yellowbet.cg",
  "brandid": "122",
  "language": "fr",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
};

export interface YellowbetSession {
  token: string | null;
  cookies: string;
  account: {
    balance: number;
    bonus: number;
    isValid: boolean;
  };
}

/** Connexion YellowBet : renvoie le token/cookie de session + le solde. */
export async function loginYellowbet(userName: string, password: string, phoneCountryCode = "+242"): Promise<
  | { success: true; session: YellowbetSession }
  | { success: false; error: string; status?: number; detail?: string }
> {
  const res = await fetch(`${API_BASE}/Authentication/LoginUser`, {
    method: "POST",
    headers: BASE_HEADERS,
    body: JSON.stringify({
      userName,
      password,
      phoneCountryCode,
      registrationType: 2,
      isPrePaid: false,
    }),
    signal: AbortSignal.timeout(20000),
  });

  const raw = await res.text();
  if (!res.ok) {
    return { success: false, error: "login_failed", status: res.status, detail: raw.slice(0, 300) };
  }

  let j: Record<string, any> = {};
  try { j = JSON.parse(raw); } catch (_e) { /* ignore */ }

  if (!j.isSuccessfull) {
    const errDesc = j?.result?.errorDescription || j?.result?.errorCodeDescription || "login_rejected";
    return { success: false, error: errDesc, status: res.status };
  }

  // Récupère le cookie de session (auth basée cookie côté YellowBet).
  const cookies = res.headers.get("set-cookie") || "";
  // Token UUID à la racine de la réponse (capturé en F12) :
  // { "token": "<UUID>", "isSuccessfull": true }
  // Fallback sur data.* pour les variantes de l'API.
  const token = j?.token || j?.data?.token || j?.data?.accessToken || j?.data?.sessionToken || null;

  const userInfo = j.userInfo || j.data?.userInfo || {};
  return {
    success: true,
    session: {
      token,
      cookies,
      account: {
        balance: userInfo.balance ?? 0,
        bonus: userInfo.bonus ?? 0,
        isValid: !!userInfo.isValid,
      },
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// CONNEXION PAR JETON (comme 1win).
// Le login direct est bloqué par le WAF (403 sur POST). L'utilisateur
// se connecte sur yellowbet.cg dans son navigateur, ouvre F12 →
// Application/Storage, et copie son jeton d'authentification (Bearer)
// ou tout le paquet de cookies. On valide en lisant les infos du compte.
// ═══════════════════════════════════════════════════════════════════

/**
 * L'utilisateur peut coller AU CHOIX : un JWT/token seul, une valeur "Bearer …",
 * ou TOUT le paquet de cookies du site. On accepte les deux sans distinction.
 * Cette fonction extrait le meilleur JWT trouvé (pour l'en-tête Authorization),
 * mais on enverra AUSSI les cookies bruts tels quels s'ils sont fournis.
 */
export function extractYellowbetToken(raw: string): string {
  const v = (raw || "").trim();
  // 1) JWT complet où qu'il soit (le plus fiable) : eyJ....eyJ....sig
  const jwt = v.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  if (jwt) return jwt[0];
  // 2) paire nommée token=… / accessToken=… / authToken=… / jwt=…
  const named = v.match(/(?:access[_-]?token|auth[_-]?token|id[_-]?token|token|jwt)["'\s:=]+"?([A-Za-z0-9._-]{20,})"?/i);
  if (named) return named[1].trim();
  // 3) "Bearer xxx"
  const bearer = v.match(/Bearer\s+([A-Za-z0-9._-]{20,})/i);
  if (bearer) return bearer[1].trim();
  // 4) sinon valeur brute (cas d'un token opaque collé seul)
  return v;
}

/** true si l'entrée ressemble à un paquet de cookies (paires clé=valeur, séparateurs ;). */
function looksLikeCookies(raw: string): boolean {
  const v = (raw || "").trim();
  return /=/.test(v) && (/;/.test(v) || /token|session|sid|auth/i.test(v));
}

// Endpoints candidats pour lire les infos du compte (le back a bougé selon les versions).
const ACCOUNT_ENDPOINTS = [
  { path: "/User/GetUserInfo", method: "GET" },
  { path: "/User/GetUserBalance", method: "GET" },
  { path: "/Account/GetUserInfo", method: "GET" },
  { path: "/Account/GetBalance", method: "GET" },
  { path: "/Authentication/GetUserInfo", method: "GET" },
  { path: "/Wallet/GetBalance", method: "GET" },
];

/**
 * Lit les infos du compte YellowBet à partir d'un token OU d'un bloc de cookies.
 * On envoie SYSTÉMATIQUEMENT les deux formes d'auth :
 *   - Authorization: Bearer <jwt extrait>
 *   - cookie: <cookies bruts si fournis, sinon token=<jwt>>
 * On teste plusieurs endpoints. Un 401/403 franc = token expiré. Sinon on
 * accepte le jeton (found=false) — le solde sera lu quand un endpoint répondra.
 */
export async function getYellowbetAccount(rawToken: string): Promise<
  { success: true; found: boolean; balance: number | null; bonus: number; currency: string; login: string }
  | { success: false; error: string; status?: number }
> {
  const tk = extractYellowbetToken(rawToken);
  if (!tk) return { success: false, error: "no_token" };

  // Cookies bruts si l'utilisateur les a collés ; sinon on fabrique un cookie token=…
  const cookieHeader = looksLikeCookies(rawToken)
    ? rawToken.trim().replace(/\s*\n\s*/g, "; ")
    : `token=${tk}; accessToken=${tk}`;

  let sawRealAuthError = false; // 401/403 JSON = session vraiment invalide
  for (const ep of ACCOUNT_ENDPOINTS) {
    try {
      const res = await fetch(`${API_BASE}${ep.path}`, {
        method: ep.method,
        headers: { ...BASE_HEADERS, authorization: `Bearer ${tk}`, cookie: cookieHeader },
        signal: AbortSignal.timeout(15000),
      });
      const ct = res.headers.get("content-type") || "";
      const isHtml = ct.includes("text/html");
      // ⚠️ 403 + HTML = blocage Cloudflare sur l'IP du serveur (WAF), PAS un token
      // expiré : le cf_clearance de l'utilisateur est lié à SON IP/navigateur et
      // n'est pas rejouable côté serveur. On ne doit donc PAS conclure "expiré".
      if ((res.status === 401 || res.status === 403) && !isHtml) { sawRealAuthError = true; continue; }
      if (!res.ok) continue; // 403 HTML (Cloudflare), 400, 404… → endpoint suivant
      let j: Record<string, any> = {};
      try { j = await res.json(); } catch (_e) { continue; }
      const info = j.userInfo || j.data || j || {};
      if (info.balance == null && info.userName == null && info.login == null) continue;
      return {
        success: true,
        found: true,
        balance: Number(info.balance ?? 0),
        bonus: Number(info.bonus ?? 0),
        currency: info.currency || "XAF",
        login: info.userName || info.login || info.phoneNumber || "YellowBet",
      };
    } catch (_e) { /* endpoint suivant */ }
  }

  // Vrai 401/403 JSON sur tous les endpoints → la session n'est plus valide.
  if (sawRealAuthError) return { success: false, error: "token_expired", status: 401 };

  // Blocage Cloudflare / endpoints injoignables : le solde ne peut pas être lu
  // côté serveur (cf_clearance non rejouable), mais le jeton est accepté.
  // balance reste null → affiché « — ».
  return { success: true, found: false, balance: null, bonus: 0, currency: "XAF", login: "YellowBet" };
}

/**
 * Connexion YellowBet par jeton OU cookies. On accepte dès que l'entrée est
 * plausible ; si un endpoint compte répond, on récupère le solde réel.
 */
export async function loginYellowbetToken(rawToken: string): Promise<
  | { success: true; session: { token: string; account: { login: string; currency: string; balance: number | null; bonus: number } } }
  | { success: false; error: string; status?: number }
> {
  const v = (rawToken || "").trim();
  const tk = extractYellowbetToken(v);
  // Accepte si : cookies collés, OU token d'au moins 20 caractères.
  if (!looksLikeCookies(v) && (!tk || tk.length < 20)) {
    return { success: false, error: "bad_token_format" };
  }

  const acc = await getYellowbetAccount(v);
  if (!acc.success) return { success: false, error: acc.error, status: acc.status };

  return {
    success: true,
    session: {
      token: tk,
      account: { login: acc.login, currency: acc.currency, balance: acc.balance, bonus: acc.bonus },
    },
  };
}