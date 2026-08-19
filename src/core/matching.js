// Appariement des matchs entre bookmakers avec garde d'orientation dom/ext.
// Port fidèle de matchCore.ts (orientation, matchBook + logique adaptée à N books).
import { teamSim, norm } from './text.js';

// Extrait la 1re lettre du 1er mot significatif du nom normalisé.
// Utilisé pour bucket les matchs sans start (perf : évite scan O(n) sur chaque
// appel candsIn). Ex : "FC Bayern Munich" → norm → "bayern munich" → "b".
// Un match "Bayern" ne pourra matcher qu'un candidat dont le home commence
// aussi par "b" (à 99% le cas, teamSim < 0.60 sinon = rejeté de toute façon).
function firstChar(name) {
  const n = norm(name || '');
  return n.length ? n[0] : '';
}

// Renvoie "same" | "swapped" | "ambiguous" — un surebet ne doit être calculé QUE
// sur des paires "same" (sinon les jambes sont croisées et le surebet est faux).
// Binary search : plus petit index tel que arr[i].start >= target.
// arr doit être trié par start asc. Retourne arr.length si target > tous.
function lowerBound(arr, target) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].start < target) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// Ecart de coup d'envoi tolere entre deux bookmakers pour un MEME match.
// Les books suivent tous le meme flux (Betradar) : l'heure est identique a la
// minute. 10 min couvre les arrondis/decalages de publication, sans jamais
// pouvoir relier deux rencontres differentes.
export const KICKOFF_MAX_DT = 10 * 60 * 1000;

// Meme journee calendaire (UTC) — garde-fou supplementaire contre les affiches
// identiques programmees a la meme heure mais des jours differents.
export function sameCalendarDay(a, b) {
  const da = new Date(a), db = new Date(b);
  return da.getUTCFullYear() === db.getUTCFullYear()
    && da.getUTCMonth() === db.getUTCMonth()
    && da.getUTCDate() === db.getUTCDate();
}

export function orientation(refHome, refAway, cHome, cAway) {
  const straight = (teamSim(refHome, cHome) + teamSim(refAway, cAway)) / 2;
  const crossed = (teamSim(refHome, cAway) + teamSim(refAway, cHome)) / 2;
  const MARGIN = 0.12;
  if (straight >= crossed + MARGIN) return 'same';
  if (crossed >= straight + MARGIN) return 'swapped';
  return 'ambiguous';
}

// Détecte les modifieurs (w, femmes, u17, u21, youth, reserves, WFC/LFC, (F),
// etc.). Un match avec modifieur ne doit JAMAIS s'apparier à un match sans
// modifieur (women vs senior, jeunes vs pro).
// Fix bug user (05/08) : "Dundee WFC vs Aberdeen LFC" (Women's Cup) etait
// apparie a "Dundee vs Aberdeen" (Premiership masculine) car \bw\b/\bl\b ne
// matchaient pas WFC/LFC (W/L colle a FC). Ajout : suffixes féminins compacts
// (WFC, LFC, WF, LF), marqueurs entre parenthèses (F), (W), (Femmes), et
// "ladies" comme mot entier. Feminin unifié sur clé "w".
const GENDER_YOUTH_TOKENS = [
  // Feminin : mots entiers
  'women', 'femmes', 'feminin', 'dames', 'ladies',
  // Feminin : suffixes club (WFC, LFC, WF, LF, WSC, LSC)
  'wfc', 'lfc', 'wf', 'lf', 'wsc', 'lsc',
  // Jeunes
  'u15', 'u16', 'u17', 'u18', 'u19', 'u20', 'u21', 'u22', 'u23',
  'youth', 'junior', 'jr', 'jrs',
  // Equipe reserve / seconde
  'reserves', 'reserve', '2nd', 'ii', 'iii',
  // Amateur
  'amateur',
];
// Regex : matche l'un de ces tokens comme mot entier (bornes de mots ou séparateurs).
const MODIFIER_RE = new RegExp(`(?:^|[\\s()\\[\\]/.-])(${GENDER_YOUTH_TOKENS.join('|')})(?:$|[\\s()\\[\\]/.-])`, 'i');
// Regex parenthèses solo : (F), (W), (Fem), (Wom) — marqueurs compacts
const PAREN_GENDER_RE = /\(\s*(f|w|fem(?:mes)?|wom(?:en)?)\s*\)/i;
// Suffixes feminins qui doivent être normalisés vers "w"
const FEMININ_KEYS = new Set(['women', 'femmes', 'feminin', 'dames', 'ladies', 'wfc', 'lfc', 'wf', 'lf', 'wsc', 'lsc']);

