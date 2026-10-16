// ═══════════════════════════════════════════════════════════════════
// BETMOMO (plateforme BetConstruct « swarm », site 211) — connexion, solde,
// lecture des cotes et placement de pari.
//
// Flux vérifié depuis nos serveurs (WebSocket wss://eu-swarm-ws.betconstruct.com/) :
//   SESSION   { command:"request_session", params:{ language:"fra", site_id:211 } }
//   LOGIN     { command:"login", params:{ username:<email>, password } }
//             → data { user_id, auth_token }   (l'identifiant est l'EMAIL, pas l'ID)
//   REPRISE   { command:"restore_login", params:{ user_id, auth_token } }
//   SOLDE     { command:"get", params:{ source:"user", what:{ profile:[] } } }
//   COTES     { command:"get", params:{ source:"betting", what:{ game:[…], market:[…], event:[…] } } }
//   PARI      { command:"do_bet", params:{ type:1, mode:1, source:"betting",
//                 amount, bets:[{ event_id, price }] } }
//             → data.result 0 = accepté (+ bet id) ; 2400 = solde insuffisant
//
// Chaque opération ouvre sa propre socket, l'utilise puis la referme.
// ═══════════════════════════════════════════════════════════════════

const WS_URL = "wss://eu-swarm-ws.betconstruct.com/";
const SITE_ID = 211;

export interface SwarmStep {
  command: string;
  params?: Record<string, unknown>;
}

type Auth = { username: string; password: string } | { userId: number | string; authToken: string } | null;

/**
 * Ouvre une socket swarm, s'authentifie (login ou reprise de session) puis exécute
 * les commandes dans l'ordre. Renvoie la réponse de chacune.
 */
/**
 * BetMomo réclame de plus en plus souvent une vérification reCAPTCHA v3 au
 * moment de la connexion (message « Recaptcha verification needed », code 27) :
 * c'est le cas systématique depuis nos serveurs. Le site officiel résout cela en
 * envoyant, sur la MÊME socket et AVANT le login, la commande
 * `validate_recaptcha` avec le jeton produit par Google dans le navigateur.
 * On reproduit exactement ce mécanisme : le jeton est fabriqué dans le
 * navigateur de l'utilisateur (invisible, aucun puzzle à résoudre) puis
 * transmis ici. La réponse code 27 contient la clé publique du site — on la
 * renvoie au frontend pour qu'il puisse produire le jeton.
 */
export function swarmCall(
  auth: Auth,
  steps: SwarmStep[],
  timeoutMs = 25000,
  recaptchaToken?: string | null,
): Promise<
  | { success: true; login: Record<string, any> | null; responses: Record<string, any>[] }
  | { success: false; error: string; detail?: unknown; siteKey?: string }
> {
  return new Promise((resolve) => {
    let settled = false;
    const responses: Record<string, any>[] = [];
    let loginData: Record<string, any> | null = null;
    let ws: WebSocket;

    const finish = (v: any) => {
      if (settled) return;
      settled = true;
      try { ws?.close(); } catch (_e) { /* ignore */ }
      resolve(v);
    };

    try { ws = new WebSocket(WS_URL); } catch (e) {
      return resolve({ success: false, error: "ws_unreachable", detail: String(e) });
    }

    const timer = setTimeout(() => finish({ success: false, error: "timeout" }), timeoutMs);
    const done = (v: any) => { clearTimeout(timer); finish(v); };

    let i = 0;
    const sendNext = () => {
      if (i >= steps.length) return done({ success: true, login: loginData, responses });
      ws.send(JSON.stringify({ command: steps[i].command, params: steps[i].params || {}, rid: "X" + i }));
    };

    const sendAuth = () => {
      if (!auth) return sendNext();
      if ("username" in auth) {
        ws.send(JSON.stringify({ command: "login", params: { username: auth.username, password: auth.password }, rid: "L" }));
      } else {
        ws.send(JSON.stringify({ command: "restore_login", params: { user_id: Number(auth.userId), auth_token: auth.authToken }, rid: "L" }));
      }
    };

    ws.onopen = () => ws.send(JSON.stringify({
      command: "request_session",
      params: { language: "fra", site_id: SITE_ID },
      rid: "S",
    }));
    ws.onerror = () => done({ success: false, error: "ws_error" });
    ws.onclose = () => done({ success: false, error: "closed_early" });

    ws.onmessage = (ev) => {
      let msg: any = null;
      try { msg = JSON.parse(String((ev as MessageEvent).data)); } catch (_e) { return; }

      if (msg.rid === "S") {
        if (!auth) return sendNext();
        // Jeton reCAPTCHA fourni → BetMomo doit le valider AVANT le login.
        if (recaptchaToken) {
          ws.send(JSON.stringify({
            command: "validate_recaptcha",
            params: { g_recaptcha_response: recaptchaToken, action: "login" },
            rid: "C",
          }));
          return;
        }
        return sendAuth();
      }

      if (msg.rid === "C") return sendAuth();

      if (msg.rid === "L") {
        if (msg.code === 27) {
          // « Recaptcha verification needed » — msg.data porte la clé publique.
          return done({ success: false, error: "captcha_required", siteKey: String(msg.data || ""), detail: msg?.msg });
        }
        if (msg.code !== 0) {
          const key = msg?.data?.details?.Key || msg?.msg || `code ${msg.code}`;
          return done({ success: false, error: String(key), detail: msg?.data });
        }
        loginData = msg.data || {};
        return sendNext();
      }

      if (typeof msg.rid === "string" && msg.rid.startsWith("X")) {
        responses.push(msg);
        i += 1;
        sendNext();
      }
    };
  });
}

