// ═══════════════════════════════════════════════════════════════════
// CONGOBET (Honoré Gaming / Sporty-Tech) — module de connexion + placement de pari.
//
// Flux capturé en F12 :
//   LOGIN    POST  https://hg-customer-api-prod.sporty-tech.net/api/authentication/token
//            body { login, password, rememberMe:false, withRefresh:false }
//            → JWT (header Authorization ou body).
//   ME       GET   .../api/authentication/me?onLogin=true  (Bearer)
//   BET      POST  https://hg-betting-api-prod.sporty-tech.net/api/betting  (Bearer)
//            body { type:"Simple", totalStake, maxPayout, betLines:[...], ... }
//            → 200 OK + confirmation du ticket.
//
// Aucun identifiant n'est stocké : on relogue à chaque placement pour
// obtenir un token frais, puis on poste le pari.
// ═══════════════════════════════════════════════════════════════════

const CUSTOMER_API = "https://hg-customer-api-prod.sporty-tech.net/api";
const BETTING_API = "https://hg-betting-api-prod.sporty-tech.net/api";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const BASE_HEADERS: Record<string, string> = {
  "accept": "application/json, text/plain, */*",
  "accept-language": "fr",
  "app-version": "34378",
  "content-type": "application/json",
  "origin": "https://www.congobet.net",
  "referer": "https://www.congobet.net/",
  "user-agent": UA,
};

export interface CongobetSession {
  token: string;
  account: {
    id: number;
    login: string;
    balance: number;
    free_balance: number;
    reference: string;
    currency: string;
  };
}

/**
 * Normalise un numéro Congobet au format international attendu par l'API (+242…).
 * L'API refuse le format local (067124731) → il faut le préfixe pays.
 */
function normalizeCongobetLogin(raw: string): string {
  let v = (raw || "").replace(/[\s\-().]/g, "");
  if (v.startsWith("+")) return v;                 // déjà international
  if (v.startsWith("242")) return "+" + v;         // 242… → +242…
  if (v.startsWith("0")) return "+242" + v;        // 067… → +242067…
  return "+242" + v;                               // 67… → +24267…
}

/** Connexion Congobet : renvoie le token JWT + les infos compte. */
export async function loginCongobet(login: string, password: string): Promise<
  | { success: true; session: CongobetSession }
  | { success: false; error: string; status?: number; detail?: string }
> {
  const normLogin = normalizeCongobetLogin(login);
  const tokenRes = await fetch(`${CUSTOMER_API}/authentication/token`, {
    method: "POST",
    headers: BASE_HEADERS,
    body: JSON.stringify({ login: normLogin, password, rememberMe: false, withRefresh: false }),
    signal: AbortSignal.timeout(20000),
  });

  const raw = await tokenRes.text();
  if (!tokenRes.ok) {
    return { success: false, error: "login_failed", status: tokenRes.status, detail: raw.slice(0, 300) };
  }

  let token: string | null = null;
  const authHeader = tokenRes.headers.get("authorization");
  if (authHeader) token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    try {
      const j = JSON.parse(raw);
      token = j.token || j.accessToken || j.access_token || j.jwt || (typeof j === "string" ? j : null);
    } catch (_e) {
      if (raw && raw.length > 40 && !raw.includes("{")) token = raw.replace(/^"|"$/g, "").trim();
    }
  }
  if (!token) return { success: false, error: "no_token", status: tokenRes.status, detail: raw.slice(0, 300) };

  const meRes = await fetch(`${CUSTOMER_API}/authentication/me?onLogin=true`, {
    headers: { ...BASE_HEADERS, authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!meRes.ok) return { success: false, error: "me_failed", status: meRes.status };

  const me = await meRes.json();
  if (me.isLocked) return { success: false, error: "account_locked" };

  return {
    success: true,
    session: {
      token,
      account: {
        id: me.id,
        login: me.login,
        balance: me.balance,
        free_balance: me.freeBalance,
        reference: me.reference,
        currency: "FCFA",
      },
    },
  };
}

export interface CongobetBetLine {
  number?: number;
  eventId: number;             // ID du match (ex: 77099289)
  eventBetTypeId: number;      // ID du marché (ex: 2208598189)
  eventBetTypeItemId: number;  // ID de la sélection (ex: 10178533336)
  fixedOdds: number;           // cote figée de la sélection (ex: 1.42)
  stake: number;               // mise sur cette ligne (Simple = totalStake)
  isBetBuilder?: boolean;      // false pour un pari standard
  nonRunners?: unknown | null; // null en standard
}

export interface CongobetBetRequest {
  totalStake: number;
  maxPayout: number;
  betLines: CongobetBetLine[];
  type?: string;            // "Simple" par défaut
  bettingTax?: number;
  acceptOddsChange?: boolean;
}

/**
 * Place un pari sur Congobet avec un token déjà obtenu.
 * Reproduit exactement le payload capturé en F12.
 */
export async function placeCongobetBet(token: string, bet: CongobetBetRequest) {
  const payload = {
    type: bet.type || "Simple",
    totalStake: bet.totalStake,
    maxPayout: bet.maxPayout,
    bettingTax: bet.bettingTax ?? 0,
    acceptOddsChange: bet.acceptOddsChange ?? true,
    betCode: null,
    betSystems: null,
    completeMyBetId: null,
    customerId: null,
    freeBetCouponId: null,
    useFreeBet: false,
    betLines: bet.betLines.map((l, i) => ({
      number: i + 1,
      eventId: l.eventId,
      eventBetTypeId: l.eventBetTypeId,
      eventBetTypeItemId: l.eventBetTypeItemId,
      fixedOdds: l.fixedOdds,
      stake: l.stake,
      isBetBuilder: l.isBetBuilder ?? false,
      nonRunners: l.nonRunners ?? null,
    })),
  };

  const res = await fetch(`${BETTING_API}/betting`, {
    method: "POST",
    headers: { ...BASE_HEADERS, authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });

  const raw = await res.text();
  let data: unknown = null;
  try { data = JSON.parse(raw); } catch (_e) { data = raw; }

  if (!res.ok) {
    return { success: false, error: "bet_failed", status: res.status, detail: data };
  }
  return { success: true, status: res.status, ticket: data };
}