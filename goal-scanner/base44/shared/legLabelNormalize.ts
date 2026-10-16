// ═══════════════════════════════════════════════════════════════════
// NORMALISATION DES LIBELLÉS DE SÉLECTION (tous sports, tous bookmakers).
//
// Nos scanners écrivent les totaux avec un SIGNE : « +154.5 » = plus de,
// « −154.5 » = moins de. Ce n'est PAS une ligne négative.
//
// Chaque résolveur de bookmaker interprétait ce signe à sa façon :
//   • 1win  : « −154.5 » lu comme la ligne −154.5 → aucune cote ne correspond
//             → « sélection non identifiable » (cause réelle des opportunités
//               basket/tennis manquées).
//   • Apollo / betPawa : le signe « moins » typographique (−, U+2212) ne
//             correspondait à aucun de leurs motifs → marché « non reconnu ».
//
// On traduit donc le libellé UNE SEULE FOIS, avant tout résolveur, en langage
// explicite (« Plus de 154.5 » / « Moins de 154.5 »), et on remplace les tirets
// typographiques par le vrai signe moins. Les HANDICAPS sont préservés tels
// quels : là, le signe porte réellement la ligne (« J1 -2.5 »).
// ═══════════════════════════════════════════════════════════════════

/** Remplace −, –, — par le signe moins ASCII (comparaisons fiables partout). */
export function asciiSigns(s: unknown): string {
  return String(s ?? "").replace(/[\u2212\u2013\u2014]/g, "-");
}

const isTotalFamily = (family: string) => {
  const f = asciiSigns(family).toLowerCase();
  if (/handicap|spread/.test(f)) return false;
  return /total|over|under|plus de|moins de/.test(f);
};

/**
 * Libellé de jambe prêt à être compris par n'importe quel résolveur.
 * Marché de total : « +2.5 » → « Plus de 2.5 », « −2.5 » → « Moins de 2.5 ».
 * Tout le reste est renvoyé inchangé (hors normalisation des tirets).
 */
export function normalizeLegLabel(family: unknown, label: unknown): string {
  const raw = asciiSigns(label).trim();
  if (!raw) return raw;
  if (!isTotalFamily(String(family || ""))) return raw;

  const m = raw.match(/^([+-])\s*(\d+(?:[.,]\d+)?)$/);
  if (!m) return raw;
  const line = m[2].replace(",", ".");
  return `${m[1] === "+" ? "Plus de" : "Moins de"} ${line}`;
}