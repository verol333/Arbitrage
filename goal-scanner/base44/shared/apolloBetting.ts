// ═══════════════════════════════════════════════════════════════════
// APOLLO GAMES (BetX / webapis.sk) — module de connexion + placement de pari.
//
// Flux capturé en F12 :
//   LOGIN   POST  https://apis-apollo.webapis.sk/AuthApi/token
//           content-type x-www-form-urlencoded
//           grant_type=password&username=<login>&password=<pass>
//              &client_id=52b674cfc433483fac3bb84482d3ecc2&terminal_type=2
//           → { access_token (bearer), expires_in, ... }
//   BET     POST  https://sportapis-apollo.webapis.sk/BettingApi2/api/betting/submit
//           (Bearer) body { AutoConfirm:true, BetSlipType:0, Bets:[...],
//              GameType:1, Systems:[{TypeFrom,TypeTo,PayIn}], Settings{...}, UseBonusCredit:false }
//           → confirmation ticket (EncryptedTicketPin, PayIn, TotalOdds, ...).
//
// Aucun identifiant n'est stocké : on relogue à chaque placement.
// ═══════════════════════════════════════════════════════════════════

const AUTH_API = "https://apis-apollo.webapis.sk/AuthApi/token";
const WALLET_API = "https://apis-apollo.webapis.sk/WalletApiCore/api/wallet";
const BETTING_API = "https://sportapis-apollo.webapis.sk/BettingApi2/api/betting";
const CLIENT_ID = "52b674cfc433483fac3bb84482d3ecc2";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

const ORIGIN_HEADERS: Record<string, string> = {
  "accept": "application/json, text/plain, */*",
  "accept-language": "fr-FR,fr;q=0.5",
  "origin": "https://m.apollogames.cg",
  "referer": "https://m.apollogames.cg/",
  "user-agent": UA,
};

export interface ApolloAccount {
  login: string;
  balance: number | null;
  currency: string;
}

export interface ApolloSession {
  token: string;
  clientId: string;
  terminalId: string;
  account: ApolloAccount;
}

/** Décode le payload d'un JWT (base64url) sans vérifier la signature. */
function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = atob(pad);
    return JSON.parse(json);
  } catch (_e) {
    return null;
  }
}

/**
 * Lit le solde joueur Apollo.
 * Endpoint réel (confirmé F12 + reverse du SPA m.apollogames.cg) :
 *   POST {WalletApiCore}/wallet/balance
 *   headers { Bearer, TerminalId, Device-Type }
 *   body    { MembershipType, Username }
 *   → { Balance, LockedBalance, BonusBalance, IsSuccess, ... }
 * Le TerminalId (33) et le Username (login) sont portés par le JWT.
 */
