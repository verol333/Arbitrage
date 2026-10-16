// ═══════════════════════════════════════════════════════════════════
// ÉCHELLE DE HANDICAP — modèle universel des issues « écart de buts ».
//
// Toute la famille Double Chance / Handicap européen / Handicap asiatique /
// 1X2 décrit LA MÊME grandeur : l'écart `d = buts domicile − buts extérieur`.
// On ramène donc chaque cote de chaque bookmaker à l'un de trois atomes :
//
//   O(t) : d >  t     U(t) : d <  t     E(t) : d == t
//
// Équivalences (vérifiées cote pour cote sur les flux) :
//   1 = O(0)   X = E(0)   2 = U(0)   1X = O(-1)   X2 = U(1)
//   HE 0:1 → 1=O(1)  X=E(1)  2=U(1)        (t = -handicap domicile)
//   HE 1:0 → 1=O(-1) X=E(-1) 2=U(-1)
//   HA -0.5 → 1=O(0), 2=U(1)  ·  HA -1.5 → 1=O(1), 2=U(2)
//
// Une couverture complète du match = une PARTITION de la droite des entiers.
// Avec ces atomes, toute partition s'écrit, pour a ≤ b :
//   U(a) + E(a) + E(a+1) + … + E(b) + O(b)
// a = b donne la combinaison à 3 jambes (la stratégie de base), a < b donne
// les variantes à 4, 5, 6 jambes. Aucune combinaison n'est privilégiée : le
// solveur les essaie toutes avec la meilleure cote de chaque atome, quel que
// soit le bookmaker (deux jambes chez le même book sont autorisées).
// ═══════════════════════════════════════════════════════════════════

export type Atom = string; // "O1" | "U-1" | "E0" …

export const O = (t: number): Atom => `O${t}`;
export const U = (t: number): Atom => `U${t}`;
export const E = (t: number): Atom => `E${t}`;

/** Libellé lisible d'un atome. */
export function atomLabel(a: Atom): string {
  const kind = a[0];
  const t = Number(a.slice(1));
  if (kind === "E") {
    if (t === 0) return "Nul (X)";
    return t > 0 ? `Domicile par exactement ${t}` : `Extérieur par exactement ${-t}`;
  }
  if (kind === "O") {
    if (t === 0) return "Domicile gagne (1)";
    if (t === -1) return "Domicile ou nul (1X)";
    if (t >= 1) return `Domicile par ${t + 1}+`;
    return `Extérieur par ${-t - 1} maximum, ou mieux`;
  }
  if (t === 0) return "Extérieur gagne (2)";
  if (t === 1) return "Nul ou extérieur (X2)";
  if (t <= -1) return `Extérieur par ${1 - t}+`;
  return `Domicile par ${t - 1} maximum, ou moins`;
}

export interface Priced { odds: number; book: string; market: string }
/** Meilleure cote par atome, tous bookmakers confondus. */
export type BestBoard = Record<Atom, Priced>;

/** Fusionne les cotes d'un bookmaker dans le tableau des meilleures cotes. */
export function mergeBook(board: BestBoard, book: string, odds: Record<Atom, { odds: number; market: string }>) {
  for (const [atom, v] of Object.entries(odds)) {
    if (!(v.odds > 1)) continue;
    const cur = board[atom];
    if (!cur || v.odds > cur.odds) board[atom] = { odds: v.odds, book, market: v.market };
  }
}

export interface Combo {
  profit_pct: number;
  legs: Array<{ atom: Atom; label: string; book: string; market: string; odds: number; stake_pct: number }>;
  books: string[];
  span: string;
}

/**
 * Essaie TOUTES les partitions U(a) + E(a..b) + O(b) réalisables et renvoie
 * les meilleures par marge décroissante.
 */
export function solveLadder(board: BestBoard, tMin = -5, tMax = 5): Combo[] {
  const out: Combo[] = [];
  for (let a = tMin; a <= tMax; a++) {
    if (!board[U(a)]) continue;
    for (let b = a; b <= tMax; b++) {
      const atoms: Atom[] = [U(a)];
      let ok = true;
      for (let t = a; t <= b; t++) {
        if (!board[E(t)]) { ok = false; break; }
        atoms.push(E(t));
      }
      if (!ok) break; // un atome central manque → inutile d'élargir b
      if (!board[O(b)]) continue;
      atoms.push(O(b));

      const inv = atoms.reduce((s, at) => s + 1 / board[at].odds, 0);
      out.push({
        profit_pct: Math.round((1 - inv) * 10000) / 100,
        legs: atoms.map((at) => ({
          atom: at,
          label: atomLabel(at),
          book: board[at].book,
          market: board[at].market,
          odds: board[at].odds,
          stake_pct: Math.round((1 / board[at].odds / inv) * 1000) / 10,
        })),
        books: [...new Set(atoms.map((at) => board[at].book))],
        span: `U(${a}) → O(${b})`,
      });
    }
  }
  return out.sort((x, y) => y.profit_pct - x.profit_pct);
}