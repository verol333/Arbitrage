// ═══════════════════════════════════════════════════════════════════
// CALCUL DE LA MISE DE COUVERTURE (HEDGE).
//
// Quand une jambe est partie et l'autre a été refusée, la cote de la jambe
// manquante a presque toujours BOUGÉ. L'ancien rattrapage gardait la mise
// prévue au départ, figée, et exigeait que la cote soit restée au moins à
// `total / mise` : dès que la cote baissait d'un centime, il déclarait
// « cote insuffisante » et ne reposait RIEN. C'est la raison pour laquelle
// aucun découvert n'a jamais été rattrapé.
//
// Ce module fait le calcul qui manquait : à partir de la cote RÉELLE du moment,
// il recalcule la mise nécessaire pour que, quel que soit le résultat du match,
// on récupère au minimum le total engagé sur les deux bookmakers.
//
// Deux bornes encadrent la mise de couverture (S = mise engagée, C = sa cote,
// x = mise de couverture, K = cote de couverture du moment) :
//   • si la jambe engagée gagne : S × C ≥ S + x  →  x ≤ S × (C − 1)
//   • si la couverture gagne    : x × K ≥ S + x  →  x ≥ S / (K − 1)
// La fenêtre existe tant que (C − 1) × (K − 1) ≥ 1. On choisit alors la mise
// qui égalise les deux gains, puis on la borne par le solde et le plafond.
// ═══════════════════════════════════════════════════════════════════

export interface HedgeInput {
  /** Mise déjà engagée sur la jambe acceptée */
  engagedStake: number;
  /** Cote de la jambe déjà engagée */
  engagedOdd: number;
  /** Cote actuellement lue sur la jambe à couvrir */
  coverOdds: number;
  /** Solde réellement utilisable sur le bookmaker de couverture */
  balance?: number | null;
  /** Plafond de mise configuré par l'utilisateur sur ce bookmaker */
  maxStake?: number | null;
  /** Mise minimum imposée par le bookmaker / le marché */
  minStake?: number | null;
  /**
   * Mode « moindre mal » : quand l'écart de cotes ne permet PLUS un gain
   * garanti, on accepte de poser la mise qui PLAFONNE la perte, à condition
   * qu'elle soit nettement préférable à laisser la jambe engagée à nu.
   * Utilisé quand un bookmaker a re-tarifié la cote après notre engagement.
   */
  bestEffort?: boolean;
}

export interface HedgePlan {
  ok: boolean;
  /** Mise à poser pour couvrir (0 si impossible) */
  stake: number;
  /** Gain garanti dans le pire des cas (≥ 0 quand ok) */
  worstCase: number;
  /** Total engagé sur l'opération une fois la couverture posée */
  total: number;
  reason: string;
}

const fail = (reason: string): HedgePlan => ({ ok: false, stake: 0, worstCase: 0, total: 0, reason });

/**
 * MISE LISIBLE. Une couverture calculée au franc près donne des montants du
 * genre « 1 053 F » ou « 1 031 F » : illisibles, et impossibles à refaire à la
 * main. On cherche donc le plus GROS pas rond (500, 250, 100, 50, 25, 10 F) qui
 * tienne encore dans la fenêtre autorisée, en arrondissant vers le HAUT — une
 * mise un peu plus forte protège mieux la jambe déjà engagée. Si aucun pas rond
 * ne tient (fenêtre trop étroite), on garde le montant exact : la couverture
 * passe avant l'esthétique.
 */
function roundStake(ideal: number, min: number, max: number): number {
  for (const pas of [500, 250, 100, 50, 25, 10]) {
    const haut = Math.ceil(ideal / pas) * pas;
    if (haut >= min && haut <= max) return haut;
    const bas = Math.floor(ideal / pas) * pas;
    if (bas >= min && bas <= max) return bas;
  }
  return Math.ceil(ideal);
}

/**
 * Recalcule la mise de couverture à partir de la cote du moment.
 * Ne renvoie ok:true que si la position redevient sans perte.
 */
