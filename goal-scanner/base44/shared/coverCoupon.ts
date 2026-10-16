// ═══════════════════════════════════════════════════════════════════
// IDENTIFIANTS DE SÉLECTION POUR UNE COUVERTURE DE REPLI.
//
// ⚠️ 18/09/2026 — POURQUOI CE FICHIER EXISTE. Le repli chez un autre bookmaker
// appelait le résolveur avec `coupon = null`. Or plusieurs résolveurs EXIGENT
// des identifiants natifs (1xBet : gameId + betType ; Congobet ; YellowBet) :
// le repli répondait donc invariablement « sélection introuvable (Identifiants
// de sélection 1xBet absents de l'opportunité) » — relevé sur les 4 découverts
// pré-match du 16/09/2026 : le rattrapage chez 1xBet ne pouvait PAS aboutir,
// quelle que soit la cote disponible.
//
// Deux sources d'identifiants, dans cet ordre :
//   1. le coupon déjà porté par l'opportunité pour ce bookmaker ET ce libellé ;
//   2. pour 1xBet uniquement, la dérivation déterministe (marché + libellé →
//      Type/Param), déjà validée sur 95 jambes réelles sans divergence.
//
// Prudence : aucune dérivation sur les marchés de mi-temps, de période (set,
// quart-temps) ou de statistique (corners, cartons…). Ces marchés vivent dans un
// SOUS-JEU 1xBet dont l'identifiant ne peut pas être devinné ici : mieux vaut
// renoncer au repli que couvrir la mauvaise sélection.
// ═══════════════════════════════════════════════════════════════════

import { deriveOnexbetSelection } from "./onexbetCouponDerive.ts";

const canon = (book: string): string => {
  const b = String(book || "").toLowerCase();
  return b === "1xbet_mobile" ? "1xbet" : b;
};

/** Marché vivant dans un sous-jeu 1xBet : aucune dérivation possible ici. */
const SUBGAME_MARKET =
  /(^\s*[12]\s*MT\b)|\b\d\s*(?:er|ere|ère|eme|ème|e)?\s*(?:set|quart|quart[-\s]?temps|periode|période|manche)\b|corner|carton|jaune|rouge|tir|faute|hors[-\s]?jeu|penalt|possession/i;

/**
 * Identifiants de sélection utilisables pour couvrir `label` chez `book`,
 * ou null quand on ne peut rien affirmer (le repli passe alors au book suivant).
 */
export function couponForCover(
  book: string,
  opp: Record<string, any>,
  label: string,
): Record<string, any> | null {
  const target = canon(book);
  const wanted = String(label || "").trim().toLowerCase();

  // 1) Coupon déjà présent dans l'opportunité, pour CE book et CE libellé.
  for (const k of ["a", "b"]) {
    const c = opp?.[`leg_${k}_coupon`];
    if (!c) continue;
    if (canon(String(c.book || "")) !== target) continue;
    if (String(opp?.[`leg_${k}_label`] || "").trim().toLowerCase() !== wanted) continue;
    return c;
  }

  // 2) Dérivation 1xBet (marché + libellé → Type/Param), marchés simples seulement.
  if (target === "1xbet" && opp?.onexbet_match_id && !SUBGAME_MARKET.test(String(opp?.market_family || ""))) {
    const sel = deriveOnexbetSelection(opp.market_family, label);
    if (sel) {
      return {
        book: "1xbet",
        gameId: String(opp.onexbet_match_id),
        kind: opp.is_live ? 1 : 3,
        betType: sel.betType,
        param: sel.param,
        price: 1,
        read_at: new Date().toISOString(),
      };
    }
  }

  return null;
}