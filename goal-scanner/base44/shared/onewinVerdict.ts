// ═══════════════════════════════════════════════════════════════════
// 1WIN — TRANCHER UNE RÉPONSE AMBIGUË PAR LE SOLDE.
//
// 1win renvoie parfois « selections_errors » alors que le pari EST enregistré
// (constaté le 15/09/2026), et parfois alors qu'il ne l'est pas. Traiter ce code
// en refus → double mise ; le traiter en ambigu → jambe adverse à découvert
// (cas réels du 15/09 : 850 F betPawa nus sur Persson - Voloshchuk, deux comptes).
//
// La passerelle n'expose ni historique ni numéro de ticket exploitable, mais le
// COMPTE, lui, ne ment pas : si la mise est partie, le solde a baissé d'autant.
// On relit donc le solde juste après la réponse douteuse :
//   • solde ≈ avant − mise  → le pari est passé : jambe confirmée ;
//   • solde inchangé        → rien n'est parti : refus DÉFINITIF → couverture ;
//   • autre / illisible     → on reste ambigu (aucune mise supplémentaire).
// ═══════════════════════════════════════════════════════════════════

import { getOnewinBalance } from "./onewinBetting.ts";

const TOLERANCE = 1; // arrondis de devise

export async function settleOnewinAmbiguity(
  cookies: string,
  balanceBefore: number | null | undefined,
  stake: number,
  ambiguous: Record<string, any>,
  readBalance: (c: string) => Promise<any> = getOnewinBalance,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<Record<string, any>> {
  if (!cookies || !Number.isFinite(Number(balanceBefore)) || !(stake > 0)) return ambiguous;
  const before = Number(balanceBefore);

  // Le débit peut mettre une à deux secondes à apparaître : trois lectures.
  let after: number | null = null;
  for (let i = 0; i < 3; i++) {
    if (i > 0) await sleep(1200);
    const b = await readBalance(cookies).catch(() => null);
    if (b?.success && Number.isFinite(Number(b.balance))) {
      after = Number(b.balance);
      if (Math.abs(before - stake - after) <= TOLERANCE) break; // débit vu
    }
  }
  if (after === null) return ambiguous;

  if (Math.abs(before - stake - after) <= TOLERANCE) {
    return {
      success: true,
      ticketId: `1win-solde-${Date.now()}`,
      verifiedByBalance: true,
      balanceBefore: before,
      balanceAfter: after,
      note: `1win : pari confirmé par le débit du compte (${before} → ${after})`,
      detail: ambiguous.detail,
    };
  }
  // ── MISE PARTIELLEMENT DÉBITÉE ⇒ LE PARI EST BIEN PARTI ────────────────
  // Constat du 17/09/2026 : 989 F demandés, 962 F réellement débités
  // (8685.32 → 7723.32). Aucune des deux égalités n'était vérifiée, le verdict
  // restait « douteux » — et la jambe betPawa était annoncée à découvert alors
  // que 1win l'avait bel et bien couverte. Un débit inférieur ou égal à la mise
  // demandée signifie que le pari est enregistré, au montant réellement accepté.
  const drop = before - after;
  if (drop > TOLERANCE && drop <= stake + TOLERANCE) {
    return {
      success: true,
      ticketId: `1win-solde-${Date.now()}`,
      verifiedByBalance: true,
      acceptedStake: drop,
      balanceBefore: before,
      balanceAfter: after,
      note: `1win : pari confirmé par le débit du compte — ${drop} F acceptés sur ${stake} F demandés (${before} → ${after})`,
      detail: ambiguous.detail,
    };
  }
  if (Math.abs(before - after) <= TOLERANCE) {
    return {
      success: false,
      definitive: true,
      code: ambiguous.code,
      error: `1win a refusé le pari (${ambiguous.code}) — solde inchangé (${after}), aucune mise 1win enregistrée`,
      balanceBefore: before,
      balanceAfter: after,
      detail: ambiguous.detail,
    };
  }
  return { ...ambiguous, balanceBefore: before, balanceAfter: after };
}