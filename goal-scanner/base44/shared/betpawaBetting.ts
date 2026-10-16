// ═══════════════════════════════════════════════════════════════════
// BETPAWA CONGO (cg.betpawa.com) — connexion, solde, cotes et placement de pari.
//
// Flux vérifié depuis nos serveurs (aucun blocage anti-bot) :
//   LOGIN    POST /api/user/v3/authenticate
//            body { username, password, rememberMe:true }
//            → set-cookie x-pawa-token=… (+ userUuid dans la réponse)
//   SOLDE    POST /api/ledger/v2/funds/balance/list?uuid={userUuid}
//            → [{ balance, currency }]
//   MATCHS   GET  /api/sportsbook/v4/events/lists/by-queries?q={json}
//            q = { queries:[{ query:{ eventType:"UPCOMING"|"LIVE", categories:[id], hasOdds:true }, take, skip }] }
//   COTES    GET  /api/sportsbook/v4/events/{eventId}
//            → markets[].row[].prices[] { id (=selectionId), name, odds }
//   PARI     POST /api/betslip/validator/v2/place-bet/real
//            body { stake, stakeType:"STAKE", legs:[{selectionIds:[…], price, type:"SINGLE"}], currency, meta:{…} }
//
// Aucun identifiant n'est stocké : on relogue à chaque appel.
// ═══════════════════════════════════════════════════════════════════

import {
  BetpawaCountry,
  BETPAWA_BY_HOST,
  BETPAWA_BY_ISO,
  BETPAWA_COUNTRIES,
  DEFAULT_BETPAWA_COUNTRY,
  betpawaCountryFromPrefix,
  cleanNumber,
  localNumber,
  numberForms,
} from "./betpawaCountries.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

/** En-têtes du site du pays de l'utilisateur (chaque pays a sa propre marque). */
function headersFor(c: BetpawaCountry): Record<string, string> {
  const origin = `https://${c.host}`;
  return {
    "accept": "application/json",
    "accept-language": c.lang === "fr" ? "fr-FR,fr;q=0.9" : "en-US,en;q=0.9",
    "content-type": "application/json",
    "devicetype": "web",
    "origin": origin,
    "referer": `${origin}/`,
    "user-agent": UA,
    "x-pawa-brand": c.brand,
    "x-pawa-language": c.lang,
  };
}

export interface BetpawaSession {
  token: string;
  userUuid: string;
  /** Site du pays sur lequel la session est ouverte (nécessaire au placement). */
  host: string;
  brand: string;
  countryName: string;
  account: {
    login: string;
    balance: number | null;
    currency: string;
    reference: string;
  };
}

function authHeaders(token: string, c: BetpawaCountry = DEFAULT_BETPAWA_COUNTRY): Record<string, string> {
  return { ...headersFor(c), cookie: `bp_country=${c.iso}; x-pawa-token=${token}` };
}

// ── betPawa est CLOISONNÉ PAR PAYS ──────────────────────────────────
// Chaque pays a son propre site (cg.betpawa.com, bj.betpawa.com, …) et un
// compte créé au Bénin n'existe PAS sur le site du Congo : le numéro d'un autre
// pays envoyé au site du Congo recevait « numéro ou mot de passe incorrect »,
// message trompeur alors que le compte est parfaitement valide chez lui.
// Le pays est donc déduit de l'indicatif du numéro (voir betpawaCountries.ts)
// et TOUS les appels partent du site de ce pays.
/** Traduit le refus betPawa en message compréhensible. */
function loginErrorMessage(code: string): string {
  if (/WRONG_USERNAME_OR_PASSWORD/i.test(code)) return "Numéro ou mot de passe betPawa incorrect";
  if (/ATTEMPTS_EXCEEDED|TOO_MANY|THROTTL|RATE/i.test(code)) return "betPawa a temporairement verrouillé la connexion (trop de tentatives) — attendez ~30 min ou reconnectez-vous une fois sur le site betPawa, puis réessayez";
  if (/BLOCKED|LOCKED|SUSPEND/i.test(code)) return "Compte betPawa bloqué par le bookmaker";
  return `betPawa a refusé la connexion (${code})`;
}

