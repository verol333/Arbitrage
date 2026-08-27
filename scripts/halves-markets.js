// Marches "par mi-temps" : predicats sur la grille (h1, a1, h2, a2).
// h1/a1 = buts domicile/exterieur en 1ere mi-temps, h2/a2 en 2eme.
// Le score final n'est que (h1+h2, a1+a2) : cette grille raffine l'ancienne.
// Ces marches etaient jetes par le solveur car inexprimables sur une grille de
// scores FINAUX (score par mi-temps, periode la plus prolifique, etc.).

function trailingLine(txt) {
  const m = String(txt).match(/([+-]?\d+(?:[.,]\d+)?)\s*\)?\s*$/);
  return m ? parseFloat(m[1].replace(',', '.')) : NaN;
}

// Equipe visee par le marche. null si ambigu : une attribution par defaut
// inverserait les equipes et fabriquerait de faux arbitrages.
function teamSide(m, homeNamed, awayNamed) {
  if (/\b(?:equipe|[eé]quipe|team)\s*1\b|home team|domicile/.test(m)) return 'home';
  if (/\b(?:equipe|[eé]quipe|team)\s*2\b|away team|ext[eé]rieur/.test(m)) return 'away';
  if (homeNamed && !awayNamed) return 'home';
  if (awayNamed && !homeNamed) return 'away';
  return null;
}

function isTeamScoped(m, homeNamed, awayNamed) {
  return /\b(?:equipe|[eé]quipe|team)\s*[12]\b|home team|away team|domicile|ext[eé]rieur/.test(m)
    || homeNamed || awayNamed;
}

// Retourne un predicat (h1,a1,h2,a2) => bool, ou null si non gere.
function classifyHalfPredicate({ m, s, homeNamed, awayNamed }) {
  const side = teamSide(m, homeNamed, awayNamed);
  const scoped = isTeamScoped(m, homeNamed, awayNamed);

  // ─ Comparaison des deux mi-temps ───────────────────────────────────────
  // "Score dans chaque mi-temps" (1>2 / 1=2 / 1<2), "Periode la plus prolifique
  // en buts", "Equipe 1 score dans les mi-temps", "mi-temps avec le plus de buts".
  if (/score dans (?:chaque|les) mi-?temps|mi-?temps avec le plus de buts|p[eé]riode la plus prolifique|half with more goals|most goals in (?:a |the )?half/.test(m)) {
    if (scoped && !side) return null;
    const pick = (h1, a1, h2, a2) => side === 'home' ? [h1, h2]
      : side === 'away' ? [a1, a2]
      : [h1 + a1, h2 + a2];
    let cmp = null;
    if (/=|[eé]galit[eé]|equal/.test(s)) cmp = 'eq';
    else if (/>/.test(s)) cmp = 'gt';
    else if (/</.test(s)) cmp = 'lt';
    else if (/premi[eè]re mi-?temps|1[eè]re mi-?temps|first half/.test(s)) cmp = 'gt';
    else if (/deuxi[eè]me mi-?temps|2[eè]me mi-?temps|second half/.test(s)) cmp = 'lt';
    if (!cmp) return null;
    return (h1, a1, h2, a2) => {
      const [f1, f2] = pick(h1, a1, h2, a2);
      return cmp === 'eq' ? f1 === f2 : cmp === 'gt' ? f1 > f2 : f1 < f2;
    };
  }

  // ─ Gagne au moins une mi-temps / gagne les deux mi-temps ───────────────
  const atLeastOne = /gagne au moins une mi-?temps|gagner au moins une mi-?temps|win at least one half/.test(m);
  const bothHalves = /gagne les deux mi-?temps|win both halves/.test(m);
  if (atLeastOne || bothHalves) {
    if (!side) return null;
    const no = /^non|^no\b/.test(s.trim());
    const yes = /^oui|^yes\b/.test(s.trim());
    if (!no && !yes) return null;
    const base = (h1, a1, h2, a2) => {
      const w1 = side === 'home' ? h1 > a1 : a1 > h1;
      const w2 = side === 'home' ? h2 > a2 : a2 > h2;
      return atLeastOne ? (w1 || w2) : (w1 && w2);
    };
    return no ? ((...v) => !base(...v)) : base;
  }

  // ─ Marque a chaque mi-temps ────────────────────────────────────────────
  if (/marque [aà] chaque mi-?temps|scores? in both halves/.test(m)) {
    if (!side) return null;
    const no = /^non|^no\b/.test(s.trim());
    const base = (h1, a1, h2, a2) => side === 'home' ? (h1 > 0 && h2 > 0) : (a1 > 0 && a2 > 0);
    return no ? ((...v) => !base(...v)) : base;
  }

  // ─ Marches d'une mi-temps precise (1X2, double chance, total, BTTS) ────
  const first = /1st half|1[eè]re mi-?temps|premi[eè]re mi-?temps|- 1h\b|\b1h\b/.test(m);
  const second = /2nd half|2[eè]me mi-?temps|deuxi[eè]me mi-?temps|- 2h\b|\b2h\b/.test(m);
  if (!first && !second) return null;
  const HH = (h1, a1, h2, a2) => first ? h1 : h2;
  const AA = (h1, a1, h2, a2) => first ? a1 : a2;

  // Total de la mi-temps (eventuellement par equipe)
  if (/total|nombre de buts/.test(m)) {
    const line = trailingLine(s);
    if (isNaN(line) || Number.isInteger(line)) return null; // ligne entiere = remboursement
    const over = /over|plus|>/.test(s);
    const under = /under|moins|</.test(s);
    if (!over && !under) return null;
    if (scoped) {
      if (!side) return null;
      const val = (...v) => side === 'home' ? HH(...v) : AA(...v);
      return over ? ((...v) => val(...v) > line) : ((...v) => val(...v) < line);
    }
    return over ? ((...v) => HH(...v) + AA(...v) > line) : ((...v) => HH(...v) + AA(...v) < line);
  }

  // Les deux equipes marquent (dans la mi-temps)
  if (/les deux [eé]quipes marquent|both teams to score|btts/.test(m)) {
    if (/\bet\b|and /.test(m)) return null; // combine : non traite
    const no = /^non|^no\b/.test(s.trim());
    const base = (...v) => HH(...v) > 0 && AA(...v) > 0;
    return no ? ((...v) => !base(...v)) : base;
  }

  // Double chance de la mi-temps
  if (/double chance/.test(m)) {
    if (/\bet\b|and /.test(m)) return null;
    const k = s.replace(/[^0-9xX]/g, '').toLowerCase();
    if (k === '1x' || k === 'x1') return (...v) => HH(...v) >= AA(...v);
    if (k === '12') return (...v) => HH(...v) !== AA(...v);
    if (k === 'x2' || k === '2x') return (...v) => AA(...v) >= HH(...v);
    return null;
  }

  // Resultat 1X2 de la mi-temps
  if (/result|r[eé]sultat|1x2|vainqueur|winner/.test(m)) {
    if (/\bet\b|and /.test(m)) return null;
    const k = s.trim();
    if (/^1\b|^home|^domicile/.test(k)) return (...v) => HH(...v) > AA(...v);
    if (/^x\b|^draw|^nul|^[eé]galit/.test(k)) return (...v) => HH(...v) === AA(...v);
    if (/^2\b|^away|^ext/.test(k)) return (...v) => AA(...v) > HH(...v);
    return null;
  }

  return null;
}

module.exports = { classifyHalfPredicate };
