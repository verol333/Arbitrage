// Vocabulaire STANDARD des clés de cotes utilisé dans tout le système.
// Chaque bookmaker doit produire ses cotes plates sous ces mêmes clés — c'est ce
// qui permet à `arbitrage.js` d'être totalement agnostique du bookmaker.
//
// Format des clés :
//   Plein temps
//     match_1 / match_X / match_2                          → 1X2
//     dc_1X / dc_12 / dc_X2                                → Double Chance
//     btts_yes / btts_no                                   → BTTS
//     dnb_1 / dnb_2                                        → Draw No Bet (ou dnb_home/dnb_away)
//     match_over_<L> / match_under_<L>                     → Total buts (demi-lignes)
//     hcp_home_<L> / hcp_away_<L>                          → Handicap ±L
//     tt_home_over_<L> / tt_home_under_<L>                 → Total individuel dom.
//     tt_away_over_<L> / tt_away_under_<L>                 → Total individuel ext.
//     odd / even                                           → Pair/Impair
//     fts_home / fts_away / fts_none                       → 1ère équipe à marquer (3-way)
//     half_most_ht / half_most_h2 / half_most_equal        → Mi-temps la plus prolifique
//   Mi-temps (préfixes ht_ / h2_ ou sh_)
//     ht_match_1 / ht_dc_1X / ht_over_<L> / ht_hcp_home_<L> / ...
//     h2_match_1 / h2_dc_1X / h2_over_<L> / h2_hcp_home_<L> / ...
//   Corners (préfixe cor_ / cor_ht_)
//     cor_over_<L> / cor_under_<L>                         → Total corners
//     cor_hcp_home_<L> / cor_hcp_away_<L>                  → Handicap corners
//     cor_odd / cor_even                                   → Corners pair/impair
//     cor_ht_over_<L> / cor_ht_under_<L>                   → Corners 1MT total
//
// Notes :
//   - Certains bookmakers utilisent dnb_home/dnb_away au lieu de dnb_1/dnb_2 ; les
//     deux vocabulaires cohabitent — arbitrage.js accepte les deux.
//   - YellowBet evapi utilise sh_ pour la 2e mi-temps (pas h2_) — id.
//   - Les lignes sont TOUJOURS des demi-lignes (X.5) : les lignes entières/quarts
//     sont rejetées à la lecture (pas d'arbitrage garanti).

export function isHalfLine(n) {
  const v = Math.abs(Number(n));
  return Number.isFinite(v) && Math.abs((v * 2) % 2 - 1) < 1e-9;
}

// Normalise les alias vers le vocabulaire principal, sans détruire les clés déjà
// existantes. Appelé avant toute comparaison pour maximiser la couverture.
export function normalizeAliases(odds) {
  const o = { ...odds };
  const alias = (from, to) => { if (o[from] != null && o[to] == null) o[to] = o[from]; };
  alias('dnb_home', 'dnb_1');
  alias('dnb_away', 'dnb_2');
  alias('ht_dnb_home', 'ht_dnb_1');
  alias('ht_dnb_away', 'ht_dnb_2');
  alias('h2_dnb_home', 'h2_dnb_1');
  alias('h2_dnb_away', 'h2_dnb_2');
  // YellowBet : sh_ = 2e mi-temps (équivalent h2_).
  for (const k of Object.keys(o)) {
    if (k.startsWith('sh_')) alias(k, 'h2_' + k.slice(3));
    if (k.startsWith('ht_') && k !== 'ht_1' && k !== 'ht_X' && k !== 'ht_2') continue;
  }
  // YellowBet renvoie ht_1/ht_X/ht_2 et sh_1/sh_X/sh_2 — mappe vers ht_match_1 etc.
  alias('ht_1', 'ht_match_1'); alias('ht_X', 'ht_match_X'); alias('ht_2', 'ht_match_2');
  alias('sh_1', 'h2_match_1'); alias('sh_X', 'h2_match_X'); alias('sh_2', 'h2_match_2');
  // Pair/impair goals (YellowBet).
  alias('goals_odd', 'odd'); alias('goals_even', 'even');
  return o;
}