export async function getApolloBalance(login: string, token: string): Promise<{ balance: number | null; currency: string }> {
  const claims = decodeJwt(token) || {};
  const terminalId = (claims.terminal_id as string) || "33";
  const membershipType = Number(claims.membership_type ?? 2) || 2;
  const username = (claims.unique_name as string) || (claims.sub as string) || login;

  try {
    const res = await fetch(`${WALLET_API}/balance`, {
      method: "POST",
      headers: {
        ...ORIGIN_HEADERS,
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "TerminalId": String(terminalId),
        "Device-Type": "2",
      },
      body: JSON.stringify({ MembershipType: membershipType, Username: username }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { balance: null, currency: "FCFA" };
    const j = await res.json().catch(() => ({} as Record<string, unknown>));
    const bal = (j.Balance as number);
    if (typeof bal === "number" && Number.isFinite(bal)) {
      return { balance: bal, currency: "FCFA" };
    }
  } catch (_e) { /* solde indisponible */ }
  return { balance: null, currency: "FCFA" };
}

/** Connexion Apollo : renvoie l'access_token bearer. */
export async function loginApollo(login: string, password: string): Promise<
  | { success: true; session: ApolloSession }
  | { success: false; error: string; status?: number; detail?: string }
> {
  const form = new URLSearchParams({
    grant_type: "password",
    username: login,
    password: password,
    client_id: CLIENT_ID,
    terminal_type: "2",
  });

  const res = await fetch(AUTH_API, {
    method: "POST",
    headers: { ...ORIGIN_HEADERS, "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    signal: AbortSignal.timeout(20000),
  });

  const raw = await res.text();
  if (!res.ok) {
    return { success: false, error: "login_failed", status: res.status, detail: raw.slice(0, 300) };
  }

  let j: Record<string, unknown> = {};
  try { j = JSON.parse(raw); } catch (_e) { /* ignore */ }
  const token = (j.access_token as string) || null;
  if (!token) return { success: false, error: "no_token", status: res.status, detail: raw.slice(0, 300) };

  // Lecture du solde (essentielle pour la répartition des mises automatiques).
  const { balance, currency } = await getApolloBalance(login, token);

  return {
    success: true,
    session: {
      token,
      clientId: (j.client_id as string) || CLIENT_ID,
      terminalId: (j.terminal_id as string) || "",
      account: { login, balance, currency },
    },
  };
}

export interface ApolloBet {
  BetData: number | string;  // ID de la sélection (ex: 457011546)
  EventId: number;           // ID du match (ex: 68162500)
  Odd: number;               // cote (ex: 1.14)
  Pick: string;              // sélection (ex: "1")
  Game?: number;             // 2 = football prématch (capturé), 1 par défaut
  Sbv?: unknown | null;      // handicap/total (null en 1X2)
  IsBasic?: boolean;
  LeagueId?: number;         // ID ligue (ex: 45427)
  PickIdentifier?: string;   // ex: "uof:1/sr:sport:1/1/1"
  Probability?: number;      // proba implicite renvoyée par Apollo
}

export interface ApolloBetRequest {
  payIn: number;             // mise totale (ex: 300)
  bets: ApolloBet[];
  gameType?: number;         // 1 par défaut
}

/** Construit un objet Bet Apollo à partir de nos champs internes. */
function buildBet(b: ApolloBet, payIn: number) {
  return {
    Game: b.Game ?? 2,
    // Capture F12 : BetData est un NOMBRE (461230127), pas une chaîne.
    BetData: Number(b.BetData),
    Pick: b.Pick,
    Odd: b.Odd,
    Odds: null,
    Fix: false,
    Sbv: b.Sbv ?? null,
    Group: "A",
    EventId: b.EventId,
    BetAmount: payIn,
    IsBasic: b.IsBasic ?? true,
    LeagueId: b.LeagueId ?? 0,
    PickIdentifier: b.PickIdentifier ?? undefined,
    Probability: b.Probability ?? undefined,
  };
}

/**
 * Place un pari sur Apollo avec un token déjà obtenu.
 * Reproduit le flux F12 : /calculate (préparation) puis /submit (AutoConfirm:true).
 */
export async function placeApolloBet(token: string, bet: ApolloBetRequest) {
  const gameType = bet.gameType ?? 1;
  const headers = {
    ...ORIGIN_HEADERS,
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    // En-têtes présents dans la capture F12 du ticket réel.
    "device-type": "mobile",
    "languageid": "fr",
    "terminalid": "33",
  };

  // 1) /calculate — prépare/valide le ticket et remonte les erreurs de cote/marché
  const calcPayload = {
    UseBonusCredit: false,
    AutoConfirm: false,
    BetSlipType: 0,
    GameType: gameType,
    OddBonusId: 0,
    OddBonusMode: 0,
    Bets: bet.bets.map((b) => buildBet(b, bet.payIn)),
    Systems: [{ TypeFrom: 1, TypeTo: 1, PayIn: bet.payIn }],
    Settings: {
      AcceptAllChanges: true,
      AcceptHigherOdds: false,
      IgnoreOddsChange: false,
      IsQuickTicket: false,
      OddsChangePercentAccepted: 0,
      OddsRepresentation: "decimal",
    },
  };

  const calcRes = await fetch(`${BETTING_API}/calculate`, {
    method: "POST",
    headers,
    body: JSON.stringify(calcPayload),
    signal: AbortSignal.timeout(20000),
  });
  const calcRaw = await calcRes.text();
  let calc: Record<string, unknown> = {};
  try { calc = JSON.parse(calcRaw); } catch (_e) { /* ignore */ }

  if (!calcRes.ok) {
    return { success: false, error: "calculate_failed", status: calcRes.status, detail: calcRaw.slice(0, 400) };
  }
  const calcErrors = (calc.Errors as unknown[]) || [];
  if (calcErrors.length > 0) {
    return { success: false, error: "calculate_rejected", status: calcRes.status, detail: calcErrors };
  }
  // ⚠️ Apollo laisse « Errors » VIDE à la racine et met le vrai refus dans
  // BetResults[].Errors (ex. Error 10 « Offre rétirée du serveur »). Sans cette
  // lecture, /calculate paraissait valide, on soumettait quand même, et le refus
  // ressortait en « aucun numéro de ticket » — donc en position ambiguë obligeant
  // à vérifier à la main, alors que le bookmaker avait clairement dit non.
  const calcLegError = apolloLegError(calc);
  if (calcLegError) {
    return { success: false, error: `Apollo refuse cette sélection : ${calcLegError}`, status: calcRes.status, detail: calc };
  }

  // 2) /submit — confirme le pari
  const submitPayload = {
    UseBonusCredit: false,
    AutoConfirm: true,
    BetSlipType: 0,
    GameType: gameType,
    OddBonusId: 0,
    OddBonusMode: 0,
    Bets: bet.bets.map((b) => buildBet(b, bet.payIn)),
    Systems: [{ TypeFrom: 1, TypeTo: 1, PayIn: bet.payIn }],
    Settings: {
      AcceptAllChanges: true,
      AcceptHigherOdds: false,
      IgnoreOddsChange: false,
      IsQuickTicket: false,
      OddsChangePercentAccepted: 0,
      OddsRepresentation: "decimal",
    },
  };

  const res = await fetch(`${BETTING_API}/submit`, {
    method: "POST",
    headers,
    body: JSON.stringify(submitPayload),
    signal: AbortSignal.timeout(20000),
  });

  const raw = await res.text();
  let data: unknown = null;
  try { data = JSON.parse(raw); } catch (_e) { data = raw; }

  if (!res.ok) {
    return { success: false, error: "bet_failed", status: res.status, detail: data };
  }
  // Même lecture après /submit : un refus par jambe est un refus NET, sans
  // aucune mise engagée — il ne doit jamais être présenté comme « réponse
  // ambiguë, vérifiez à la main ».
  const legError = apolloLegError(data);
  if (legError) {
    return { success: false, error: `Apollo a refusé le pari : ${legError}`, status: res.status, detail: data };
  }
  return { success: true, status: res.status, ticket: data };
}

/**
 * Lit le refus par jambe d'une réponse Apollo (/calculate comme /submit).
 * Renvoie le message traduit par Apollo, ou null si aucune jambe n'est refusée.
 */
export function apolloLegError(payload: unknown): string | null {
  const results = (payload as any)?.BetResults;
  if (!Array.isArray(results)) return null;
  for (const r of results) {
    const errs = r?.Errors;
    if (!Array.isArray(errs) || !errs.length) continue;
    const e = errs[0];
    const msg = String(e?.TranslatedMessage || e?.TranslatedDescription || "").trim();
    return msg || `code ${e?.Error ?? "?"}`;
  }
  return null;
}