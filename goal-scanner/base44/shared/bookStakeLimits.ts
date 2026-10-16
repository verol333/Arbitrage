// ═══════════════════════════════════════════════════════════════════
// LIMITES DE MISE RÉELLES PAR BOOKMAKER ET PAR MARCHÉ.
//
// Pourquoi ce module existe (incident du 14/09/2026) :
// un bookmaker n'annonce NULLE PART, dans son flux de cotes, la mise maximum
// qu'il acceptera sur un marché. On le découvrait donc au pire moment : la
// première jambe était déjà engagée (101 500 F sur 1win) quand 1xBet répondait
// « La mise maximum est 19 100 ₣ ». Même chose à l'autre bout : 1win refusait
// une couverture de 250 F parce que son minimum réel est 300 F.
//
// Le bookmaker dit donc la vérité, mais seulement dans son refus. On la retient
// ici — par bookmaker, par marché et selon direct / pré-match — et on l'applique
// AVANT de calculer les mises : plus aucune mise n'est envoyée au-delà de ce que
// le bookmaker a déjà déclaré accepter, ni en dessous de son minimum.
//
// Mémoire d'une journée : ces limites bougent (fin de match, liquidité), mais
// pas d'une minute à l'autre.
// ═══════════════════════════════════════════════════════════════════

export interface StakeLimits {
  /** Mise maximum constatée (0 = inconnue, donc aucune contrainte). */
  max: number;
  /** Mise minimum constatée (0 = inconnue). */
  min: number;
  at: number;
  source?: string;
}

export interface StakeLimitsStore {
  get(key: string): Promise<StakeLimits | null>;
  set(key: string, value: StakeLimits & { book: string; market: string; isLive: boolean }): Promise<void>;
}

const TTL_MS = 24 * 60 * 60 * 1000;
const mem = new Map<string, StakeLimits>();
let store: StakeLimitsStore | null = null;

/** Branche la mémoire persistante (à appeler en début de fonction serveur). */
export function setStakeLimitsStore(s: StakeLimitsStore | null) { store = s; }