// ─────────────────────────────────────────────────────────────────────────────
// PLANCHER D'UN MARCHÉ À DEUX ISSUES — CORRECTIF CAUSE RACINE (13/11/2026)
//
// Un book ne publie JAMAIS deux issues complémentaires dont la somme des
// probabilités implicites tombe SOUS 1 : il perdrait à coup sûr sur les deux
// paris, quel que soit le résultat. Une telle paire n'est donc pas une
// opportunité : c'est une LECTURE FAUSSE (cote prise dans le marché voisin,
// dans une autre période, ou côté périmé).
//
// Cas réel qui a produit le faux surebet à 12,31 % :
//   1xbet  « Suisse U20 – Roumanie U20 » — les deux équipes marquent
//   btts_yes 1.58  +  btts_no 3.97   →  1/1.58 + 1/3.97 = 0.884
//   alors que le « Non » affiché sur 1xBet valait 2.05.
// Les deux jambes ne couvraient donc pas le même match/marché : le « profit
// garanti » était impossible à placer.
//
// Le garde-fou existant (twoWaySane) ne vérifiait que le PLAFOND (somme ≤ 1,20)
// et n'était appelé nulle part. Ici on vérifie le PLANCHER, sur chaque book,
// avant toute comparaison : une paire incohérente est retirée des cotes du book
// pour le cycle, donc elle ne peut plus alimenter un surebet.
const PAIR_FLOOR = 0.98;
// PLAFOND (14/11/2026) : deux issues complémentaires chez un MÊME book ne
// peuvent pas totaliser plus de 12 % de marge. Au-delà, la paire est corrompue
// (prix figé d'un état antérieur, ligne servie depuis un autre marché) et elle
// fabrique un faux « profit garanti ». Cas signalé : Hatta Club-Al Ain, où
// Mozzart publiait « Hatta marque » à 1,28 ET « Hatta ne marque pas » à 2,45
// (119 % de marge) → surebet fantôme de 15,71 % face à Maxibet.
const PAIR_CEIL = 1.12;

// Clé complémentaire d'un marché à deux issues, ou null si la clé n'en fait pas
// partie (1X2 et marchés à trois issues exclus : le nul est une issue réelle).
export function complementKey(key) {
  const k = String(key || '');
  // Les deux équipes marquent / clean sheet : _yes ↔ _no (tous préfixes).
  if (/_yes$/.test(k)) return k.slice(0, -4) + '_no';
  if (/_no$/.test(k)) return k.slice(0, -3) + '_yes';
  // Pair / impair.
  if (k === 'odd') return 'even';
  if (k === 'even') return 'odd';
  if (/_odd$/.test(k)) return k.slice(0, -4) + '_even';
  if (/_even$/.test(k)) return k.slice(0, -5) + '_odd';
  // Totaux (match, mi-temps, quarters, corners, totaux par équipe, jeux tennis).
  if (/_over_/.test(k)) return k.replace(/_over_/, '_under_');
  if (/_under_/.test(k)) return k.replace(/_under_/, '_over_');
  // Handicaps : hcp_home_L est complémentaire de hcp_away_(-L).
  const home = k.match(/^(.*?)hcp_home_(-?\d+(?:\.\d+)?)$/);
  if (home) return `${home[1]}hcp_away_${-Number(home[2])}`;
  const away = k.match(/^(.*?)hcp_away_(-?\d+(?:\.\d+)?)$/);
  if (away) return `${away[1]}hcp_home_${-Number(away[2])}`;
  return null;
}

// Retire des cotes d'UN book toute paire complémentaire mathématiquement
// impossible (somme des probabilités implicites < 1). Renvoie la liste des
// marchés retirés pour le journal du scan.
export function dropInconsistentPairs(odds) {
  const dropped = [];
  if (!odds || typeof odds !== 'object') return dropped;
  const done = new Set();
  for (const key of Object.keys(odds)) {
    if (key === '_ids' || done.has(key)) continue;
    const other = complementKey(key);
    if (!other || done.has(other)) continue;
    const a = Number(odds[key]), b = Number(odds[other]);
    if (!(a > 1) || !(b > 1)) continue;
    done.add(key); done.add(other);
    const sum = 1 / a + 1 / b;
    if (sum >= PAIR_FLOOR && sum <= PAIR_CEIL) continue;
    dropped.push({ key, other, a, b, sum: Math.round(sum * 1000) / 1000 });
    delete odds[key];
    delete odds[other];
    if (odds._ids) { delete odds._ids[key]; delete odds._ids[other]; }
  }
  return dropped;
}
