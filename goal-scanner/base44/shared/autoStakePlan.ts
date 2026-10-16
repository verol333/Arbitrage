// ═══════════════════════════════════════════════════════════════════
// Répartition des mises pour un pari automatique, côté serveur.
//
// Règles :
//   • on part des SOLDES RÉELS lus sur chaque compte (jamais d'un théorique) ;
//   • chaque bookmaker impose sa propre MISE MINIMUM (Apollo = 300 F) ;
//   • aucune jambe ne dépasse son solde (réserve de 5 % conservée) ;
//   • si l'une des deux jambes ne peut pas atteindre son minimum, on ne place
//     RIEN — un seul pari posé = pari sec, donc risque réel.
// ═══════════════════════════════════════════════════════════════════

// Règle unique : 100 F de mise minimum partout, sauf Apollo qui exige 300 F.
// Tant qu'un compte dispose de son minimum, il reste dans la surveillance.
export const MIN_STAKE_BY_BOOK: Record<string, number> = {
  apollo: 300,
  congobet: 100,
  "1xbet": 100,
  "1xbet_mobile": 100,
  // 1win refuse toute mise sous 300 F (payload min_bet_amount : minBetAmount 300).
  // Tant que le plancher était à 100 F, le moteur calculait des jambes à 250 F
  // que 1win refusait APRÈS la pose de l'autre book → position à découvert
  // fabriquée par nous-mêmes (6 découverts, dont 3 le 15/09/2026 à 08h24).
  "1win": 300,
  betpawa: 100,
  betmomo: 100,
  sportybet: 100,
  premierbet: 100,
  yellowbet: 100,
};

export const RESERVE_PCT = 0.05;
export const MIN_PROFIT_PCT = 0.4;

// Mise plancher absolue : 100 F — un compte à 100 F reste jouable.
export const MIN_ABS_STAKE = 100;

export const minStakeOf = (book: string) =>
  Math.max(MIN_ABS_STAKE, MIN_STAKE_BY_BOOK[String(book).toLowerCase()] ?? 100);

export interface StakePlan {
  ok: boolean;
  code: string;
  reason: string;
  stakeA: number;
  stakeB: number;
  total: number;
  profitMin: number;
  profitMinPct: number;
  minA: number;
  minB: number;
}

/** Pas d'arrondi selon la taille de la mise (montants qu'un vrai parieur pose). */
function stepFor(amount: number): number {
  // Pas fins : un vrai parieur mise 250, 1 100, 1 200, 3 750… ce qu'on veut
  // éviter, ce sont les montants « calculés » du genre 466 ou 1 733.
  if (amount < 600) return 25;        // 125, 250, 375… — les tout petits soldes gardent une chance
  if (amount < 2000) return 50;       // 150, 250, 350… — pas fin pour petits soldes
  if (amount < 5000) return 100;      // 500, 600, 1200, 1900…
  if (amount < 20000) return 250;
  return 500;
}

/**
 * Cherche le meilleur couple de mises RONDES : profit garanti maximal, sans
 * dépasser les soldes ni le capital, en respectant les minimums des books.
 * Renvoie null si aucun couple rond ne reste rentable (on garde alors l'exact).
 */
function pickHumanCouple(
  { idealA, idealB, minA, minB, usableA, usableB, capital, oa, ob }:
  { idealA: number; idealB: number; minA: number; minB: number; usableA: number; usableB: number; capital: number; oa: number; ob: number },
): { stakeA: number; stakeB: number } | null {
  const cands = (ideal: number, min: number, usable: number) => {
    const step = stepFor(ideal);
    const base = Math.round(ideal / step) * step;
    const set = new Set<number>();
    for (let k = -6; k <= 6; k++) {
      const v = base + k * step;
      if (v >= min && v <= usable) set.add(v);
    }
    return [...set];
  };

  let best: { stakeA: number; stakeB: number; score: number } | null = null;
  for (const sA of cands(idealA, minA, usableA)) {
    for (const sB of cands(idealB, minB, usableB)) {
      const total = sA + sB;
      if (total > capital) continue;
      const profitMin = Math.min(sA * oa, sB * ob) - total;
      if (profitMin <= 0) continue;
      if ((profitMin / total) * 100 < MIN_PROFIT_PCT) continue;
      // On maximise le profit garanti, avec une légère préférence pour le
      // capital bien utilisé.
      const score = profitMin - 0.02 * (capital - total);
      if (!best || score > best.score) best = { stakeA: sA, stakeB: sB, score };
    }
  }
  return best ? { stakeA: best.stakeA, stakeB: best.stakeB } : null;
}