function modifierKey(s) {
  const str = String(s || '');
  const m = str.match(MODIFIER_RE);
  if (m) {
    const t = m[1].toLowerCase();
    // Unifie tous les tokens féminins sur "w" : Dundee WFC et Aberdeen LFC
    // sont tous "féminins" — un même club peut avoir plusieurs suffixes.
    if (FEMININ_KEYS.has(t)) return 'w';
    return t;
  }
  const p = str.match(PAREN_GENDER_RE);
  if (p) return 'w';  // (F), (W), (Fem), (Wom) → féminin
  return '';
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
  const TIGHT_DT = 3 * 60 * 1000; // ±3 min = kickoff quasi-identique
  let best = null, bestScore = -1, bestDt = null;
  // AMBIGUITE : garder tous les candidats qui passent les filtres. Si a la
  // fin on a plusieurs candidats "aveugles" (sans startTime ni league) avec
  // sim identique, on REJETTE — impossible de savoir lequel est le bon match.
  // Fix bug user (05/08) : BetPawa avait 2 matchs "Dundee (Wom) vs Aberdeen
  // (Wom)" — un vrai SWPL Cup 19:30, un autre friendly/tournoi different,
  // tous 2 sans startTime ni league → matchBook prenait "random" → fake arb.
  const eligibles = [];
  for (const c of cands) {
    if (used.has(c.id)) continue;
    // Candidat sans startTime : en prématch on n'accepte que si les noms
    // d'équipes sont quasi-identiques (>90% similarity). Élimine 99% des
    // faux appariements (matchs live BetPawa apparaissant en prématch)
    // tout en gardant les vrais matchs communs (BetPawa suit Betradar
    // comme les autres books → noms généralement identiques).
    // ⚠️ VERIFICATION DE DATE/HEURE OBLIGATOIRE (19/08).
    // Cause du bug utilisateur : un candidat sans startTime (BetPawa) pouvait
    // s'apparier a n'importe quelle date pourvu que les noms se ressemblent
    // (dt=null etait accepte). Resultat : "FC Bayern Munich vs VfB Stuttgart"
    // du jour chez Congobet apparie au MEME affiche d'une journee suivante chez
    // BetPawa -> faux surebet, argent perdu. Desormais : les deux cotes doivent
    // annoncer un coup d'envoi connu, le meme jour calendaire (UTC) et a moins
    // de KICKOFF_MAX_DT l'une de l'autre. Aucun appariement "aveugle".
    if (!ref.start || !c.start) continue;
    const dt = Math.abs(ref.start - c.start);
    if (dt > KICKOFF_MAX_DT) continue;
    if (!sameCalendarDay(ref.start, c.start)) continue;
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
    eligibles.push({ c, score, dt });
    const better = score > bestScore + 1e-6
      || (Math.abs(score - bestScore) <= 1e-6 && dt !== null && (bestDt === null || dt < bestDt));
    if (better) { bestScore = score; best = c; bestDt = dt; }
  }
  // AMBIGUITE : si >=2 candidats passent les filtres AVEC des scores tres proches
  // (< 0.02 d'ecart) ET aucun n'a de startTime NI de league, REJET. On ne peut
  // pas distinguer deux matchs "Dundee vs Aberdeen" sur betpawa sans metadata.
  // Si l'un a un startTime + kickoff match la ref (± TIGHT_DT), on l'accepte (signal fort).
  if (eligibles.length >= 2) {
    const near = eligibles.filter((e) => e.score >= bestScore - 0.02);
    if (near.length >= 2) {
      // Un des candidats a un signal fort (kickoff tight OU league proche de ref) ?
      const withStrongSignal = near.filter((e) => {
        const c = e.c;
        // Signal 1 : kickoff tight (< 3min de ref)
        if (e.dt !== null && e.dt <= TIGHT_DT) return true;
        // Signal 2 : league proche du ref (chaine similaire)
        if (ref.league && c.league) {
          const refL = String(ref.league).toLowerCase();
          const cL = String(c.league).toLowerCase();
          if (refL === cL) return true;
          // Contenance mutuelle : "SWPL Cup" ⊆ "SWPL Cup - Women"
          if (refL.length >= 4 && (cL.includes(refL) || refL.includes(cL))) return true;
        }
        return false;
      });
      // Si un SEUL candidat a un signal fort, on le prend.
      if (withStrongSignal.length === 1) {
        return withStrongSignal[0].c;
      }
      // Sinon : ambigu → rejet, aucun match. Mieux qu'un fake arb.
      return null;
    }
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
  // Perf : ne garder dans baseList que les matchs avec start valide, sinon le
  // fix binary search par fenêtre kickoff est court-circuité (candsIn retourne
  // tout le catalog si ref.start=null). Les matchs base sans start sont
  // traités dans la boucle "orphelins" plus bas (volume bien plus faible).
  const baseList = catalogs.get(base).filter((m) => inHorizon(m) && m.start);
  // Perf : pré-tri par start pour chaque book → recherche fenêtre kickoff via
  // binary search au lieu de scan O(n) sur chaque appel matchBook.
  // Sur ~1200 base × 8 books × 500 cands = 4.8M comparaisons Jaro-Winkler (~9min).
  // Avec fenêtre ±30min : ~50 cands en moyenne → 4.8M → ~500k → ~30s.
  const HARD_DT = 30 * 60 * 1000;
  const sortedByStart = new Map(); // bookKey → matchs avec start, triés par start asc
  const noStart = new Map();       // bookKey → matchs sans start (index par firstChar)
  for (const b of books) {
    const arr = catalogs.get(b);
    const withStart = [];
    const withoutByChar = new Map(); // firstChar → Match[]
    for (const m of arr) {
      if (m.start) { withStart.push(m); continue; }
      const c = firstChar(m.home);
      if (!withoutByChar.has(c)) withoutByChar.set(c, []);
      withoutByChar.get(c).push(m);
    }
    withStart.sort((a, z) => a.start - z.start);
    sortedByStart.set(b, withStart);
    noStart.set(b, withoutByChar);
  }
  // Retourne les candidats d'un book :
  //  - refStart défini : fenêtre [ref-30min, ref+30min] via binary search
  //    ∪ noStart bucket dont firstChar(home) = firstChar(refHome)
  //  - refStart null (orphelin BetPawa) : seuls les no-start même bucket
  //
  // Le bucket par firstChar réduit ~973 matchs BP noStart à ~37/bucket (26 chars),
  // soit -96% de comparaisons Jaro-Winkler. Preserves correctness : Jaro-Winkler
  // sim < 0.60 quand noms commencent par lettres différentes = rejeté de toute
  // façon par matchBook (minTeam=0.60).
  const candsIn = (bookKey, refHome, refStart) => {
    // Les matchs sans coup d'envoi connu ne sont plus candidats : la
    // verification date/heure est obligatoire (voir matchBook).
    if (!refStart) return [];
    const arr = sortedByStart.get(bookKey);
    const lo = lowerBound(arr, refStart - HARD_DT);
    const hi = lowerBound(arr, refStart + HARD_DT + 1);
    return arr.slice(lo, hi);
  };
  const used = new Map(); // bookKey → Set<id>
  for (const b of books) used.set(b, new Set());
  const entries = [];
  for (const m of baseList) {
    const ref = { home: m.home, away: m.away, start: m.start, league: m.league };
    const matches = { [base]: m };
    used.get(base).add(m.id);
    for (const b of books) {
      if (b === base) continue;
      const cand = matchBook(ref, candsIn(b, ref.home, ref.start), used.get(b), { requireStart: !!horizonMs });
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
      if (!m.start) continue; // sans coup d'envoi connu : jamais appariable
      const ref = { home: m.home, away: m.away, start: m.start, league: m.league };
      const matches = { [b]: m };
      used.get(b).add(m.id);
      for (const other of books) {
        if (other === b) continue;
        const cand = matchBook(ref, candsIn(other, ref.home, ref.start), used.get(other), { requireStart: !!horizonMs });
        if (cand) { matches[other] = cand; used.get(other).add(cand.id); }
      }
      entries.push({ ref, matches });
    }
  }
  return entries.filter((e) => Object.keys(e.matches).length >= minBooks);
}