/**
 * Lit le solde ET la devise du compte sur le site de son pays.
 * La devise est LUE, jamais devinée : elle varie (XAF, XOF, NGN, KES, …) et
 * sert telle quelle au placement du pari.
 */
export async function fetchBetpawaFunds(
  token: string,
  userUuid: string,
  country: BetpawaCountry = DEFAULT_BETPAWA_COUNTRY,
): Promise<{ balance: number; currency: string } | null> {
  const res = await fetch(`https://${country.host}/api/ledger/v2/funds/balance/list?uuid=${userUuid}`, {
    method: "POST",
    headers: authHeaders(token, country),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const first = Array.isArray(data) ? data[0] : data;
  const n = Number(first?.balance);
  if (!Number.isFinite(n)) return null;
  return { balance: n, currency: String(first?.currency || "XAF") };
}

/** Lit le solde du compte (compatibilité : renvoie uniquement le montant). */
export async function fetchBetpawaBalance(
  token: string,
  userUuid: string,
  country: BetpawaCountry = DEFAULT_BETPAWA_COUNTRY,
): Promise<number | null> {
  const funds = await fetchBetpawaFunds(token, userUuid, country);
  return funds ? funds.balance : null;
}

// ⚠️ betPawa n'accepte qu'UNE session active par compte : chaque nouvelle
// authentification invalide la précédente (l'utilisateur se retrouve déconnecté)
// et l'enchaînement finit par déclencher LOGINS_ATTEMPTS_EXCEEDED. On garde donc
// le jeton obtenu et on le réutilise tant qu'il répond, au lieu de se
// réauthentifier à chaque lecture de solde ou tentative de pari.
// Le cache mémoire ne survit pas d'une exécution serveur à l'autre : un store
// persistant (base de données) peut être branché via setBetpawaSessionStore,
// pour que TOUTES les fonctions réutilisent le même jeton.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOCK_MARK = "LOCKED";
const LOCK_WAIT_MS = 35 * 60 * 1000;
const sessionCache = new Map<string, Cached>();

type Cached = { token: string; userUuid: string; at: number; country?: string; pwHash?: string };
interface SessionStore {
  get: (key: string) => Promise<Cached | null>;
  set: (key: string, value: { token: string; userUuid: string; country?: string; pwHash?: string }) => Promise<void>;
  clear: (key: string) => Promise<void>;
}

/**
 * Empreinte du mot de passe : le jeton en cache n'est réutilisé que par celui
 * qui connaît le mot de passe du compte — un tiers qui saisirait seulement le
 * numéro d'un autre membre ne peut pas récupérer sa session.
 */
async function passwordHash(password: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`betpawa:${password}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
let store: SessionStore | null = null;

/** Branche un stockage persistant du jeton de session (voir betpawaSessionStore.ts). */
export function setBetpawaSessionStore(s: SessionStore) { store = s; }

async function readSession(key: string): Promise<Cached | null> {
  // Copie mémoire récente (même exécution) : aucune lecture en base, ce qui
  // évitait les « Rate limit exceeded » quand plusieurs paris suivaient.
  const memHit = sessionCache.get(key);
  if (memHit && Date.now() - memHit.at < 5 * 60e3) return memHit;
  if (store) {
    // Base momentanément saturée : on réessaie, puis on ABANDONNE plutôt que de
    // se reconnecter à l'aveugle (chaque reconnexion déconnecte l'utilisateur).
    for (let i = 0; ; i++) {
      try {
        const fromDb = await store.get(key);
        if (fromDb) return fromDb;
        break;
      } catch (e) {
        // Base saturée : la copie mémoire de cette exécution suffit si elle existe.
        const mem = sessionCache.get(key);
        if (mem) return mem;
        if (i >= 4) throw new Error(`Session betPawa illisible pour l'instant — nouvel essai au prochain cycle [${String((e as Error)?.message || e).slice(0, 120)}]`);
        await new Promise((r) => setTimeout(r, 1200 * (i + 1) + Math.random() * 800));
      }
    }
  }
  return sessionCache.get(key) || null;
}