export interface BetmomoSession {
  token: string; // "userId:authToken"
  userId: number;
  account: { login: string; balance: number | null; currency: string; reference: string };
}

const PROFILE_STEP: SwarmStep = { command: "get", params: { source: "user", what: { profile: [] }, subscribe: false } };

function readProfile(res: Record<string, any> | undefined) {
  const profiles = res?.data?.data?.profile;
  const first = profiles ? Object.values(profiles)[0] as Record<string, any> : null;
  if (!first) return null;
  const n = Number(first.balance);
  return {
    balance: Number.isFinite(n) ? n : null,
    currency: String(first.currency || first.currency_id || "XAF"),
    name: String(first.email || first.name || ""),
  };
}

/** Connexion BetMomo : identifiant = l'email du compte. */
export async function loginBetmomo(login: string, password: string, recaptchaToken?: string | null): Promise<
  { success: true; session: BetmomoSession } | { success: false; error: string; detail?: unknown; siteKey?: string }
> {
  const r = await swarmCall(
    { username: (login || "").trim(), password: password || "" },
    [PROFILE_STEP],
    25000,
    recaptchaToken || null,
  );
  if (!r.success) {
    // BetMomo réclame la vérification reCAPTCHA : on remonte la clé du site pour
    // que le navigateur de l'utilisateur produise le jeton, puis on réessaie.
    if (r.error === "captcha_required") {
      return { success: false, error: "captcha_required", siteKey: (r as any).siteKey };
    }
    const err = /InvalidUsernamePassword/i.test(r.error)
      ? "Email ou mot de passe BetMomo incorrect"
      : `BetMomo a refusé la connexion (${r.error})`;
    return { success: false, error: err, detail: (r as any).detail };
  }

  const userId = Number(r.login?.user_id);
  const authToken = String(r.login?.auth_token || "");
  if (!userId || !authToken) return { success: false, error: "no_auth_token" };

  const p = readProfile(r.responses[0]);
  return {
    success: true,
    session: {
      token: `${userId}:${authToken}`,
      userId,
      account: {
        login: p?.name || login,
        balance: p?.balance ?? null,
        currency: p?.currency || "XAF",
        reference: String(userId),
      },
    },
  };
}

function splitToken(token: string) {
  const [userId, authToken] = String(token).split(":");
  return { userId, authToken };
}

// La socket swarm de BetMomo lâche régulièrement UNE requête (temporisation,
// fermeture prématurée, erreur réseau) alors que la session est parfaitement
// valide. Ces échecs-là ne veulent PAS dire « session expirée » : c'est la
// cause du clignotement « Actif ↔ Vérification… » signalé par les utilisateurs.
// On distingue donc un vrai refus d'un simple couac réseau, et on retente.
const TRANSIENT = new Set(["timeout", "closed_early", "ws_error", "ws_unreachable"]);

/**
 * Reprise de session résiliente : retente tant que l'échec est un couac réseau,
 * abandonne immédiatement sur un vrai refus (session réellement révoquée).
 */
