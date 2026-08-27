// Marches STATISTIQUES (corners, cartons, fautes, tirs...) : espace d'issues propre.
// Un corner n'est PAS un but. Ces marches sont inexprimables sur la grille de
// buts : les melanger fabrique de faux arbitrages ("Under 1.5 corners MT1"
// n'exclut aucun score). On leur donne donc leur PROPRE grille (sh, sa) =
// statistique domicile / exterieur, et un DOMAINE par (famille, periode).
// L'arbitrage n'est cherche qu'entre jambes du MEME domaine : c'est valide.

export const SG = 13;                  // 0..12 par equipe et par periode
export const STAT_CELLS = SG * SG;
export const STAT_FULL_MASK = (1n << BigInt(STAT_CELLS)) - 1n;

const FAMILIES = [
  ['CORNERS',  /corner/],
  ['CARDS',    /carton|\bcards?\b|booking/],
  ['FOULS',    /faute|foul/],
  ['OFFSIDES', /hors-?jeu|offside/],
  ['THROWINS', /touche|throw-?in/],
  ['SHOTS_ON', /tirs? cadr|shots? on target/],
  ['SHOTS',    /\btirs?\b|\bshots?\b/],
];

// Vrai des que le libelle parle d'une statistique et non de buts.
export function statFamily(market) {
  const m = String(market).toLowerCase();
  for (const [key, re] of FAMILIES) if (re.test(m)) return key;
  return null;
}

function scopeOf(m) {
  if (/1st half|1[eè]re mi-?temps|premi[eè]re mi-?temps|\b1h\b/.test(m)) return 'H1';
  if (/2nd half|2[eè]me mi-?temps|deuxi[eè]me mi-?temps|\b2h\b/.test(m)) return 'H2';
  return 'FT';
}

function trailingLine(txt) {
  const m = String(txt).match(/([+-]?\d+(?:[.,]\d+)?)\s*\)?\s*$/);
  return m ? parseFloat(m[1].replace(',', '.')) : NaN;
}

// Equipe visee. null si ambigu : une attribution par defaut inverserait les
// equipes et fabriquerait de faux arbitrages.
function teamSide(m, homeNamed, awayNamed) {
  if (/\b(?:equipe|[eé]quipe|team)\s*1\b|home team|domicile/.test(m)) return 'home';
  if (/\b(?:equipe|[eé]quipe|team)\s*2\b|away team|ext[eé]rieur/.test(m)) return 'away';
  if (homeNamed && !awayNamed) return 'home';
  if (awayNamed && !homeNamed) return 'away';
  return null;
}

// Retourne { domain, pred(sh, sa) } ou null si le marche n'est pas lisible.
export function classifyStatOutcome({ market, selection, homeNamed, awayNamed }) {
  const family = statFamily(market);
  if (!family) return null;
  const m = String(market).toLowerCase();
  const s = String(selection).toLowerCase().trim();
  const domain = family + '_' + scopeOf(m);
  const side = teamSide(m, homeNamed, awayNamed);
  // "total" d'une equipe nommee = statistique de cette equipe seule.
  const scoped = Boolean(side) && /total|nombre/.test(m);
  const pack = pred => (pred ? { domain, pred } : null);

  // ─ Total (global ou par equipe) ─
  if (/total|nombre de|number of|over\/under|o\/u/.test(m) || /^(?:over|under|plus|moins|\+|-)/.test(s)) {
    const line = trailingLine(s.replace(/^[^0-9+-]*/, '') || s);
    if (isNaN(line)) return null;
    if (Number.isInteger(line)) return null;            // ligne entiere = remboursement possible
    if (Math.abs(line) % 0.5 > 0.01) return null;        // quart de ligne : demi-gain
    const over = /over|plus|\+|>/.test(s);
    const under = /under|moins|</.test(s);
    if (over === under) return null;
    const val = scoped
      ? (side === 'home' ? (sh, sa) => sh : (sh, sa) => sa)
      : (sh, sa) => sh + sa;
    return pack(over ? (sh, sa) => val(sh, sa) > line : (sh, sa) => val(sh, sa) < line);
  }

  // ─ Pair / impair ─
  if (/pair|impair|odd|even/.test(m) || /^(?:pair|impair|odd|even)$/.test(s)) {
    const tot = scoped
      ? (side === 'home' ? (sh, sa) => sh : (sh, sa) => sa)
      : (sh, sa) => sh + sa;
    if (/impair|\bodd\b/.test(s)) return pack((sh, sa) => tot(sh, sa) % 2 === 1);
    if (/pair|\beven\b/.test(s)) return pack((sh, sa) => tot(sh, sa) % 2 === 0);
    return null;
  }

  // ─ Handicap (sur la statistique) ─
  if (/handicap/.test(m)) {
    const line = trailingLine(m) ?? NaN;
    if (isNaN(line) || Math.abs(line) % 0.5 > 0.01 || Number.isInteger(line)) return null;
    if (/^1\b|^home|^domicile/.test(s)) return pack((sh, sa) => sh + line > sa);
    if (/^2\b|^away|^ext/.test(s)) return pack((sh, sa) => sa - line > sh);
    return null;
  }

  // ─ 1X2 : quelle equipe en obtient le plus ─
  if (/1x2|r[eé]sultat|result|winner|vainqueur|le plus|most|more/.test(m)) {
    if (/^1\b|^home|^domicile/.test(s)) return pack((sh, sa) => sh > sa);
    if (/^x\b|^nul|^draw|^[eé]galit/.test(s)) return pack((sh, sa) => sh === sa);
    if (/^2\b|^away|^ext/.test(s)) return pack((sh, sa) => sa > sh);
    return null;
  }

  return null;
}

// Grille (sh, sa) → bitmask sur STAT_CELLS bits.
export function statMask(pred) {
  let m = 0n;
  for (let sh = 0; sh < SG; sh++) for (let sa = 0; sa < SG; sa++) {
    if (pred(sh, sa)) m |= 1n << BigInt(sh * SG + sa);
  }
  return m;
}
