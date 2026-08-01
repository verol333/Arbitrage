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
// Deux modes de matching :
//   STRICT (default)  : team≥0.60 et avg≥0.70 (comme avant)
//   KICKOFF-TIGHT     : si kickoff ≤ 3min ET orientation "same", assouplit à
//                       team≥0.40, avg≥0.55 → capte les équipes exotiques
//                       aux noms traduits/orthographiés très différemment
//                       (le kickoff exact est un signal universel puissant)
//  - fenêtre ±30 min
//  - modifieurs cohérents (women/youth/u17/reserves)
//  - orientation "same" obligatoire
// `requireStart` : en mode prématch, refuser les candidats sans startTime —
// sinon BetPawa (start=null) matchait des matchs déjà LIVE aux matchs prématch
// base d'autres books, générant des faux arbs et des alertes prématch sur
// matchs qui avaient déjà commencé.
export function matchBook(ref, cands, used, { requireStart = false } = {}) {
  const HARD_DT = 30 * 60 * 1000;
  const TIGHT_DT = 3 * 60 * 1000; // ±3 min = kickoff quasi-identique
  let best = null, bestScore = -1, bestDt = null;
  for (const c of cands) {
    if (used.has(c.id)) continue;
    if (requireStart && !c.start) continue;
    const dt = (ref.start && c.start) ? Math.abs(ref.start - c.start) : null;
    if (dt !== null && dt > HARD_DT) continue;
    if (!modifiersMatch(ref.home, ref.away, c.home, c.away)) continue;
    const sh = teamSim(ref.home, c.home);
    const sa = teamSim(ref.away, c.away);
    const avg = (sh + sa) / 2;
    // Sélection des seuils selon proximité kickoff
    const isTight = dt !== null && dt <= TIGHT_DT;
    const minTeam = isTight ? 0.40 : 0.60;
    const minAvg = isTight ? 0.55 : 0.70;
    if (!(sh >= minTeam && sa >= minTeam)) continue;
    if (avg < minAvg) continue;
    if (orientation(ref.home, ref.away, c.home, c.away) !== 'same') continue;
    // Score final : avg + petit bonus si kickoff tight (préfère match tight à même score)
    const score = avg + (isTight ? 0.05 : 0);
    const better = score > bestScore + 1e-6
      || (Math.abs(score - bestScore) <= 1e-6 && dt !== null && (bestDt === null || dt < bestDt));
    if (better) { bestScore = score; best = c; bestDt = dt; }
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
      const cand = matchBook(ref, catalogs.get(b), used.get(b), { requireStart: !!horizonMs });
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
        const cand = matchBook(ref, catalogs.get(other), used.get(other), { requireStart: !!horizonMs });
        if (cand) { matches[other] = cand; used.get(other).add(cand.id); }
      }
      entries.push({ ref, matches });
    }
  }
  return entries.filter((e) => Object.keys(e.matches).length >= minBooks);
}