const normMarket = (m: unknown) =>
  String(m ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim() || "?";

export const limitKey = (book: string, market: unknown, isLive: boolean) =>
  `${String(book || "").toLowerCase()}|${normMarket(market)}|${isLive ? "live" : "pre"}`;

const EMPTY: StakeLimits = { max: 0, min: 0, at: 0 };

// Un PLAFOND dépend du marché et de la sélection (liquidité) : il reste rangé
// par marché. Un PLANCHER, lui, est une règle du bookmaker : 1win exige 300 F
// partout. Rangé par marché, le plancher devait être re-appris marché après
// marché — et chaque leçon coûtait une position à découvert. Il est donc AUSSI
// mémorisé au niveau du bookmaker, sous ce marché fictif.
const BOOK_WIDE = "*";

/** Limites connues pour ce bookmaker sur ce marché (jamais d'erreur remontée). */
async function readOne(key: string): Promise<StakeLimits> {
  const cached = mem.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached;
  if (store) {
    const row = await store.get(key).catch(() => null);
    if (row && Date.now() - row.at < TTL_MS) { mem.set(key, row); return row; }
  }
  return EMPTY;
}

export async function readStakeLimits(book: string, market: unknown, isLive: boolean): Promise<StakeLimits> {
  const [own, wide] = await Promise.all([
    readOne(limitKey(book, market, isLive)),
    readOne(limitKey(book, BOOK_WIDE, isLive)),
  ]);
  // Plancher : le plus exigeant des deux (règle du book ou refus sur ce marché).
  // Plafond : uniquement celui du marché — le plafond d'un marché ne dit rien
  // du plafond d'un autre.
  return { ...own, min: Math.max(own.min, wide.min) };
}

/**
 * Enregistre une limite RÉELLEMENT observée.
 * On garde le plafond le plus bas et le plancher le plus haut : ce sont les
 * seuls chiffres que le bookmaker a effectivement refusés de dépasser.
 */
export async function learnStakeLimit(
  book: string, market: unknown, isLive: boolean,
  patch: { max?: number; min?: number; source?: string },
): Promise<StakeLimits> {
  const key = limitKey(book, market, isLive);
  const prev = mem.get(key) || (store ? await store.get(key).catch(() => null) : null) || EMPTY;
  const max = Number(patch.max) > 0
    ? (prev.max > 0 ? Math.min(prev.max, Math.floor(Number(patch.max))) : Math.floor(Number(patch.max)))
    : prev.max;
  const min = Number(patch.min) > 0 ? Math.max(prev.min, Math.ceil(Number(patch.min))) : prev.min;
  const next: StakeLimits = { max, min, at: Date.now(), source: patch.source || prev.source };
  mem.set(key, next);
  if (store) {
    await store.set(key, { ...next, book: String(book || "").toLowerCase(), market: normMarket(market), isLive: !!isLive })
      .catch(() => null);
  }
  return next;
}

/** Plafond chiffré par le bookmaker dans son refus (« La mise maximum est 19100 ₣ »). */
export function parseMaxStake(error: unknown): number | null {
  const t = String(error ?? "");
  const m = t.match(/(?:mise maximum est|maximum autoris[^\d]{0,20}|max(?:imum)?[^\d]{0,10})([\d\s.,]{2,15})/i);
  if (!m) return null;
  const n = Number(String(m[1]).replace(/[\s.,](?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** Plancher chiffré par le bookmaker (« mise sous le minimum autorisé (300 min) »). */
export function parseMinStake(error: unknown): number | null {
  const t = String(error ?? "");
  const m = t.match(/(?:mise minimum est|minimum autoris[^\d]{0,20}|min(?:imum)?[^\d]{0,10})([\d\s.,]{2,15})/i);
  if (!m) return null;
  const n = Number(String(m[1]).replace(/[\s.,](?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

/** Retient ce qu'un refus chiffré nous apprend. Renvoie ce qui a été appris. */
export async function learnFromRefusal(
  book: string, market: unknown, isLive: boolean, error: unknown,
): Promise<{ max: number | null; min: number | null }> {
  const max = parseMaxStake(error);
  const min = parseMinStake(error);
  // « minimum 300 » et « maximum 300 » se ressemblent : on ne retient un
  // plafond que si le refus ne parle pas de minimum, et l'inverse.
  const t = String(error ?? "").toLowerCase();
  const saysMin = /minimum|min\b|sous le/.test(t);
  const saysMax = /maximum|max\b|au-dessus/.test(t);
  const learnedMax = saysMax && !saysMin ? max : null;
  const learnedMin = saysMin && !saysMax ? min : null;
  const source = `refus chiffré du bookmaker : ${String(error ?? "").slice(0, 120)}`;
  if (learnedMax || learnedMin) {
    await learnStakeLimit(book, market, isLive, { max: learnedMax || 0, min: learnedMin || 0, source });
  }
  // Le plancher est une règle du bookmaker : appris une fois, il protège TOUS
  // les marchés dès la mise suivante, au lieu d'être re-payé marché par marché.
  if (learnedMin) {
    await learnStakeLimit(book, BOOK_WIDE, isLive, { min: learnedMin, source });
  }
  return { max: learnedMax, min: learnedMin };
}

/** Une mise partiellement acceptée EST le plafond du marché à cet instant. */
export async function learnFromPartial(
  book: string, market: unknown, isLive: boolean, requested: number, accepted: number,
): Promise<number | null> {
  const req = Number(requested) || 0;
  const acc = Number(accepted) || 0;
  if (!(acc > 0) || !(req > acc)) return null;
  await learnStakeLimit(book, market, isLive, { max: acc, source: "mise partiellement acceptée par le bookmaker" });
  return acc;
}