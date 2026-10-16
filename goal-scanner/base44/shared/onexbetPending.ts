// ═══════════════════════════════════════════════════════════════════
// 1xBET — VERDICT D'UN PARI MIS EN ATTENTE DE VALIDATION.
//
// En direct, MobileMakeBet ne confirme pas : il renvoie
//   { Value: { betGUID: "…", waitTime: 9 } }
// et 1xBet tranche quelques secondes plus tard.
//
// Sans relire ce verdict, TOUTES les mises live 1xBet ressortaient en
// « réponse non confirmée — vérifiez à la main », acceptées comme refusées :
// aucune reprise, aucune couverture, et un ticket réellement passé jamais
// enregistré chez nous.
//
// Point de lecture confirmé le 15/09/2026 (essais directs sur aio-sworl.com) :
//   GET /MobileLiveBetX/GetBets?betsGuid={guid}
//   → 200 [] tant que rien n'est tranché, puis un élément décrivant le pari.
//
// ⚠️ Une liste vide n'est JAMAIS lue comme un refus : tant que 1xBet n'a rien
// dit, le pari peut être passé. Dans ce cas on reste sur l'ambiguïté (gel), le
// comportement prudent d'origine.
// ═══════════════════════════════════════════════════════════════════

/** Numéro de ticket, quel que soit le nom employé par 1xBet. */
function ticketIdOf(entry: Record<string, any>): string | null {
  for (const k of ["Id", "id", "BetId", "betId", "Number", "number", "BetNumber", "CouponId"]) {
    const v = entry?.[k];
    if (v !== undefined && v !== null && String(v).trim() && Number(v) !== 0) return String(v);
  }
  return null;
}

/** Motif de refus explicitement énoncé par 1xBet dans le verdict. */
function refusalOf(entry: Record<string, any>): string | null {
  const code = Number(entry?.ErrorCode ?? entry?.errorCode) || 0;
  const msg = String(entry?.Error ?? entry?.error ?? entry?.Message ?? "").trim();
  const accepted = entry?.IsAccepted ?? entry?.isAccepted ?? entry?.Accepted;
  if (accepted === false) return msg || `1xBet a écarté le pari après validation${code ? ` (code ${code})` : ""}`;
  if (code > 0 || msg) return msg || `1xBet a refusé le pari (code ${code})`;
  return null;
}

export interface PendingVerdictResult {
  success: boolean;
  ambiguous?: boolean;
  ticketId?: string;
  appliedOdds?: number;
  acceptedStake?: number;
  error?: string;
  ticket?: unknown;
}

/**
 * Interroge 1xBet jusqu'à ce qu'il tranche.
 * `read` fait l'appel réseau (injecté pour rester testable et réutiliser le
 * contournement géographique déjà en place).
 */
export async function resolvePendingBet(
  guid: string,
  read: (guid: string) => Promise<{ status: number; json: any } | null>,
  waitSeconds = 0,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<PendingVerdictResult | null> {
  // 1xBet annonce lui-même son délai : on attend ce délai puis on relit.
  await sleep(Math.min(Math.max(waitSeconds, 2) * 1000, 12000));
  const deadline = now() + 25000;

  while (now() < deadline) {
    const res = await read(guid).catch(() => null);
    const list = Array.isArray(res?.json) ? res!.json : Array.isArray(res?.json?.Value) ? res!.json.Value : null;
    const entry = list && list.length ? (list[0] as Record<string, any>) : null;

    if (entry) {
      const id = ticketIdOf(entry);
      if (id) {
        const odds = Number(entry?.Coef ?? entry?.coef ?? entry?.Coupon?.Coef);
        const stake = Number(entry?.Summ ?? entry?.summ ?? entry?.Coupon?.Summ);
        return {
          success: true,
          ticketId: id,
          appliedOdds: Number.isFinite(odds) && odds > 1 ? odds : undefined,
          acceptedStake: Number.isFinite(stake) && stake > 0 ? stake : undefined,
          ticket: entry,
        };
      }
      const refus = refusalOf(entry);
      if (refus) return { success: false, error: `${refus} — rien n'est engagé, aucune mise 1xBet enregistrée`, ticket: entry };
    }
    await sleep(2500);
  }
  return null; // Jamais tranché : on garde le gel prudent de l'appelant.
}