export function planStakes(
  { bookA, bookB, oddA, oddB, balanceA, balanceB, maxTotal, maxStakeA, maxStakeB, minStakeA, minStakeB }:
  { bookA: string; bookB: string; oddA: number; oddB: number; balanceA: number; balanceB: number; maxTotal?: number; maxStakeA?: number; maxStakeB?: number; minStakeA?: number; minStakeB?: number },
): StakePlan {
  // Minimum RÉEL du bookmaker quand il est connu (constaté sur un refus chiffré :
  // 1win exige 300 F, pas 100 F). Le respecter en amont évite d'envoyer une mise
  // que le bookmaker refusera — et donc de laisser l'autre jambe à découvert.
  const minA = Math.max(minStakeOf(bookA), Number(minStakeA) || 0);
  const minB = Math.max(minStakeOf(bookB), Number(minStakeB) || 0);
  const fail = (code: string, reason: string): StakePlan => ({
    ok: false, code, reason, stakeA: 0, stakeB: 0, total: 0, profitMin: 0, profitMinPct: 0, minA, minB,
  });

  const oa = Number(oddA), ob = Number(oddB);
  if (!(oa > 1) || !(ob > 1)) return fail("bad_odds", "Cotes invalides");
  const invSum = 1 / oa + 1 / ob;
  if (invSum >= 1) return fail("no_edge", "Plus d'arbitrage sur les cotes fraîches");

  let usableA = Math.floor(Number(balanceA || 0) * (1 - RESERVE_PCT));
  let usableB = Math.floor(Number(balanceB || 0) * (1 - RESERVE_PCT));

  // Plafond de mise choisi par l'utilisateur pour CE bookmaker : on ne met
  // jamais plus que ce montant sur son compte, même si le solde le permet.
  // 0 ou absent = pas de plafond (on utilise tout le solde disponible).
  if (maxStakeA && maxStakeA > 0) usableA = Math.min(usableA, Math.floor(maxStakeA));
  if (maxStakeB && maxStakeB > 0) usableB = Math.min(usableB, Math.floor(maxStakeB));

  if (usableA < minA) return fail("low_balance", `Mise ${bookA} plafonnée trop bas : ${usableA} F engageables, minimum ${minA} F`);
  if (usableB < minB) return fail("low_balance", `Mise ${bookB} plafonnée trop bas : ${usableB} F engageables, minimum ${minB} F`);

  const shareA = (1 / oa) / invSum;
  const shareB = (1 / ob) / invSum;

  // Capital maximal engageable : borné par les 2 soldes et, si fourni, par le
  // plafond de test demandé par l'utilisateur.
  let capital = Math.min(usableA / shareA, usableB / shareB);
  if (maxTotal && maxTotal > 0) capital = Math.min(capital, maxTotal);

  // Capital minimal pour que CHAQUE jambe atteigne le minimum de son book.
  const capitalMin = Math.max(minA / shareA, minB / shareB);
  if (capital < capitalMin) {
    return fail(
      "stake_too_small",
      `Il faut engager au moins ${Math.ceil(capitalMin)} F au total pour respecter les minimums (${bookA} ${minA} F / ${bookB} ${minB} F)`,
    );
  }

  // ── Mises « humaines » ──────────────────────────────────────────────
  // Un arbitrage exact donne des montants du genre 466 / 1 733 : c'est une
  // signature de calculateur, et c'est ainsi que les bookmakers repèrent les
  // arbitreurs. On cherche donc le meilleur couple de montants RONDS
  // (1 000 / 1 500 / 3 500…) qui reste un arbitrage garanti.
  const human = pickHumanCouple({
    idealA: capital * shareA, idealB: capital * shareB,
    minA, minB, usableA, usableB, capital, oa, ob,
  });

  // ⚠️ Aucun repli sur les montants exacts : un pari du genre 143 / 151 est
  // interdit. Si aucun couple rond ne reste rentable, on ne place rien.
  if (!human) {
    return fail(
      "no_round_stakes",
      `Soldes trop justes pour cette marge : avec ${usableA} F engageables sur ${bookA} et ${usableB} F sur ${bookB}, aucune répartition ne garantit un profit — rechargez pour saisir ce type d'occasion`,
    );
  }
  const { stakeA, stakeB } = human;
  if (stakeA > usableA || stakeB > usableB) return fail("over_balance", "Mise supérieure au solde disponible");

  const total = stakeA + stakeB;
  const profitMin = Math.min(stakeA * oa, stakeB * ob) - total;
  const profitMinPct = (profitMin / total) * 100;

  if (profitMin <= 0) return fail("no_profit", "Aucun profit garanti après arrondi aux minimums");
  if (profitMinPct < MIN_PROFIT_PCT) {
    return fail("thin_margin", `Marge trop mince (${profitMinPct.toFixed(2)} %) après arrondi aux minimums`);
  }

  return {
    ok: true, code: "ok", reason: "Mises validées",
    stakeA, stakeB, total,
    profitMin: Math.round(profitMin), profitMinPct, minA, minB,
  };
}