async function saveSession(key: string, value: { token: string; userUuid: string; country?: string; pwHash?: string }) {
  sessionCache.set(key, { ...value, at: Date.now() });
  if (store) await store.set(key, value).catch(() => null);
}

async function dropSession(key: string) {
  sessionCache.delete(key);
  if (store) await store.clear(key).catch(() => null);
}

/** Une tentative d'authentification sur UN site, avec UNE forme du numéro. */
async function tryAuthenticate(country: BetpawaCountry, username: string, password: string): Promise<
  | { ok: true; token: string; userUuid: string }
  | { ok: false; code: string; status: number; raw: string }
> {
  const res = await fetch(`https://${country.host}/api/user/v3/authenticate`, {
    method: "POST",
    headers: { ...headersFor(country), cookie: `bp_country=${country.iso}`, referer: `https://${country.host}/login` },
    body: JSON.stringify({ username, password, rememberMe: true }),
    signal: AbortSignal.timeout(20000),
  });
  const raw = await res.text();
  if (!res.ok) {
    let code = "";
    try { code = JSON.parse(raw)?.error || ""; } catch (_e) { /* ignore */ }
    return { ok: false, code: code || `HTTP ${res.status}`, status: res.status, raw };
  }
  const cookies = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? [res.headers.get("set-cookie") || ""];
  const token = cookies.join("; ").match(/x-pawa-token=([^;]+)/)?.[1]
    || cookies.join("; ").match(/x-pawa-token-secure=([^;]+)/)?.[1];
  let userUuid = "";
  try { userUuid = JSON.parse(raw).userUuid || ""; } catch (_e) { /* ignore */ }
  if (!token || !userUuid) return { ok: false, code: "no_token", status: res.status, raw };
  return { ok: true, token, userUuid };
}

/** Un refus qui prouve que le compte EXISTE sur ce site (verrouillage, blocage). */
const accountExistsError = (code: string) => /ATTEMPTS_EXCEEDED|TOO_MANY|THROTTL|RATE|BLOCKED|LOCKED|SUSPEND/i.test(code);

/**
 * Connexion betPawa : renvoie le jeton de session + le solde.
 *
 * ⚠️ Le pays NE PEUT PAS être devinté d'un numéro local : « 0166… » peut être
 * béninois, « 06… » congolais, et l'utilisateur saisit presque toujours son
 * numéro sans indicatif. On interroge donc les sites betPawa en parallèle avec
 * les formes possibles du numéro, et on retient celui qui ouvre la session.
 * Le pays trouvé est mémorisé avec le jeton : les connexions suivantes du même
 * numéro visent directement le bon site, sans balayage.
 */
export async function loginBetpawa(login: string, password: string): Promise<
  | { success: true; session: BetpawaSession }
  | { success: false; error: string; status?: number; detail?: string }
