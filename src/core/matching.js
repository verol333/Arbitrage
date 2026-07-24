// Appariement des matchs entre bookmakers avec garde d'orientation dom/ext.
// Port fidèle de matchCore.ts (orientation, matchBook + logique adaptée à N books).
import { teamSim } from './text.js';

// Renvoie "same" | "swapped" | "ambiguous" — un surebet ne doit être calculé QUE
// sur des paires "same" (sinon les jambes sont croisées et le surebet est faux).
export function orientation(refHome, refAway, cHome, cAway) {
  const straight = (teamSim(refHome, cHome) + teamSim(refAway, cAway)) / 2;
  const crossed = (teamSim(refHome, cAway) + teamSim(refAway, cHome)) / 2;
  const MARGIN = 0.12;
  if (straight >= crossed + MARGIN) return 'same';
  if (crossed >= straight + MARGIN) return 'swapped';
  return 'ambiguous';
}

// Détecte les modifieurs (w, femmes, u17, u21, youth, reserves, etc.). Un match
// avec modifieur ne doit JAMAIS s'apparier à un match sans modifieur (women vs
// senior, jeunes vs pro).
const MODIFIER_RE = /\b(w|women|femmes|feminin|dames|u1[5-9]|u2[0-3]|youth|junior|jrs?|reserves?|2nd|ii|iii|b|c|amateur)\b/i;
function modifierKey(s) {
  const m = (s || '').match(MODIFIER_RE);
  return m ? m[1].toLowerCase() : '';
}
function modifiersMatch(refHome, refAway, cHome, cAway) {
  return modifierKey(refHome) === modifierKey(cHome) && modifierKey(refAway) === modifierKey(cAway);
}

// Apparie un match de référence (ref) contre un catalogue (cands).
// STRICT :
//  - fenêtre ±30 min si les 2 heures connues
//  - chaque équipe ≥ 0.60 de similarité (rejette Dynamo Moscow vs Dynamo Makhachkala)
//  - moyenne ≥ 0.70
//  - modifieurs cohérents (women/youth/u17/reserves) sur les 2 côtés
//  - orientation "same" obligatoire
export function matchBook(ref, cands, used) {
  const HARD_DT = 30 * 60 * 1000;
  const MIN_TEAM = 0.60;
  const MIN_AVG = 0.70;
  let best = null, bestScore = -1, bestDt = null;
  for (const c of cands) {
    if (used.has(c.id)) continue;
    const dt = (ref.start && c.start) ? Math.abs(ref.start - c.start) : null;
    if (dt !== null && dt > HARD_DT) continue;
    if (!modifiersMatch(ref.home, ref.away, c.home, c.away)) continue;
    const sh = teamSim(ref.home, c.home);
    const sa = teamSim(ref.away, c.away);
    if (!(sh >= MIN_TEAM && sa >= MIN_TEAM)) continue;
    const avg = (sh + sa) / 2;
    if (avg < MIN_AVG) continue;
    if (orientation(ref.home, ref.away, c.home, c.away) !== 'same') continue;
    const better = avg > bestScore + 1e-6
      || (Math.abs(avg - bestScore) <= 1e-6 && dt !== null && (bestDt === null || dt < bestDt));
    if (better) { bestScore = avg; best = c; bestDt = dt; }
  }
  return best;
}

// Aligne N bookmakers autour d'un catalogue de base : renvoie une liste d'entrées
// { ref, matches: { [bookKey]: match } } avec au moins 2 books couvrant le match.
// - `catalogs` : Map<bookKey, Match[]> (catalogues déjà listés)
// - `base` : catalogue de référence, priorité au plus gros ; les matchs seuls
//   d'un autre book peuvent former une entrée si aucun match base ne les couvre.
export function alignCatalogs(catalogs, { minBooks = 2, horizonMs = null } = {}) {
  const books = Array.from(catalogs.keys());
  if (!books.length) return [];
  // Choisir la clé de base = plus gros catalogue (proxy du plus large horizon).
  const base = books.reduce((a, b) => (catalogs.get(a).length >= catalogs.get(b).length ? a : b));
  const nowMs = Date.now();
  const inHorizon = (m) => !horizonMs || (m.start && m.start > nowMs + 2 * 60 * 1000 && m.start <= horizonMs);
  const baseList = catalogs.get(base).filter(inHorizon);
  const used = new Map(); // bookKey → Set<id>
  for (const b of books) used.set(b, new Set());
  const entries = [];
  for (const m of baseList) {
    const ref = { home: m.home, away: m.away, start: m.start, league: m.league };
    const matches = { [base]: m };
    used.get(base).add(m.id);
    for (const b of books) {
      if (b === base) continue;
      const cand = matchBook(ref, catalogs.get(b), used.get(b));
      if (cand) { matches[b] = cand; used.get(b).add(cand.id); }
    }
    entries.push({ ref, matches });
  }
  // Ajouter les matchs des autres books qui n'ont pas été raccrochés à la base :
  // ils peuvent quand même former un surebet avec un autre book non-base.
  for (const b of books) {
    if (b === base) continue;
    for (const m of catalogs.get(b)) {
      if (used.get(b).has(m.id)) continue;
      if (!inHorizon(m)) continue;
      const ref = { home: m.home, away: m.away, start: m.start, league: m.league };
      const matches = { [b]: m };
      used.get(b).add(m.id);
      for (const other of books) {
        if (other === b) continue;
        const cand = matchBook(ref, catalogs.get(other), used.get(other));
        if (cand) { matches[other] = cand; used.get(other).add(cand.id); }
      }
      entries.push({ ref, matches });
    }
  }
  return entries.filter((e) => Object.keys(e.matches).length >= minBooks);
}