async function swarmRestore(userId: string, authToken: string, attempts = 3) {
  let last: any = null;
  for (let i = 0; i < attempts; i++) {
    const r = await swarmCall({ userId, authToken }, [PROFILE_STEP]);
    if (r.success) return r;
    last = r;
    // Vrai refus (ex: session révoquée) → inutile d'insister.
    if (!TRANSIENT.has(r.error)) return r;
    // Couac réseau → petite pause puis nouvelle tentative.
    if (i < attempts - 1) await new Promise((res) => setTimeout(res, 400 * (i + 1)));
  }
  return last;
}

/**
 * Reprend une session BetMomo déjà ouverte (jeton « userId:authToken »).
 * Cette voie n'est JAMAIS soumise au reCAPTCHA : c'est elle qui permet à la mise
 * automatique de fonctionner depuis nos serveurs après une connexion validée une
 * seule fois par l'utilisateur.
 */
export async function restoreBetmomo(token: string): Promise<
  { success: true; session: BetmomoSession } | { success: false; error: string }
> {
  const { userId, authToken } = splitToken(token);
  if (!userId || !authToken) return { success: false, error: "session_expired" };
  const r = await swarmRestore(userId, authToken);
  if (!r.success) return { success: false, error: "session_expired" };
  const p = readProfile(r.responses[0]);
  return {
    success: true,
    session: {
      token: `${userId}:${authToken}`,
      userId: Number(userId),
      account: {
        login: p?.name || "BetMomo",
        balance: p?.balance ?? null,
        currency: p?.currency || "XAF",
        reference: String(userId),
      },
    },
  };
}

/** Lit le solde d'une session BetMomo déjà ouverte. */
export async function fetchBetmomoBalance(token: string): Promise<number | null> {
  const { userId, authToken } = splitToken(token);
  if (!userId || !authToken) return null;
  const r = await swarmRestore(userId, authToken);
  if (!r.success) return null;
  return readProfile(r.responses[0])?.balance ?? null;
}

/** Vérifie qu'une session (token) est toujours acceptée par BetMomo. */
export async function inspectBetmomoSession(token: string) {
  const { userId, authToken } = splitToken(token);
  if (!userId || !authToken) return { valid: false, reason: "Session BetMomo illisible — reconnectez le compte" };
  const r = await swarmRestore(userId, authToken);
  if (!r.success) return { valid: false, reason: "Session BetMomo expirée — reconnectez votre compte BetMomo" };
  return { valid: true, balance: readProfile(r.responses[0])?.balance ?? null };
}

export interface BetmomoBetRequest {
  stake: number;
  eventId: number | string;
  price: number;
}

/**
 * BetMomo (BetConstruct) accepte un pari de plusieurs façons selon la réponse :
 *   { result: 0 }                → accepté (forme numérique classique)
 *   { result: "OK", result_text: "0", details: { … ticket … } } → accepté aussi
 *   { result: 1800, result_text: "BetSelectionChanged" }        → vrai refus
 * Le code « 0 » signifie TOUJOURS accepté, qu'il soit dans result ou result_text.
 * Sans cette lecture, un pari réellement posé était compté comme refusé : le
 * compte était déclaré à découvert alors qu'il était couvert, et les reprises
 * risquaient de reposer une seconde fois la même mise.
 */
function betmomoAccepted(data: Record<string, any>): boolean {
  const code = String(data?.result ?? "").trim().toUpperCase();
  const text = String(data?.result_text ?? "").trim().toUpperCase();
  if (code === "0" || code === "OK") return true;
  if (text === "0" || text === "OK") return true;
  return false;
}

/** Place un pari simple BetMomo. mode 1 = accepte la cote telle qu'envoyée. */
export async function placeBetmomoBet(token: string, bet: BetmomoBetRequest) {
  const r = await swarmCall(splitToken(token), [{
    command: "do_bet",
    params: {
      type: 1,
      mode: 1,
      each_way: false,
      source: "betting",
      amount: bet.stake,
      bets: [{ event_id: Number(bet.eventId), price: bet.price }],
    },
  }]);

  if (!r.success) return { success: false, error: `BetMomo injoignable (${r.error})`, detail: (r as any).detail };

  const data = r.responses[0]?.data || {};
  if (!betmomoAccepted(data)) {
    const msg = data?.details?.Message || data.result_text || `résultat ${data.result}`;
    return { success: false, error: `BetMomo a refusé : ${msg}`, detail: data };
  }
  return { success: true, ticket: data };
}