> {
  const withPrefix = betpawaCountryFromPrefix(login);
  const cacheKey = `betpawa:${cleanNumber(login)}`;
  const pwHash = await passwordHash(password);

  // ── 1. Session déjà ouverte pour ce numéro (et même mot de passe) ──
  const cached = await readSession(cacheKey);
  // Verrou betPawa en cours : toute nouvelle tentative le RELANÇAIT (≈4 essais
  // par compte et par verrou constatés le 01/10/2026). On attend qu'il expire.
  if (cached?.token === LOCK_MARK) {
    const left = LOCK_WAIT_MS - (Date.now() - cached.at);
    if (left > 0) return { success: false, error: `betPawa a temporairement verrouillé la connexion (trop de tentatives) — nouvel essai automatique dans ~${Math.ceil(left / 60000)} min, ne vous reconnectez pas d'ici là` };
    await dropSession(cacheKey);
  } else if (cached && Date.now() - cached.at < SESSION_TTL_MS && (!cached.pwHash || cached.pwHash === pwHash)) {
    const c = (cached.country && BETPAWA_BY_ISO[cached.country]) || withPrefix || DEFAULT_BETPAWA_COUNTRY;
    const funds = await fetchBetpawaFunds(cached.token, cached.userUuid, c).catch(() => null);
    if (funds) {
      return {
        success: true,
        session: {
          token: cached.token, userUuid: cached.userUuid,
          host: c.host, brand: c.brand, countryName: c.name,
          account: { login: localNumber(login, c), balance: funds.balance, currency: funds.currency, reference: cached.userUuid },
        },
      };
    }
    await dropSession(cacheKey);
  }

  // ── 2. Identification du pays ──
  // Numéro avec indicatif → un seul site. Numéro local → tous les sites, en
  // parallèle (chaque site ne connaît que ses propres comptes, donc au plus un
  // seul répond favorablement).
  // ⚠️ NE JAMAIS balayer tous les pays : betPawa compte les tentatives et
  // verrouillait le compte (« trop de tentatives ») après un seul essai de
  // l'utilisateur, puisque nous frappions 14 sites × 2 formes du numéro.
  // L'application fait maintenant choisir le pays (indicatif) à la saisie :
  // on n'interroge donc QUE le site de ce pays, et à défaut d'indicatif le
  // pays par défaut.
  const candidates = [withPrefix || DEFAULT_BETPAWA_COUNTRY];

  const attempts = await Promise.all(candidates.map(async (country) => {
    for (const username of numberForms(login, country)) {
      const r = await tryAuthenticate(country, username, password).catch(() => null);
      if (!r) continue;
      if (r.ok) return { country, username, res: r };
      // Compte reconnu mais connexion verrouillée/bloquée : inutile de continuer.
      if (accountExistsError(r.code)) return { country, username, res: r };
    }
    return null;
  }));

  const hit = attempts.find((a) => a && a.res.ok) as { country: BetpawaCountry; username: string; res: { ok: true; token: string; userUuid: string } } | undefined;
  if (!hit) {
    const locked = attempts.find((a) => a && !a.res.ok && accountExistsError((a.res as { code: string }).code));
    if (locked) {
      const r = locked.res as { code: string; status: number; raw: string };
      if (/ATTEMPTS_EXCEEDED|TOO_MANY|THROTTL|RATE/i.test(r.code)) await saveSession(cacheKey, { token: LOCK_MARK, userUuid: "", pwHash });
      return { success: false, error: loginErrorMessage(r.code), status: r.status, detail: r.raw.slice(0, 300) };
    }
    return {
      success: false,
      error: `Numéro ou mot de passe betPawa incorrect pour ${candidates[0].name} — vérifiez le pays sélectionné avant votre numéro`,
      status: 400,
      detail: `site betPawa ${candidates[0].host} : numéro/mot de passe refusé`,
    };
  }

  const { country, username } = hit;
  const { token, userUuid } = hit.res;
  const funds = await fetchBetpawaFunds(token, userUuid, country);
  await saveSession(cacheKey, { token, userUuid, country: country.iso, pwHash });

  return {
    success: true,
    session: {
      token, userUuid,
      host: country.host, brand: country.brand, countryName: country.name,
      account: {
        login: username,
        balance: funds ? funds.balance : null,
        currency: funds ? funds.currency : "XAF",
        reference: userUuid,
      },
    },
  };
}

/**
 * Liste les matchs betPawa (pré-match ou live) pour un sport donné.
 * categoryId : 2 = football, 3 = basketball, 5 = tennis (voir /api/sportsbook/v4/categories/list).
 */
