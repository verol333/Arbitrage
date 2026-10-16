// ═══════════════════════════════════════════════════════════════════
// DERNIÈRE LECTURE DU SOLDE, JUSTE AVANT D'ENGAGER LE PREMIER FRANC.
//
// POURQUOI CE FICHIER EXISTE (incidents du 15-16/09/2026).
// Le solde était bien lu — mais UNE SEULE FOIS, à la connexion, en début de
// cycle. Entre cette lecture et la pose, il s'écoule plusieurs secondes à
// plusieurs minutes : une autre mise du même compte est partie entre-temps, ou
// le bookmaker a bloqué des fonds. Résultat mesuré : « 1win : fonds
// insuffisants » alors que le solde annoncé au départ couvrait largement la
// mise — et la jambe adverse (3 400 F sur betPawa) restait nue.
//
// RÈGLE : avant la première pose, on redemande au bookmaker ce qu'il a
// RÉELLEMENT sur le compte. Un solde qui ne couvre plus sa mise annule tout le
// pari : zéro franc engagé, zéro position à découvert.
//
// Un solde ILLISIBLE (coupure réseau, 500 du bookmaker) ne bloque PAS : on
// n'invente pas un compte vide à partir d'un incident réseau. C'est simplement
// tracé dans le déroulé.
// ═══════════════════════════════════════════════════════════════════

export interface BalanceCheck {
  ok: boolean;
  steps: string[];
  reason?: string;
  books?: string[];
}

/**
 * Relit le solde de chaque jambe qui sait le faire et vérifie qu'il couvre la
 * mise prévue. `ok: false` = au moins un compte ne peut plus payer sa jambe.
 */
export async function verifyBalancesBeforePlacing(
  legs: Array<{ book: string; ad: any; conn: any; stake: number }>,
): Promise<BalanceCheck> {
  const steps: string[] = [];
  const short: string[] = [];

  const reads = await Promise.all(legs.map(async (l) => {
    if (typeof l.ad?.readBalance !== "function" || !(Number(l.stake) > 0)) return null;
    const bal = await l.ad.readBalance(l.conn).catch((e: any) => new Error(String(e?.message || e)));
    if (bal instanceof Error) return { book: l.book, stake: Number(l.stake), balance: null, dead: bal.message };
    return { book: l.book, stake: Number(l.stake), balance: bal === null || bal === undefined ? null : Number(bal) };
  }));

  for (const r of reads) {
    if (!r) continue;
    // Compte injoignable pour cause d'authentification : ce bookmaker ne
    // prendra pas le pari. On annule TOUT avant d'engager le premier franc.
    if ((r as any).dead) {
      short.push(`${r.book} : ${(r as any).dead}`);
      continue;
    }
    if (r.balance === null || !Number.isFinite(r.balance)) {
      steps.push(`${r.book} : solde illisible au dernier contrôle — pose menée sur le solde lu à la connexion`);
      continue;
    }
    // Le compte doit couvrir sa mise, plus une marge de sécurité de 1 % pour
    // les arrondis et les frais que certains bookmakers appliquent à la pose.
    const needed = Math.ceil(r.stake * 1.01);
    if (r.balance < needed) {
      short.push(`${r.book} n'a plus que ${Math.floor(r.balance)} F pour une mise de ${r.stake} F`);
    } else {
      steps.push(`${r.book} : solde relu juste avant la pose — ${Math.floor(r.balance)} F disponibles pour ${r.stake} F ✅`);
    }
  }

  if (short.length) {
    return {
      ok: false,
      steps,
      books: reads.filter((r) => r && short.some((s) => s.startsWith(r.book))).map((r) => r!.book),
      reason: `${short.join(" · ")} — contrôle fait juste avant la pose : pari annulé AVANT toute mise, aucune position à découvert`,
    };
  }
  return { ok: true, steps };
}