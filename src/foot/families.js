// Classification canonique des marchés football.
// Objectif : ramener les libellés natifs très différents d'un book à l'autre
// ("Correct Score", "Score exact", "Résultat exact"…) vers une même famille,
// afin de savoir quelles familles sont disponibles chez au moins deux books
// — condition nécessaire pour construire une partition d'issues rentable.

export const strip = (s) =>
  (s ?? '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// Détection de la portée : mi-temps 1, mi-temps 2, ou match entier.
function scopeOf(name) {
  if (/(1st half|1ere mi-temps|1ere periode|1st period|premiere mi-temps|mi-temps 1|1re mi-temps|half time|1h\b)/.test(name)) return 'H1';
  if (/(2nd half|2eme mi-temps|2e mi-temps|2nd period|2eme periode|deuxieme mi-temps|2h\b)/.test(name)) return 'H2';
  return 'FT';
}

// Règles ordonnées : la première qui matche gagne (du plus spécifique au plus large).
const RULES = [
  ['HTFT', /(mi-temps ?\/ ?(fin|resultat|temps)|half ?time ?\/ ?full ?time|ht ?\/ ?ft|double resultat)/],
  ['RESULT_TOTAL', /((resultat|result|1x2).*(total|nombre de buts|buts|over|under|plus|moins)|(total|buts).*(resultat|result))/],
  ['DC_TOTAL', /(double chance).*(total|but|over|under|plus|moins)/],
  ['DC', /(double chance|chance double|\bdc\b)/],
  ['CS', /(correct score|score exact|resultat exact|exact score|score correct)/],
  ['MULTIGOALS', /(multi ?goal|multigoals|intervalle de buts|nombre exact de buts|buts exacts|total exact|exact (total|goals|number)|fourchette de buts)/],
  ['GOAL_INTERVAL', /(intervalle|interval|moment du|minute du|timing)/],
  ['WIN_MARGIN', /(ecart|margin|marge de victoire|winning margin|difference de buts)/],
  ['CLEAN_SHEET', /(clean sheet|ne concede|sans encaisser|equipe marque|to score\b|va marquer|marquera)/],
  ['FIRST_GOAL', /(1ere equipe|premiere equipe|first (team )?to score|dernier but|last (team )?to score|premier but|first goal)/],
  ['HALF_PRODUCTIVE', /(mi-temps la plus|most goals in half|highest scoring half|gagner au moins une mi-temps|win (either|both) half)/],
  ['ODD_EVEN', /(pair ?\/ ?impair|paire? ou impaire?|odd ?\/ ?even|\bodd\b|\bimpair\b|\beven\b|\bpair\b)/],
  ['BTTS', /(les deux equipes|both teams|btts|deux equipes marquent|gg\/ng|goal ?\/ ?no ?goal)/],
  ['HANDICAP_EURO', /(handicap europeen|european handicap|handicap 1x2|handicap \(\d)/],
  ['HANDICAP_ASIAN', /(handicap asiatique|asian handicap|handicap|\bah\b|spread)/],
  ['DNB', /(draw no bet|remboursement si match nul|match nul rembourse|\bdnb\b)/],
  ['OU_TEAM', /(total (de |des )?buts? (de l'|d')?(equipe|domicile|exterieur)|team total|total domicile|total exterieur|individual total|total individuel)/],
  ['CORNERS', /(corner|coup de pied de coin)/],
  ['CARDS', /(carton|card|booking)/],
  ['SHOTS', /(tir|shot)/],
  ['FOULS', /(faute|foul)/],
  ['OFFSIDE', /(hors-jeu|hors jeu|offside)/],
  ['OU_MATCH', /(total|over|under|plus de|moins de|nombre de buts|buts)/],
  ['WINNER', /(1x2|resultat du match|match result|vainqueur|winner|issue du match|resultat final|full time result|\b1 ?x ?2\b)/],
];

// Retourne un code de famille canonique, suffixé par la portée (FT/H1/H2).
export function classify(marketName, selection = '') {
  const n = strip(marketName);
  const scope = scopeOf(n);
  for (const [family, re] of RULES) {
    if (re.test(n)) return scope === 'FT' ? family : `${family}_${scope}`;
  }
  // Dernier recours : certains books ne nomment pas le marché, on lit la sélection.
  const s = strip(selection);
  if (/^\d+ ?[:-] ?\d+$/.test(s)) return scope === 'FT' ? 'CS' : `CS_${scope}`;
  return 'OTHER';
}

// Familles exploitables pour construire des partitions d'issues
// (elles se projettent toutes sur la grille des scores).
export const GRID_FAMILIES = new Set([
  'WINNER', 'DC', 'DNB', 'CS', 'MULTIGOALS', 'OU_MATCH', 'OU_TEAM', 'BTTS',
  'ODD_EVEN', 'HANDICAP_EURO', 'HANDICAP_ASIAN', 'CLEAN_SHEET', 'WIN_MARGIN',
  'HTFT', 'RESULT_TOTAL', 'DC_TOTAL', 'FIRST_GOAL',
  'WINNER_H1', 'DC_H1', 'CS_H1', 'OU_MATCH_H1', 'BTTS_H1', 'ODD_EVEN_H1',
  'MULTIGOALS_H1', 'OU_TEAM_H1', 'HANDICAP_ASIAN_H1', 'HANDICAP_EURO_H1',
]);
