// ═══════════════════════════════════════════════════════════════════
// 1XBET — traduction des identifiants natifs (G = groupe de marché, T = type
// d'issue, P = paramètre) en NOM DE MARCHÉ et LIBELLÉ DE SÉLECTION lisibles.
//
// Sert UNIQUEMENT au contrôle de conformité (legAudit.ts) : jusqu'ici la
// sélection 1xBet ne portait que des numéros, donc le contrôle « même camp,
// même période, même statistique » ne pouvait rien vérifier et laissait passer
// n'importe quel identifiant. Les codes ci-dessous sont les codes standard
// 1xBet, stables d'un match à l'autre.
// ═══════════════════════════════════════════════════════════════════

const GROUP_NAMES: Record<number, string> = {
  1: "1X2",
  2: "Handicap",
  8: "Double chance",
  17: "Total",
  15: "Total équipe 1",
  62: "Total équipe 2",
  19: "Les deux équipes marquent",
};

export interface XbetContext {
  group?: number;
  subName?: string;
  period?: string;
  o1?: string;
  o2?: string;
}

/** Nom de marché : « Corners 1ère mi-temps Total » / « Handicap » / « G123 ». */
export function xbetMarketName(ctx: XbetContext): string {
  const g = Number(ctx.group) || 0;
  return [ctx.subName, ctx.period, GROUP_NAMES[g] || (g ? `G${g}` : "")]
    .map((s) => String(s || "").trim()).filter(Boolean).join(" ");
}

/**
 * Libellé + camp canonique d'une issue 1xBet. Camp vide pour un type inconnu :
 * le contrôle ne refuse alors rien sur le camp (jamais de faux refus).
 */
export function xbetSelectionName(betType: number, param: number, ctx: XbetContext): { label: string; outcome: string } {
  const o1 = ctx.o1 || "Équipe 1";
  const o2 = ctx.o2 || "Équipe 2";
  const p = Number.isFinite(param) ? String(param) : "";
  switch (Number(betType)) {
    case 1: return { label: o1, outcome: "1" };
    case 2: return { label: "Nul", outcome: "x" };
    case 3: return { label: o2, outcome: "2" };
    case 4: return { label: `${o1} ou Nul`, outcome: "1x" };
    case 5: return { label: `${o1} ou ${o2}`, outcome: "12" };
    case 6: return { label: `Nul ou ${o2}`, outcome: "x2" };
    case 7: return { label: `${o1} (${p})`, outcome: "1" };
    case 8: return { label: `${o2} (${p})`, outcome: "2" };
    case 9: return { label: `Plus de ${p}`, outcome: "over" };
    case 10: return { label: `Moins de ${p}`, outcome: "under" };
    case 11: return { label: `${o1} plus de ${p}`, outcome: "over" };
    case 12: return { label: `${o1} moins de ${p}`, outcome: "under" };
    case 13: return { label: `${o2} plus de ${p}`, outcome: "over" };
    case 14: return { label: `${o2} moins de ${p}`, outcome: "under" };
    case 180: return { label: "Oui", outcome: "yes" };
    case 181: return { label: "Non", outcome: "no" };
    default: return { label: "", outcome: "" };
  }
}