export async function fetchBetpawaEvents(opts: {
  categoryId: string;
  live?: boolean;
  take?: number;
  skip?: number;
  host?: string;
}) {
  const country = BETPAWA_BY_HOST[opts.host || ""] || DEFAULT_BETPAWA_COUNTRY;
  const q = {
    queries: [{
      query: {
        eventType: opts.live ? "LIVE" : "UPCOMING",
        categories: [String(opts.categoryId)],
        hasOdds: true,
      },
      take: opts.take ?? 50,
      skip: opts.skip ?? 0,
    }],
  };
  const res = await fetch(
    `https://${country.host}/api/sportsbook/v4/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`,
    { headers: { ...headersFor(country), cookie: `bp_country=${country.iso}` }, signal: AbortSignal.timeout(25000) },
  );
  if (!res.ok) return { success: false as const, error: "events_failed", status: res.status };
  const data = await res.json().catch(() => null);
  const events = data?.responses?.[0]?.responses ?? [];
  return { success: true as const, events };
}

/** Détail d'un match : tous les marchés avec leurs sélections (selectionId + cote). */
export async function fetchBetpawaEvent(eventId: string | number, host?: string) {
  const country = BETPAWA_BY_HOST[host || ""] || DEFAULT_BETPAWA_COUNTRY;
  const res = await fetch(`https://${country.host}/api/sportsbook/v4/events/${eventId}`, {
    headers: { ...headersFor(country), cookie: `bp_country=${country.iso}` },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) return { success: false as const, error: "event_failed", status: res.status };
  return { success: true as const, event: await res.json() };
}

export interface BetpawaBetRequest {
  stake: number;
  selectionIds: string[];  // une sélection = pari simple
  price: number;           // cote lue juste avant placement
  acceptAnyPrice?: boolean;
  currency?: string;
}

// ── UN SEUL PARI À LA FOIS PAR COMPTE betPawa ──────────────────────────────
// betPawa refuse en CONCURRENT_BET_PLACEMENT dès que deux poses se chevauchent
// sur le même compte. Or la surveillance traite plusieurs opportunités en
// parallèle : une opportunité parfaitement valable était refusée uniquement
// parce qu'une autre pose était en cours. Les poses du même compte sont donc
// mises en file l'une derrière l'autre — l'attente est celle d'une pose (~1 s),
// bien moins coûteuse qu'un refus.
const betpawaQueue = new Map<string, Promise<unknown>>();

function queueByAccount<T>(token: string, task: () => Promise<T>): Promise<T> {
  const key = token.slice(-24) || "betpawa";
  const previous = betpawaQueue.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  // La file ne retient que la dernière pose : elle ne peut pas enfler.
  betpawaQueue.set(key, next.catch(() => {}));
  next.finally(() => { if (betpawaQueue.get(key) === next) betpawaQueue.delete(key); }).catch(() => {});
  return next;
}

/**
 * Place un pari simple sur betPawa avec un jeton de session déjà obtenu.
 * `host` = site du pays de la session (les identifiants de sélection, eux, sont
 * identiques d'un pays à l'autre — vérifié).
 */
export function placeBetpawaBet(token: string, bet: BetpawaBetRequest, host?: string) {
  return queueByAccount(token, () => placeBetpawaBetNow(token, bet, host));
}

async function placeBetpawaBetNow(token: string, bet: BetpawaBetRequest, host?: string) {
  const country = BETPAWA_BY_HOST[host || ""] || DEFAULT_BETPAWA_COUNTRY;

  const post = async (price: number) => {
    const requestUuid = crypto.randomUUID();
    const payload = {
      stake: bet.stake,
      stakeType: "STAKE",
      legs: [{ selectionIds: bet.selectionIds, price, type: "SINGLE" }],
      currency: bet.currency || "XAF",
      meta: {
        requestId: requestUuid,
        requestUuid,
        acceptAnyPrice: bet.acceptAnyPrice ?? false,
        cashoutable: true,
      },
    };
    const r = await fetch(`https://${country.host}/api/betslip/validator/v2/place-bet/real`, {
      method: "POST",
      headers: authHeaders(token, country),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000),
    });
    const text = await r.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch (_e) { /* garde le texte brut */ }
    return { r, body };
  };

  let { r: res, body: data } = await post(bet.price);

  // ── COTE MONTÉE ENTRE LA LECTURE ET LA POSE ─────────────────────────────
  // betPawa refuse en FOB_ODDS_CHANGED et renvoie LUI-MÊME la nouvelle cote.
  // C'était la cause de la quasi-totalité des « Refus du bookmaker » (174 sur
  // 200 relevés). Quand la nouvelle cote est ÉGALE OU MEILLEURE, la marge
  // d'arbitrage ne peut que s'améliorer : on repose immédiatement à ce prix.
  // Une cote plus basse est refusée : le gain garanti ne serait plus assuré.
  let appliedOdds = bet.price;
  if (!res.ok) {
    const changed = (data as any)?.error === "FOB_ODDS_CHANGED"
      ? Number((data as any)?.payload?.changedPrices?.[0]?.newPrice)
      : NaN;
    if (Number.isFinite(changed) && changed >= bet.price) {
      appliedOdds = changed;
      ({ r: res, body: data } = await post(changed));
    }
  }

  // ── SÉLECTION MOMENTANÉMENT HORS LIGNE (FOB_OFFLINE_PRICES) ─────────────
  // Cause n°1 des refus live relevée le 12/09/2026 (≈90 cas en une journée) :
  // betPawa répond « online:false, newPrice:0 » sur la sélection. Ce n'est PAS
  // un mauvais identifiant (il est bien reconnu) mais une suspension de
  // quelques secondes, le temps que le bookmaker revalide le direct — son flux
  // public n'expose aucun indicateur, on ne l'apprend donc qu'à la pose.
  // Comme AUCUNE mise n'est engagée dans ce cas et que betPawa est toujours
  // posé en PREMIER (jambe fragile), réessayer est sans risque : on retente
  // deux fois à 2,5 s d'intervalle, au même prix, avant d'abandonner.
  const isOfflineRefusal = () =>
    !res.ok && /FOB_OFFLINE_PRICES/i.test(String((data as any)?.error || ""));
  for (let retry = 0; retry < 2 && isOfflineRefusal(); retry++) {
    await new Promise((r) => setTimeout(r, 2500));
    ({ r: res, body: data } = await post(appliedOdds));
  }

  // ── REFUS EXPLICITE ────────────────────────────────────────────────────
  // « bet_failed » masquait le vrai motif : sur 159 refus live relevés, le code
  // réel était FOB_OFFLINE_PRICES (sélection hors ligne côté paris, alors que
  // le flux affichait encore sa cote). Sans ce détail, impossible de savoir
  // quoi corriger — le motif du bookmaker est donc remonté tel quel.
  if (!res.ok) {
    const code = String((data as any)?.error || (data as any)?.result?.error?.code || `HTTP ${res.status}`);
    const clair = /FOB_OFFLINE_PRICES/i.test(code)
      ? "betPawa : sélection hors ligne — le bookmaker refuse de la jouer (cote affichée mais non jouable)"
      : /NOT_ENOUGH_MONEY/i.test(code)
        ? "betPawa : solde insuffisant pour cette mise"
        : /CONCURRENT_BET_PLACEMENT/i.test(code)
          ? "betPawa n'accepte qu'un pari à la fois sur ce compte — tentative simultanée refusée"
          : /min_bet_amount/i.test(code)
            ? `betPawa exige une mise minimum de ${(data as any)?.result?.error?.payload?.minBetAmount ?? "?"}`
            : `betPawa a refusé le pari (${code})`;
    return { success: false, error: clair, status: res.status, detail: data };
  }

  // ── VALIDATION DIFFÉRÉE (paris live) ───────────────────────────────────
  // En live, betPawa ne confirme PAS tout de suite : il répond
  //   { placed:false, betslipUuid:"…", betslipId:null, betPlacementDelaySeconds:9 }
  // et valide le pari quelques secondes plus tard (délai anti-latence).
  // Sans interroger le statut, la réponse était lue comme « aucun numéro de
  // ticket » alors que le pari partait bel et bien → jambe crue refusée, l'autre
  // engagée seule : c'était la CAUSE des positions à découvert betPawa.
  const d = data as Record<string, any>;
  if (d && typeof d === "object" && d.placed !== true && !d.betslipId && d.betslipUuid) {
    const final = await waitBetpawaPlacement(token, String(d.betslipUuid), Number(d.betPlacementDelaySeconds) || 10, country);
    if (final.pending) {
      return { success: false, error: "betPawa n'a pas confirmé après le délai de validation live — statut non confirmé", status: res.status, detail: final.detail };
    }
    if (!final.placed) {
      const offline = /FOB_OFFLINE_PRICES/i.test(JSON.stringify(final.detail ?? ""));
      return {
        success: false,
        error: offline
          ? "betPawa : sélection hors ligne — le bookmaker refuse de la jouer (cote affichée mais non jouable)"
          : "betPawa a refusé le pari après validation live",
        status: res.status, detail: final.detail,
      };
    }
    return { success: true, status: res.status, ticket: final.detail, appliedOdds };
  }

  return { success: true, status: res.status, ticket: data, appliedOdds };
}

