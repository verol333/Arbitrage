// ═══════════════════════════════════════════════════════════════════
// MÉMOIRE COURTE DES SÉLECTIONS NON JOUABLES EN LIVE.
//
// CONSTAT MESURÉ le 07/09/2026 sur les 250 dernières tentatives LIVE :
//   • 0 pari réussi ;
//   • 160 tentatives mortes à la pose, dont 159 sur un refus betPawa ;
//   • le refus réel derrière le « bet_failed » générique est
//     FOB_OFFLINE_PRICES { online: false, newPrice: 0 } — la sélection est
//     affichée dans le flux AVEC sa cote (1.59) mais betPawa refuse de la
//     jouer : elle est hors ligne côté paris.
//   • le MÊME identifiant de sélection (1540218830) revient dans plusieurs
//     tentatives : on rejouait indéfiniment une sélection condamnée, à
//     27 s de médiane par tentative.
//
// Rien dans le flux ne permet de le savoir à l'avance : `suspended` n'est
// présent que lorsque la cote est déjà tombée à 0. Le seul signal fiable est
// le refus du bookmaker lui-même. On le mémorise donc : une sélection qui
// vient d'être déclarée hors ligne est écartée pendant quelques minutes, et
// le temps de surveillance repart vers les opportunités réellement jouables.
//
// Mémoire volontairement locale et courte : aucune écriture en base (le
// placement live ne peut pas s'offrir un aller-retour de plus), et une
// sélection remise en ligne par le bookmaker redevient jouable d'elle-même.
// ═══════════════════════════════════════════════════════════════════

/**
 * Durée pendant laquelle une sélection déclarée hors ligne est écartée.
 *
 * ⚠️ RAMENÉE DE 4 MIN À 40 S le 12/09/2026. Mesuré sur les 400 dernières
 * tentatives réelles : 56 opportunités valides ont été abandonnées d'office par
 * cette mémoire, contre 49 refus réellement constatés — le garde-fou coûtait
 * plus que le refus qu'il évitait. betPawa remet une sélection en ligne en
 * quelques secondes : 40 s suffisent à ne pas la rejouer en boucle immédiate,
 * sans condamner le marché pour le reste de la mi-temps.
 */
export const OFFLINE_TTL_MS = 40 * 1000;

const offline = new Map<string, number>();
const MAX_ENTRIES = 500;

const keyOf = (book: string, selectionId: unknown) =>
  `${String(book || "").toLowerCase()}|${String(selectionId ?? "")}`;

/**
 * Le bookmaker vient de refuser cette sélection parce qu'elle n'est pas
 * jouable (hors ligne, suspendue, marché verrouillé). On la met de côté.
 */
export function markOffline(book: string, selectionId: unknown): void {
  if (selectionId === null || selectionId === undefined || selectionId === "") return;
  offline.set(keyOf(book, selectionId), Date.now());
  if (offline.size > MAX_ENTRIES) {
    const oldest = [...offline.entries()].sort((a, b) => a[1] - b[1]);
    for (const [k] of oldest.slice(0, offline.size - MAX_ENTRIES)) offline.delete(k);
  }
}

/** Cette sélection a-t-elle été déclarée injouable il y a peu ? */
export function isOffline(book: string, selectionId: unknown): boolean {
  if (selectionId === null || selectionId === undefined || selectionId === "") return false;
  const at = offline.get(keyOf(book, selectionId));
  if (!at) return false;
  if (Date.now() - at > OFFLINE_TTL_MS) {
    offline.delete(keyOf(book, selectionId));
    return false;
  }
  return true;
}

/**
 * Le refus du bookmaker signifie-t-il « cette sélection n'est pas jouable » ?
 * Codes relevés dans les journaux réels : FOB_OFFLINE_PRICES (betPawa),
 * marché verrouillé / suspendu chez les autres books.
 */
export function isUnplayableRefusal(error: unknown, detail?: unknown): boolean {
  const t = `${String(error ?? "")} ${typeof detail === "object" && detail ? JSON.stringify(detail) : String(detail ?? "")}`.toLowerCase();
  if (!t.trim()) return false;
  // `selections_errors` (1win) = sélection refusée par son validateur : elle
  // reste refusée plusieurs minutes, il est inutile de la rejouer en boucle
  // (6 reprises identiques constatées le 17/09/2026 sur un même découvert).
  return /offline_prices|offline|suspend|market_closed|marche ferme|verrouill|locked|not_available|unavailable|selection_gone|selections?_?errors?|price_changed_to_zero/.test(t);
}

/** Remise à zéro — utilisée par les simulations. */
export function resetOfflineMemory(): void {
  offline.clear();
}