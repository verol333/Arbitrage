// ═══════════════════════════════════════════════════════════════════
// COUVERTURE CHEZ UN AUTRE BOOKMAKER.
//
// Dernier recours quand une jambe est restée à découvert et que le bookmaker
// d'origine reste inaccessible (marché verrouillé, cote effondrée, refus
// répétés). Plutôt que de laisser la position nue, on cherche la MÊME sélection
// chez les autres bookmakers déjà connectés par l'utilisateur.
//
// Règle inchangée : on ne repose QUE si la position redevient sans perte. Mais
// la MISE est désormais recalculée sur la cote réelle du bookmaker de repli
// (voir hedgeStake.ts) : une cote différente n'est plus un abandon, c'est un
// montant à ajuster. Jamais de mise à l'aveugle, jamais d'aggravation.
// ═══════════════════════════════════════════════════════════════════

import { ADAPTERS } from "./autoBookAdapters.ts";
import { minStakeOf } from "./autoStakePlan.ts";
import { computeHedgeStake } from "./hedgeStake.ts";
import { couponForCover } from "./coverCoupon.ts";
import { isAmbiguousRefusal } from "./placementOrder.ts";
import { isBookLiveExcluded } from "./liveSuspend.ts";

/** Décodage des identifiants stockés (même format que le moteur de placement). */
import { openBlob } from "./credVault.ts";
const decodeCred = (blob: string) => openBlob(blob);

/** Books équivalents : ne jamais les considérer comme « un autre bookmaker ». */
const aliasesOf = (book: string): string[] =>
  book === "1xbet" || book === "1xbet_mobile" ? ["1xbet", "1xbet_mobile"] : [book];

export interface ElsewhereResult {
  covered: boolean;
  ambiguous?: boolean;
  book?: string;
  odds?: number;
  /** Mise réellement engagée (recalculée sur la cote du repli) */
  stake?: number;
  /** Total engagé sur l'opération après couverture */
  total?: number;
  /** Résultat du pire cas (négatif = perte plafonnée en mode sauvetage) */
  worstCase?: number;
  placement?: Record<string, unknown>;
  steps: string[];
}

/**
 * Tente de couvrir la jambe manquante chez un bookmaker différent.
 *
 * @param opp          opportunité d'origine
 * @param refusedBook  bookmaker qui a refusé (exclu des candidats)
 * @param engagedBook  bookmaker où la mise est déjà partie (exclu : il porte déjà l'autre côté)
 * @param label        libellé de la sélection à couvrir
 * @param engagedStake mise déjà partie sur la jambe acceptée
 * @param engagedOdd   cote de la jambe déjà partie
 * @param maxStakes    plafonds de mise configurés par l'utilisateur, par bookmaker
 * @param credentials  identifiants enregistrés du compte
 */
export async function coverElsewhere(opts: {
  opp: Record<string, any>;
  refusedBook: string;
  engagedBook: string;
  label: string;
  engagedStake: number;
  engagedOdd: number;
  maxStakes?: Record<string, number>;
  credentials: Record<string, string>;
  /** Mode SAUVETAGE : accepter une mise qui plafonne la perte (voir hedgeStake). */
  bestEffort?: boolean;
}): Promise<ElsewhereResult> {
  const { opp, refusedBook, engagedBook, label, engagedStake, engagedOdd, maxStakes = {}, credentials, bestEffort = false } = opts;
  const steps: string[] = [];

  const excluded = new Set(aliasesOf(refusedBook.toLowerCase()));
  // Le bookmaker qui porte DÉJÀ la jambe engagée était totalement écarté. C'est
  // pourtant lui qui propose presque toujours les DEUX côtés du même marché :
  // poser l'autre côté chez lui est une couverture parfaitement valable (constaté
  // le 15/09/2026 : betPawa affichait le côté manquant, et la position est restée
  // à découvert faute d'avoir essayé). On le garde donc en DERNIER recours.
  const engagedSet = new Set(aliasesOf(engagedBook.toLowerCase()));
  const seen = new Set<string>();
  const candidates = Object.keys(credentials || {})
    .map((k) => k.toLowerCase())
    .filter((k) => ADAPTERS[k] && !excluded.has(k))
    // Un book écarté du direct (1xBet, YellowBet) ne sert jamais de repli live.
    .filter((k) => !isBookLiveExcluded(k, opp?.is_live))
    .filter((k) => {
      const canon = aliasesOf(k)[0];
      if (seen.has(canon)) return false;
      seen.add(canon);
      return true;
    })
    .sort((a, b) => Number(engagedSet.has(a)) - Number(engagedSet.has(b)));

  if (!candidates.length) {
    steps.push("Aucun autre bookmaker connecté pour couvrir cette jambe");
    return { covered: false, steps };
  }

  for (const book of candidates) {
    const ad = ADAPTERS[book];
    const cred = credentials[book] ? decodeCred(credentials[book]) : null;
    if (!cred) continue;

    const conn: any = await ad.connect(cred).catch((e: any) => ({ ok: false, reason: String(e?.message || e) }));
    if (!conn?.ok) {
      steps.push(`Repli ${book} — connexion impossible (${conn?.reason || "inconnu"})`);
      continue;
    }

    const usable = conn.balance === null || conn.balance === undefined ? null : Math.floor(Number(conn.balance) * 0.95);
    if (usable === null || usable < minStakeOf(book)) {
      steps.push(`Repli ${book} — liquidité insuffisante (${usable ?? "solde illisible"})`);
      continue;
    }

    const fresh = await ad
      // Site du compte de repli : betPawa n'affiche pas les mêmes prix d'un pays
      // à l'autre, la cote doit être lue là où la mise partira.
      // `couponForCover` fournit les identifiants natifs exigés par certains
      // résolveurs (1xBet notamment) : sans eux, le repli échouait toujours sur
      // « sélection introuvable » — voir coverCoupon.ts.
      .resolve(opp, couponForCover(book, opp, label), opp[ad.matchIdField], label, { host: conn?.host })
      .catch((e: any) => ({ ok: false, reason: String(e?.message || e) }));
    if (!fresh?.ok) {
      steps.push(`Repli ${book} — sélection introuvable (${fresh?.reason || "illisible"})`);
      continue;
    }

    const odds = Number(fresh.odds);
    const hedge = computeHedgeStake({
      engagedStake, engagedOdd, coverOdds: odds,
      balance: usable, maxStake: Number(maxStakes[book]) || null,
      minStake: Math.max(Number(fresh.selection?.minStake) || 0, minStakeOf(book)),
      bestEffort,
    });
    if (!hedge.ok) {
      steps.push(`Repli ${book} — ${hedge.reason}`);
      continue;
    }

    const res = await ad.place(conn, fresh.selection, hedge.stake).catch((e: any) => ({ success: false, error: String(e?.message || e) }));
    if (res?.success) {
      steps.push(`Jambe couverte chez ${book} ✅ ${hedge.stake} F à la cote ${odds}${res.ticketId ? ` (ticket ${res.ticketId})` : ""}`);
      return { covered: true, book, odds, stake: hedge.stake, total: hedge.total, worstCase: hedge.worstCase, placement: res, steps };
    }
    steps.push(`Repli ${book} — refus (${res?.error || "inconnu"})`);
    if (res?.ambiguous || isAmbiguousRefusal(res?.error)) {
      steps.push("Repli non confirmé — aucun autre bookmaker sollicité avant vérification du ticket");
      return { covered: false, ambiguous: true, book, placement: res, stake: hedge.stake, odds, steps };
    }
  }

  return { covered: false, steps };
}