/**
 * Interroge le statut d'un pari en attente de validation jusqu'à ce que betPawa
 * tranche (accepté avec numéro de ticket, ou refusé).
 * Endpoint du site : GET /api/betslip/validator/v2/place-bet/status/{betslipUuid}
 */
async function waitBetpawaPlacement(
  token: string,
  betslipUuid: string,
  delaySeconds: number,
  country: BetpawaCountry,
): Promise<{ placed: boolean; pending?: boolean; detail: unknown }> {
  const deadline = Date.now() + Math.min(delaySeconds * 1000 + 15000, 40000);
  let last: unknown = null;
  await new Promise((r) => setTimeout(r, Math.min(delaySeconds * 1000, 12000)));

  while (Date.now() < deadline) {
    const r = await fetch(
      `https://${country.host}/api/betslip/validator/v2/place-bet/status/${betslipUuid}`,
      { headers: authHeaders(token, country), signal: AbortSignal.timeout(15000) },
    ).catch(() => null);

    if (r) {
      const raw = await r.text().catch(() => "");
      let body: any = raw;
      try { body = JSON.parse(raw); } catch (_e) { /* texte brut */ }
      last = body;
      if (body && typeof body === "object") {
        const id = body.betslipId ?? body.id ?? body.betslip?.id ?? null;
        if (r.ok && (body.placed === true || id)) return { placed: true, detail: body };
        // ⚠️ REFUS RENVOYÉ AVEC UN CODE HTTP D'ERREUR (incident du 14/09/2026).
        // Le statut ne répondait pas toujours 200 : sur les paris live refusés
        // pour sélection hors ligne, betPawa renvoie FOB_OFFLINE_PRICES avec un
        // HTTP 400. La réponse était alors ignorée (`r.ok` exigé), la tentative
        // classée « non confirmée » et l'utilisateur invité à vérifier à la main
        // un pari que betPawa avait pourtant CLAIREMENT refusé — sans qu'aucune
        // reprise ne soit tentée. Un motif de refus explicite est donc lu quel
        // que soit le code HTTP.
        const status = String(body.status || body.state || "").toUpperCase();
        if (/REJECT|REFUS|FAIL|CANCEL|DECLIN/.test(status) || body.rejectionReason || body.error) {
          return { placed: false, detail: body };
        }
      }
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  // Jamais tranché : on NE conclut PAS au refus (le pari peut être passé).
  return { placed: false, pending: true, detail: last };
}