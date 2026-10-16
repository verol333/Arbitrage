// ═══════════════════════════════════════════════════════════════════
// 1XBET — résolution de la sélection à jouer, avec sa COTE FRAÎCHE.
//
// Les opportunités du scanner portent déjà les identifiants natifs 1xBet dans
// leg_x_coupon : { gameId, betType, param, kind }. On les revérifie dans le flux
// live/prématch juste avant de miser (une cote périmée = ErrorCode 104 côté
// 1xBet), et on renvoie le GameId réel qui porte la sélection — un marché de
// sous-jeu (corners, mi-temps…) ne vit pas sur le GameId principal.
// ═══════════════════════════════════════════════════════════════════

import { validateSelection } from "./xbetSelection.ts";
import { xbetMarketName, xbetSelectionName } from "./onexbetSelectionName.ts";
import { sameOpponents } from "./teamMatch.ts";

export interface OnexbetResolved {
  gameId: number;
  betType: number;
  param: number;
  kind: number;
  coef: number;
  live: boolean;
  /** Nom de marché, libellé, camp et ligne lisibles — lus par le contrôle de conformité (legAudit). */
  market: string;
  label: string;
  outcome: string;
  line: number | null;
}

export async function resolveOnexbetSelection(
  coupon: Record<string, any> | null,
  teams?: { home?: string; away?: string },
): Promise<
  | { ok: true; selection: OnexbetResolved }
  | { ok: false; code: string; reason: string }
> {
  const gameId = Number(coupon?.gameId);
  const betType = Number(coupon?.betType);
  // Coupon de mi-temps dont le sous-jeu n'a pas encore pu être lu : le GameId est
  // encore celui du match complet, donc jouer maintenant miserait sur le mauvais
  // marché. On refuse, le temps que la réparation le corrige.
  if (coupon?.half_pending) {
    return { ok: false, code: "half_pending", reason: "1xBet : marché de mi-temps en cours de rattachement — opportunité ignorée" };
  }
  if (!gameId || !betType) {
    return { ok: false, code: "no_selection_id", reason: "Identifiants de sélection 1xBet absents de l'opportunité" };
  }

  const kind = Number(coupon?.kind) || 3;
  const param = Number(coupon?.param) || 0;
  const check = await validateSelection({ gameId, betType, param, kind });

  if (!check.ok) {
    const human: Record<string, string> = {
      game_not_found: "match introuvable dans le flux 1xBet (terminé ou retiré)",
      selection_gone: "sélection retirée ou suspendue à l'instant",
      no_price: "cote absente du flux",
      missing_ids: "identifiants de sélection incomplets",
    };
    return {
      ok: false,
      code: check.reason || "selection_gone",
      reason: `1xBet : ${human[check.reason as string] || check.reason} — opportunité ignorée`,
    };
  }

  // ── IDENTITÉ DU MATCH ────────────────────────────────────────────────
  // Le GameId venait du scanner et n'était JAMAIS confronté aux équipes
  // affichées. Incident du 04/09/2026 : un pari de tennis en SIMPLE couvert par
  // un match de DOUBLE d'un autre tournoi (noms de joueurs proches) — les deux
  // jambes portaient sur deux matchs différents, donc perte au lieu de profit.
  // On vérifie donc que les adversaires lus chez 1xBet sont bien ceux de
  // l'opportunité ; au moindre désaccord, aucune mise ne part.
  const same = sameOpponents((check as any).o1, (check as any).o2, teams?.home, teams?.away);
  if (same === false) {
    return {
      ok: false,
      code: "wrong_fixture",
      reason: `1xBet : ce marché appartient à « ${(check as any).o1} vs ${(check as any).o2} », pas à « ${teams?.home} vs ${teams?.away} » — opportunité abandonnée (aucune mise engagée)`,
    };
  }

  const named = xbetSelectionName(betType, param, check);
  return {
    ok: true,
    selection: {
      gameId: check.gameId,
      betType,
      param,
      kind,
      coef: check.coef,
      // Kind 1 = évènement en direct → l'API attend live:true.
      live: kind === 1,
      market: xbetMarketName(check),
      label: named.label,
      outcome: named.outcome,
      line: param || null,
    },
  };
}