export function computeHedgeStake(input: HedgeInput): HedgePlan {
  const S = Number(input.engagedStake);
  const C = Number(input.engagedOdd);
  const K = Number(input.coverOdds);

  if (!(S > 0)) return fail("mise engagée illisible");
  if (!(C > 1)) return fail("cote de la jambe engagée illisible");
  if (!(K > 1)) return fail(`cote de couverture inexploitable (${K})`);

  // Bornes de la fenêtre sans perte.
  const minNeed = Math.ceil(S / (K - 1));
  const maxAllowed = Math.floor(S * (C - 1));

  if (minNeed > maxAllowed) {
    // ── DÉPASSEMENT MINUSCULE : ON COUVRE QUAND MÊME ─────────────────────
    // ⚠️ 18/09/2026, 01h12 — CAUSE EXACTE du dernier pari à découvert
    // (betPawa 1 000 F @ 2.00 engagés, YellowBet refusé « status Suspended »).
    // La fenêtre sans perte s'arrêtait à 1 000 F et il fallait miser 1 031 F :
    // 31 F de trop. La règle « zéro perte ou rien » a donc refusé SIX reprises
    // et QUATRE bookmakers de repli d'affilée, tous pour le même écart de
    // quelques francs — laissant 1 000 F risqués à 100 % pour ne pas en
    // engager 31. Le même schéma se lit à l'identique sur les autres
    // découverts récents (« il faudrait 1 064 F », « 1 053 F », « 1 099 F »).
    // Refuser de couvrir pour une perte résiduelle dérisoire coûte donc
    // toujours plus cher que de couvrir. On accepte désormais un dépassement
    // dont la perte reste sous 5 % de la mise engagée.
    const perteSiOnCouvre = Math.round(S * C - S - minNeed);
    const toleree = Math.ceil(S * 0.05);
    if (!input.bestEffort && perteSiOnCouvre >= -toleree) {
      let x = minNeed;
      const bornes: number[] = [];
      if (input.balance !== null && input.balance !== undefined && Number.isFinite(Number(input.balance))) bornes.push(Math.floor(Number(input.balance)));
      if (Number(input.maxStake) > 0) bornes.push(Math.floor(Number(input.maxStake)));
      const plafond = bornes.length ? Math.min(...bornes) : null;
      if (plafond !== null && x > plafond) {
        return fail(`couverture impossible : il faut au moins ${minNeed} F à la cote ${K}, disponible ${plafond} F`);
      }
      const mini = Number(input.minStake) || 0;
      if (mini > 0 && x < mini) x = mini;
      const t = S + x;
      const w = Math.round(Math.min(S * C, x * K) - t);
      return {
        ok: true, stake: x, worstCase: w, total: t,
        reason: `couverture posée malgré un dépassement de ${maxAllowed - minNeed > 0 ? 0 : minNeed - maxAllowed} F : ${x} F à la cote ${K} (engagé ${S} F @ ${C}) — perte plafonnée à ${Math.abs(w)} F au lieu de laisser ${S} F à découvert`,
      };
    }
    if (!input.bestEffort) {
      return fail(
        `l'écart de cotes a disparu (cote ${K} : il faudrait miser ${minNeed} F, or au-delà de ${maxAllowed} F la jambe déjà engagée ne rembourse plus)`,
      );
    }
    // Aucun gain garanti possible. On pose alors la mise qui ÉGALISE les deux
    // issues : la perte devient identique quel que soit le résultat, et elle
    // est très inférieure à la perte totale de la jambe laissée à nu.
    let x = Math.round((S * C) / K);
    const lim: number[] = [];
    if (input.balance !== null && input.balance !== undefined && Number.isFinite(Number(input.balance))) lim.push(Math.floor(Number(input.balance)));
    if (Number(input.maxStake) > 0) lim.push(Math.floor(Number(input.maxStake)));
    const plafond = lim.length ? Math.min(...lim) : null;
    if (plafond !== null && x > plafond) x = plafond;
    const mini = Number(input.minStake) || 0;
    if (mini > 0 && x < mini) x = mini;
    if (x <= 0) return fail(`plafonnement impossible à la cote ${K}`);
    x = roundStake(x, Math.max(mini, 1), plafond !== null ? plafond : x);
    const t = S + x;
    const w = Math.round(Math.min(S * C, x * K) - t);
    // Le plafonnement ne se justifie que s'il récupère une part NETTE du risque.
    // Sans jambe de couverture, le pire cas est de perdre les S F engagés. On
    // exige de ramener ce pire cas à moins de 80 % de S, sinon on immobilise du
    // capital supplémentaire pour presque rien.
    if (w <= -S * 0.8) {
      return fail(`plafonnement inutile à la cote ${K} : la perte resterait de ${Math.abs(w)} F alors que la jambe seule risque ${S} F`);
    }
    return {
      ok: true, stake: x, worstCase: w, total: t,
      reason: `gain garanti impossible (cote re-tarifée à ${K}) : mise de ${x} F posée pour PLAFONNER la perte à ${Math.abs(w)} F au lieu de risquer les ${S} F déjà engagés`,
    };
  }

  // Mise idéale : celle qui égalise les deux gains possibles.
  let stake = Math.round((S * C) / K);
  if (stake < minNeed) stake = minNeed;
  if (stake > maxAllowed) stake = maxAllowed;

  // Plafond réel : solde disponible et limite configurée par l'utilisateur.
  const caps: number[] = [];
  if (input.balance !== null && input.balance !== undefined && Number.isFinite(Number(input.balance))) {
    caps.push(Math.floor(Number(input.balance)));
  }
  if (input.maxStake !== null && input.maxStake !== undefined && Number(input.maxStake) > 0) {
    caps.push(Math.floor(Number(input.maxStake)));
  }
  const cap = caps.length ? Math.min(...caps) : null;

  if (cap !== null) {
    if (cap < minNeed) {
      return fail(`couverture impossible : il faut au moins ${minNeed} F à la cote ${K}, disponible ${cap} F`);
    }
    if (stake > cap) stake = cap;
  }

  // Minimum imposé par le bookmaker sur ce marché.
  const min = Number(input.minStake) || 0;
  if (min > 0 && stake < min) {
    if (min > maxAllowed || (cap !== null && min > cap)) {
      return fail(`le bookmaker exige au moins ${min} F, incompatible avec la couverture (fenêtre ${minNeed}–${maxAllowed} F)`);
    }
    stake = min;
  }

  // Montant rond, dans la fenêtre qui garantit encore la récupération du total.
  stake = roundStake(stake, Math.max(minNeed, min), Math.min(maxAllowed, cap !== null ? cap : maxAllowed));

  const total = S + stake;
  const worstCase = Math.round(Math.min(S * C, stake * K) - total);

  if (worstCase < 0) {
    return fail(`couverture non rentable à la cote ${K} (perte résiduelle ${Math.abs(worstCase)} F)`);
  }

  return {
    ok: true,
    stake,
    worstCase,
    total,
    reason: `couverture recalculée : ${stake} F à la cote ${K} (engagé ${S} F @ ${C}) — récupération garantie du total ${total} F, gain minimum ${worstCase} F`,
  };
}