// Détection d'arbitrages (surebets) sur cotes plates standardisées.
// Port fidèle de matchCore.ts (pushArb, pushArb3, compareTwoBooks).
// Garde-fous conservés : cote > 80 ou profit > 40% → rejet (cotes gelées/corrompues).
import { config } from '../config.js';
import { normalizeAliases } from './markets.js';
import { teamSim } from './text.js';

const MAX_ODD = 80;
const MAX_PROFIT = () => config.scan.maxProfitSanity;

// Helper : IDs bruts d'une cote pour SaveCoupon backend. Les parseurs ecrivent
// odds._ids[key] = { ...ids natifs du book } en parallele de odds[key] = value.
// Retourne null si le parseur n'expose pas encore _ids pour ce book/marche.
export const idsOf = (o, k) => o?._ids?.[k] || null;

export function pushArb(out, family, aLabel, aOdd, aBook, bLabel, bOdd, bBook, aIds = null, bIds = null) {
  if (!aOdd || !bOdd || aOdd <= 1 || bOdd <= 1) return;
  if (aOdd > MAX_ODD || bOdd > MAX_ODD) return;
  const invSum = 1 / aOdd + 1 / bOdd;
  if (invSum >= 1) return;
  const profit = (1 - invSum) * 100;
  if (profit > MAX_PROFIT()) return;
  const stakeA = (1 / aOdd) / invSum * 100;
  const stakeB = (1 / bOdd) / invSum * 100;
  out.push({
    market_family: family,
    leg_a_book: aBook, leg_a_label: aLabel, leg_a_odd: aOdd, leg_a_ids: aIds,
    leg_b_book: bBook, leg_b_label: bLabel, leg_b_odd: bOdd, leg_b_ids: bIds,
    inverse_sum: Math.round(invSum * 10000) / 10000,
    profit_pct: Math.round(profit * 100) / 100,
    stake_a_pct: Math.round(stakeA * 10) / 10,
    stake_b_pct: Math.round(stakeB * 10) / 10,
  });
}

// Vainqueur de PERIODE (corners FT/1MT, quarts/mi-temps basket, hockey
// regulation) = marche 3-WAY (H/X/A) : le nul (egalite) est une issue reelle.
//
// CORRECTIF CAUSE RACINE (2026-08-29) : l'ancienne version emettait
// Dom. (book A) + Ext. (book B) SANS parier le nul — la cote Draw ne servait
// que de « validation » mathematique du profit. En cas d'egalite, LES DEUX
// jambes perdaient : ce n'etaient pas des surebets (pertes reelles constatees
// sur « Corners Vainqueur »).
//
// La SEULE couverture garantie en 2 jambes sur un marche 3-way est de croiser
// une Victoire seche avec le handicap +0.5 du camp oppose :
//   Victoire Dom. (match_1)  x  Ext. +0.5 (hcp_away_0.5)  -> le +0.5 gagne
//   Victoire Ext. (match_2)  x  Dom. +0.5 (hcp_home_0.5)     sur nul ET victoire
// Les 3 issues sont couvertes, le profit est reellement garanti — et ces
// marches restent scannes (aucun blocage). Si le book oppose n'expose pas le
// handicap +0.5, pushArb ecarte la paire tout seul (cote absente).
function pushArbPeriodWinner(out, lbl, oaHome, obAway, bookHome, bookAway, pfx) {
  // Victoire Dom. couverte par Ext. +0.5 (gagne si nul OU victoire Ext.)
  pushArb(out, `${lbl} Vainqueur`, 'Dom.', oaHome[`${pfx}match_1`], bookHome,
    'Ext. +0.5', obAway[`${pfx}hcp_away_0.5`], bookAway,
    idsOf(oaHome, `${pfx}match_1`), idsOf(obAway, `${pfx}hcp_away_0.5`));
  // Victoire Ext. couverte par Dom. +0.5 (gagne si nul OU victoire Dom.)
  pushArb(out, `${lbl} Vainqueur`, 'Ext.', oaHome[`${pfx}match_2`], bookHome,
    'Dom. +0.5', obAway[`${pfx}hcp_home_0.5`], bookAway,
    idsOf(oaHome, `${pfx}match_2`), idsOf(obAway, `${pfx}hcp_home_0.5`));
}

// Découverte DYNAMIQUE des lignes (handicap, total, team total, corners).
// L'ancien code utilisait des tableaux hard-codés HCP_LINES [-4.5..4.5] et
// TT_LINES [0.5..5.5] qui manquaient les lignes extrêmes (matchs déséquilibrés
// avec handicap -5.5/-6.5 ou team totals 6.5+ chez Bayern, Man City, etc.).
// linesOf extrait les lignes réellement présentes dans les cotes des 2 books.
const linesOf = (a, b, pattern) => {
  const set = new Set();
  for (const k of [...Object.keys(a), ...Object.keys(b)]) {
    const m = k.match(pattern);
    if (m) set.add(m[1]);
  }
  return set;
};

// Cross-check self-consistency DC vs 1X2 dans UN book. Un book qui expose
// 1X2 ET DC doit satisfaire (a la marge pres) :
//   1/dc_XY  >= P_fair(X) + P_fair(Y) - 15%
// Sinon la DC est "trop haute" (implique moins de prob que ses composantes)
// = book a une erreur d'affichage/cache → sur-cote fake qui creerait des
// arbs fantomes. Bug decouvert 29/07 : Congobet Victoria-Unirea Roumanie
// (Home=7.2 X=4.8 Away=1.22) exposait X2=1.47 alors que fair(X+away)=0.88
// → surebet fake 24% face au 1xbet Home=13.2.
// Retourne { has1x2, dc1x, dc12, dcX2 } — flags true si CE marche DC est
// coherent (ou si aucune verification possible, on laisse passer).
function dcCoherence(o, prefix = '') {
  const m1 = o[`${prefix}match_1`], mX = o[`${prefix}match_X`], m2 = o[`${prefix}match_2`];
  const flags = { dc_1X: true, dc_12: true, dc_X2: true };
  if (!m1 || !mX || !m2) return flags; // pas de 1X2 : on ne peut pas verifier
  const totalRaw = 1 / m1 + 1 / mX + 1 / m2;
  if (totalRaw < 0.9 || totalRaw > 1.5) return flags; // 1X2 lui-meme suspect
  const p1 = (1 / m1) / totalRaw, pX = (1 / mX) / totalRaw, p2 = (1 / m2) / totalRaw;
  const check = (key, sumFair) => {
    const dc = o[`${prefix}${key}`];
    if (!dc) return true;
    const raw = 1 / dc;
    // Book DC implicite doit etre >= somme des probs fair de ses 2 outcomes
    // (avec 15% de tolerance descendante pour marges elevees). Si raw << fair,
    // la cote DC est trop haute donc bugguee.
    return raw >= sumFair * 0.85;
  };
  flags.dc_1X = check('dc_1X', p1 + pX);
  flags.dc_12 = check('dc_12', p1 + p2);
  flags.dc_X2 = check('dc_X2', pX + p2);
  return flags;
}

// Meme logique pour DNB (Draw No Bet) vs 1X2 : dnb_1 gagne si home gagne,
// remboursement si nul → fair dnb_1 = (P(1)+P(X)/2)/(P(1)+P(2)) approximativement.
// En pratique on utilise l'egalite classique : 1/dnb_1 + 1/dnb_2 ≈ 1 + margin
// et 1/dnb_1 ≈ P_fair(1) / (P_fair(1)+P_fair(2)).
// Un book qui expose DNB incoherente avec son 1X2 → skip cette DNB.
function dnbCoherence(o, prefix = '') {
  const m1 = o[`${prefix}match_1`], mX = o[`${prefix}match_X`], m2 = o[`${prefix}match_2`];
  const flags = { dnb_1: true, dnb_2: true };
  if (!m1 || !mX || !m2) return flags;
  const totalRaw = 1 / m1 + 1 / mX + 1 / m2;
  if (totalRaw < 0.9 || totalRaw > 1.5) return flags;
  const p1 = (1 / m1) / totalRaw, p2 = (1 / m2) / totalRaw;
  const p1Cond = p1 / (p1 + p2), p2Cond = p2 / (p1 + p2);
  const check = (key, expected) => {
    const dnb = o[`${prefix}${key}`];
    if (!dnb) return true;
    const raw = 1 / dnb;
    // Tolerance 20% (DNB moins standardise que DC)
    return raw >= expected * 0.80 && raw <= expected * 1.25;
  };
  flags.dnb_1 = check('dnb_1', p1Cond);
  flags.dnb_2 = check('dnb_2', p2Cond);
  return flags;
}

// Check general 2-way : si book expose SUR LE MEME MARCHE les 2 cotes, verifier
// que 1/A + 1/B <= 1.20 (margin book max 20%). Si superieur, une des 2 cotes
// est aberrante → book unreliable pour ce marche. Utilise pour proteger contre
// des bugs isoles sur BTTS/Total/Hcp/Corners d'un book.
function twoWaySane(oddA, oddB) {
  if (!oddA || !oddB) return true; // pas de check possible
  const sum = 1 / oddA + 1 / oddB;
  return sum <= 1.20;
}

// Cross-book coherence sur marche 2-way : verifie que les probabilites
// IMPLICITES (Yes/No, Over/Under, Home/Away FT, etc.) convergent entre les 2
// books. Si l'un des books est stale (cote figee d'un state anterieur du live),
// sa probabilite implicite divergera massivement de l'autre → SKIP l'arb.
//
// Bug decouvert 2026-08-08 sur Santiago Wanderers BTTS live (0-1 79') :
//   SB.btts_yes = 3.25 → prob Yes SB ~31% (real, Home doit marquer en 11min)
//   1win.btts_no = 5.87 → prob No 1win ~17% (impossible !)
//   → 1/3.25 + 1/5.87 = 0.478 → 'arb +52%'
// Si 1win expose AUSSI btts_yes (parseur 1win lit les 2 sides quand groupe
// present), on peut reconstruire la prob implicite 1win.Yes et voir qu'elle
// diverge de SB.Yes de ~50 pts → cotes stale des 2 cotes chez 1win.
//
// Retourne true si les 2 books convergent (< 25% divergence sur prob Yes) OU
// si l'un des 2 books n'expose PAS les 2 sides (impossible de valider). Le
// mode 'strict' (false) impose que les 2 books exposent les 2 sides ET
// convergent — plus safe mais reduit les detections.
function crossBookImpliedProbOK(oa, ob, keyYes, keyNo, tolerance = 0.25) {
  const aYes = oa[keyYes], aNo = oa[keyNo];
  const bYes = ob[keyYes], bNo = ob[keyNo];
  // Book A a les 2 sides ? → prob Yes fair
  const probA = (aYes && aNo && aYes > 1 && aNo > 1)
    ? (1 / aYes) / (1 / aYes + 1 / aNo)
    : null;
  const probB = (bYes && bNo && bYes > 1 && bNo > 1)
    ? (1 / bYes) / (1 / bYes + 1 / bNo)
    : null;
  // Si un des 2 books n'expose pas les 2 sides, on ne peut pas cross-checker.
  // On laisse passer (le check same-book twoWaySane reste actif sur pushArb).
  if (probA == null || probB == null) return true;
  // Les 2 books ont les 2 sides : verifier convergence.
  return Math.abs(probA - probB) <= tolerance;
}

// Compare deux jeux de cotes plates 3-way (foot) entre 2 books quelconques.
// Traite : Total, 1X2+DC, DNB, Handicap, Total indiv., BTTS, Mi-temps, Corners,
// Pair/Impair, 1ère équipe à marquer, Mi-temps la plus prolifique.
// Sanity check d'orientation : si les 2 books ont un match_1 défini mais un
// écart énorme (ex: 1.51 vs 12.5), c'est presque toujours que home/away est
// inversé entre eux (matchs différents apparillés à tort — ex: senior vs
// jeune, ou naming réversé). On skip pour éviter les fake arbs 20-25%.
function orientationsMismatch(oa, ob) {
  const a1 = oa.match_1, a2 = oa.match_2, b1 = ob.match_1, b2 = ob.match_2;
  if (!a1 || !a2 || !b1 || !b2) return false;
  // Si le "favori" (cote la plus basse) est INVERSE entre les 2 books, c'est
  // une orientation retournée. Seuil : ratio > 2 confirme un désaccord franc.
  const aFavIsHome = a1 < a2;
  const bFavIsHome = b1 < b2;
  if (aFavIsHome === bFavIsHome) return false; // même favori → orientation OK
  const aRatio = Math.max(a1, a2) / Math.min(a1, a2);
  const bRatio = Math.max(b1, b2) / Math.min(b1, b2);
  return aRatio > 2 && bRatio > 2;
}

// ── Garde-fou COTES PERIMEES (cause racine des faux surebets signales par les
// utilisateurs : "les cotes du site ne sont pas les memes que chez le book").
// Au coup d'envoi, ou quand le score change en live, un book peut garder
// quelques secondes ses cotes d'AVANT le changement pendant que l'autre a deja
// bouge. Le calcul voit alors un "surebet" de 15-30% qui n'existe pas : la mise
// auto pose la 1re jambe, le book refuse ou derive la 2e, l'utilisateur perd.
// On compare donc la probabilite implicite du VAINQUEUR entre les 2 books : si
// elle diverge massivement, l'un des deux est perime -> on jette TOUT le match.
const STALE_PROB_TOL = 0.25;
function mainImpliedProb(o) {
  const p1 = o.match_1, p2 = o.match_2, px = o.match_X;
  if (!p1 || !p2 || p1 <= 1 || p2 <= 1) return null;
  const i1 = 1 / p1, i2 = 1 / p2;
  const ix = px && px > 1 ? 1 / px : 0;
  const s = i1 + i2 + ix;
  return s > 0 ? { prob: i1 / s, threeWay: ix > 0 } : null;
}
function staleBookMismatch(oa, ob) {
  const a = mainImpliedProb(oa), b = mainImpliedProb(ob);
  if (!a || !b) return false;
  // Structures differentes (l'un avec le nul, l'autre sans) : comparaison biaisee.
  if (a.threeWay !== b.threeWay) return false;
  return Math.abs(a.prob - b.prob) > STALE_PROB_TOL;
}

export function compareTwoBooks(rawA, bookA, rawB, bookB) {
  const oa = normalizeAliases(rawA);
  const ob = normalizeAliases(rawB);
  // Skip complet si orientations 1X2 divergent — évite les fake arbs 20-25%
  // sur matchs mal appariés (BetPawa senior vs autre book jeune, etc.).
  if (orientationsMismatch(oa, ob)) return [];
  if (staleBookMismatch(oa, ob)) return [];
  const out = [];
  // Totaux buts plein temps.
  for (const l of linesOf(oa, ob, /^match_(?:over|under)_(\d+(?:\.\d+)?)$/)) {
    const fam = `Total Buts Match ${l}`;
    pushArb(out, fam, `+${l}`, oa[`match_over_${l}`], bookA, `−${l}`, ob[`match_under_${l}`], bookB, idsOf(oa, `match_over_${l}`), idsOf(ob, `match_under_${l}`));
    pushArb(out, fam, `+${l}`, ob[`match_over_${l}`], bookB, `−${l}`, oa[`match_under_${l}`], bookA, idsOf(ob, `match_over_${l}`), idsOf(oa, `match_under_${l}`));
  }
  // 1X2 croisés Double Chance. Cross-check DC vs 1X2 self-consistency dans le
  // book qui fournit la DC (evite les fausses opps type Congobet 24% Victoria).
  const dcA = dcCoherence(oa, ''), dcB = dcCoherence(ob, '');
  const dcPairs = [
    ['match_1', 'dc_X2', '1X2 — 1 + X2', 'Domicile', 'Nul ou Extérieur'],
    ['match_2', 'dc_1X', '1X2 — 2 + 1X', 'Extérieur', 'Domicile ou Nul'],
    ['match_X', 'dc_12', '1X2 — X + 12', 'Nul', 'Un gagnant (12)'],
  ];
  for (const [sk, dk, fam, aL, bL] of dcPairs) {
    if (dcB[dk]) pushArb(out, fam, aL, oa[sk], bookA, bL, ob[dk], bookB, idsOf(oa, sk), idsOf(ob, dk));
    if (dcA[dk]) pushArb(out, fam, aL, ob[sk], bookB, bL, oa[dk], bookA, idsOf(ob, sk), idsOf(oa, dk));
  }
  // ── CROISEMENT 1X2 <-> HANDICAP ASIATIQUE 0.5 (nouveau, 2026-09-04).
  // Le handicap a demi-but n'a AUCUN remboursement (pas de push) : il est donc
  // l'equivalent EXACT d'une double chance ou d'une victoire seche :
  //   Ext. +0.5 = X2      Dom. +0.5 = 1X
  //   Ext. -0.5 = 2       Dom. -0.5 = 1
  // Les paires ci-dessous couvrent donc les 3 issues sans trou, exactement
  // comme 1X2 x Double Chance — et ouvrent des marges tres elevees car les
  // books ne tarifent pas leur handicap et leur 1X2 avec la meme rigueur
  // (surtout en divisions inferieures). Exemple constate : SportyBet Dom. 4.12
  // x Apollo Ext. +0.5 1.70 = 16,9% garanti.
  // Les lignes 1.5 / 2.5 ne sont PAS utilisees ici : elles se chevauchent au
  // lieu d'etre complementaires, ce qui rend le libelle trompeur. Le controle
  // de coherence DC (dcA/dcB) reste applique quand la jambe est une DC.
  // Uniquement des jambes SECHES cote 1X2 (1 ou 2) croisees avec le handicap
  // a demi-but du camp oppose : aucun remboursement possible, gain total.
  // GENERALISATION (2026-09-04) : une jambe SECHE (1 ou 2) OU une DOUBLE CHANCE
  // croisee avec un handicap a DEMI-BUT du camp oppose, sur TOUTES les lignes
  // demi-but disponibles. Le handicap a demi-but ne peut JAMAIS etre nul : il
  // n'y a donc aucun remboursement, la jambe gagnante paie en entier (1000 F a
  // la cote 2 = 2000 F). C'est exactement ce que le handicap europeen apporte,
  // mais avec le marche "Handicap" simple que TOUS les books exposent deja.
  //   1  x Ext. +L      2  x Dom. +L      1X x Ext. +L
  //   X2 x Dom. +L      12 x Dom. +L      12 x Ext. +L        (L = 0.5/1.5/2.5)
  // Union des deux jambes = les 3 issues, toujours (le chevauchement eventuel
  // ne fait que garantir des cas ou les DEUX jambes gagnent).
  const CROSS_HALF_LINES = ['0.5', '1.5', '2.5'];
  const crossLegs = [
    ['match_1', 'away', 'Domicile', null],
    ['match_2', 'home', 'Extérieur', null],
    ['dc_1X', 'away', 'Domicile ou Nul', 'dc_1X'],
    ['dc_X2', 'home', 'Nul ou Extérieur', 'dc_X2'],
    ['dc_12', 'home', 'Un gagnant (12)', 'dc_12'],
    ['dc_12', 'away', 'Un gagnant (12)', 'dc_12'],
  ];
  for (const [sk, hSide, aL, dcKey] of crossLegs) {
    for (const l of CROSS_HALF_LINES) {
      const hk = `hcp_${hSide}_${l}`;
      const bL = `${hSide === 'away' ? 'Ext.' : 'Dom.'} +${l}`;
      const fam = `1X2 — ${aL} + ${bL}`;
      if (!dcKey || dcA[dcKey]) pushArb(out, fam, aL, oa[sk], bookA, bL, ob[hk], bookB, idsOf(oa, sk), idsOf(ob, hk));
      if (!dcKey || dcB[dcKey]) pushArb(out, fam, aL, ob[sk], bookB, bL, oa[hk], bookA, idsOf(ob, sk), idsOf(oa, hk));
    }
  }
  // Draw No Bet — cross-check DNB vs 1X2 self-consistency intra-book.
  const dnbA = dnbCoherence(oa, ''), dnbB = dnbCoherence(ob, '');
  if (dnbB.dnb_2) pushArb(out, 'Draw No Bet', 'Domicile (DNB)', oa.dnb_1, bookA, 'Extérieur (DNB)', ob.dnb_2, bookB, idsOf(oa, 'dnb_1'), idsOf(ob, 'dnb_2'));
  if (dnbA.dnb_2) pushArb(out, 'Draw No Bet', 'Domicile (DNB)', ob.dnb_1, bookB, 'Extérieur (DNB)', oa.dnb_2, bookA, idsOf(ob, 'dnb_1'), idsOf(oa, 'dnb_2'));
  // Handicaps ASIATIQUES ±L (demi-lignes, 2-way sans nul). Lignes découvertes
  // DYNAMIQUEMENT (avant : hard-codées [-4.5..4.5] → manquait -5.5, -6.5, +5.5,
  // +6.5 pour matchs déséquilibrés). Pair {hcp_home_l, hcp_away_-l}.
  // Handicap FOOT — nommage "Handicap" (pas "Asiatique") : notre parseur
  // filtre uniquement les demi-lignes (0.5/1.5/2.5...) via isHalfLine, ce
  // qui correspond au HANDICAP SIMPLE (2-way sans push), pas au vrai
  // handicap asiatique (lignes quart .25/.75 avec refund partiel).
  for (const l of linesOf(oa, ob, /^hcp_home_(-?\d+(?:\.\d+)?)$/)) {
    const lNum = parseFloat(l);
    const hk = `hcp_home_${l}`, ak = `hcp_away_${-lNum}`;
    const fam = `Handicap ${lNum > 0 ? '+' + l : l}`;
    const aL = `Dom. ${lNum > 0 ? '+' + l : l}`, bL = `Ext. ${-lNum > 0 ? '+' + (-lNum) : -lNum}`;
    pushArb(out, fam, aL, oa[hk], bookA, bL, ob[ak], bookB, idsOf(oa, hk), idsOf(ob, ak));
    pushArb(out, fam, aL, ob[hk], bookB, bL, oa[ak], bookA, idsOf(ob, hk), idsOf(oa, ak));
    // Meme couverture avec UN CRAN de chevauchement (Dom. -1.5 x Ext. +2.5) :
    // l'union des deux jambes reste totale, aucune issue decouverte, aucun
    // remboursement possible. Ouvre des paires que la ligne miroir seule rate.
    const ak2 = `hcp_away_${-lNum + 1}`;
    const l2 = -lNum + 1;
    const fam2 = `Handicap ${lNum > 0 ? '+' + l : l} / ${l2 > 0 ? '+' + l2 : l2}`;
    const bL2 = `Ext. ${l2 > 0 ? '+' + l2 : l2}`;
    pushArb(out, fam2, aL, oa[hk], bookA, bL2, ob[ak2], bookB, idsOf(oa, hk), idsOf(ob, ak2));
    pushArb(out, fam2, aL, ob[hk], bookB, bL2, oa[ak2], bookA, idsOf(ob, hk), idsOf(oa, ak2));
  }
  // ── HANDICAP EUROPEEN (entier) x HANDICAP ASIATIQUE (demi-but) ────────
  // Le handicap europeen est un marche 3-way a handicap ENTIER : "Dom. -1"
  // gagne si l'ecart depasse 1 but, et le match est NUL au handicap si l'ecart
  // vaut exactement 1. Sa couverture SANS REMBOURSEMENT est le handicap
  // asiatique a demi-but du camp oppose, place juste sous le seuil :
  //   eh_home_L  (dom. + L)  <->  hcp_away_(0.5 - L)
  //   eh_away_M  (ext. + M)  <->  hcp_home_(0.5 - M)
  // Exemple reel : Dom. (0:1) = dom. -1 gagnant si ecart >= 2, couvert par
  // Ext. +1.5 gagnant si ecart <= 1. Toutes les issues sont couvertes, aucune
  // jambe ne peut etre remboursee : le gain est total.
  const sgnEh = (n) => (n > 0 ? '+' + n : String(n));
  for (const [ehSide, hcpSide, ehLbl, hcpLbl] of [['home', 'away', 'Dom.', 'Ext.'], ['away', 'home', 'Ext.', 'Dom.']]) {
    for (const l of linesOf(oa, ob, new RegExp(`^eh_${ehSide}_(-?\\d+)$`))) {
      const L = parseInt(l, 10);
      const ek = `eh_${ehSide}_${l}`, hk = `hcp_${hcpSide}_${0.5 - L}`;
      const fam = `Handicap europ. ${ehLbl} ${sgnEh(L)}`;
      const aL = `${ehLbl} ${sgnEh(L)} (europ.)`, bL = `${hcpLbl} ${sgnEh(0.5 - L)}`;
      pushArb(out, fam, aL, oa[ek], bookA, bL, ob[hk], bookB, idsOf(oa, ek), idsOf(ob, hk));
      pushArb(out, fam, aL, ob[ek], bookB, bL, oa[hk], bookA, idsOf(ob, ek), idsOf(oa, hk));
    }
  }
  // Totaux individuels dom./ext. — lignes DYNAMIQUES (avant [0.5..5.5]).
  for (const [side, lbl] of [['home', 'Dom.'], ['away', 'Ext.']]) {
    for (const l of linesOf(oa, ob, new RegExp(`^tt_${side}_(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
      const ok = `tt_${side}_over_${l}`, uk = `tt_${side}_under_${l}`;
      const fam = `Total ${lbl} ${l}`;
      pushArb(out, fam, `${lbl} +${l}`, oa[ok], bookA, `${lbl} −${l}`, ob[uk], bookB, idsOf(oa, ok), idsOf(ob, uk));
      pushArb(out, fam, `${lbl} +${l}`, ob[ok], bookB, `${lbl} −${l}`, oa[uk], bookA, idsOf(ob, ok), idsOf(oa, uk));
    }
  }
  // BTTS — cross-book coherence check (fix bug 2026-08-08 Santiago Wanderers
  // 0-1 79' fake +52%). Si les 2 books exposent Yes+No, leurs probas Yes
  // implicites doivent converger < 25% de divergence — sinon un book a des
  // cotes stale (typiquement en live quand le state du match a change).
  if (crossBookImpliedProbOK(oa, ob, 'btts_yes', 'btts_no')) {
    pushArb(out, 'BTTS', 'Oui', oa.btts_yes, bookA, 'Non', ob.btts_no, bookB, idsOf(oa, 'btts_yes'), idsOf(ob, 'btts_no'));
    pushArb(out, 'BTTS', 'Oui', ob.btts_yes, bookB, 'Non', oa.btts_no, bookA, idsOf(ob, 'btts_yes'), idsOf(oa, 'btts_no'));
  }
  // --- VAGUE 1 : Clean Sheet, Pair/Impair par equipe, corners par equipe ---
  // Clean Sheet = binaire strictement complementaire.
  for (const [pfx, per] of [["", ""], ["ht_", "1MT "], ["h2_", "2MT "]]) {
    for (const [side, lbl] of [["home", "Domicile"], ["away", "Exterieur"]]) {
      const yk = pfx + "cs_" + side + "_yes", nk = pfx + "cs_" + side + "_no";
      if (!crossBookImpliedProbOK(oa, ob, yk, nk)) continue;
      const fam = per + "Clean Sheet " + lbl;
      pushArb(out, fam, "Oui", oa[yk], bookA, "Non", ob[nk], bookB, idsOf(oa, yk), idsOf(ob, nk));
      pushArb(out, fam, "Oui", ob[yk], bookB, "Non", oa[nk], bookA, idsOf(ob, yk), idsOf(oa, nk));
    }
  }
  // Pair/Impair du total de buts d une equipe (0 but compte comme pair).
  for (const [side, lbl] of [["home", "Dom."], ["away", "Ext."]]) {
    const ok = "tt_" + side + "_odd", ek = "tt_" + side + "_even";
    const fam = "Pair/Impair " + lbl;
    pushArb(out, fam, lbl + " Impair", oa[ok], bookA, lbl + " Pair", ob[ek], bookB, idsOf(oa, ok), idsOf(ob, ek));
    pushArb(out, fam, lbl + " Impair", ob[ok], bookB, lbl + " Pair", oa[ek], bookA, idsOf(ob, ok), idsOf(oa, ek));
  }
  // Total corners d une equipe (plein temps et 1MT) - lignes dynamiques.
  for (const [pfx, per] of [["cor_tt_", "Corners Total "], ["cor_ht_tt_", "Corners 1MT Total "]]) {
    for (const [side, lbl] of [["home", "Dom."], ["away", "Ext."]]) {
      const re = new RegExp("^" + pfx + side + "_(?:over|under)_([0-9]+(?:[.][0-9]+)?)$");
      for (const l of linesOf(oa, ob, re)) {
        const ok = pfx + side + "_over_" + l, uk = pfx + side + "_under_" + l;
        const fam = per + lbl + " " + l;
        pushArb(out, fam, lbl + " +" + l, oa[ok], bookA, lbl + " -" + l, ob[uk], bookB, idsOf(oa, ok), idsOf(ob, uk));
        pushArb(out, fam, lbl + " +" + l, ob[ok], bookB, lbl + " -" + l, oa[uk], bookA, idsOf(ob, ok), idsOf(oa, uk));
      }
    }
  }
  // Totaux mi-temps et corners.
  for (const [pfx, lbl] of [['ht_', '1MT Total Buts'], ['h2_', '2MT Total Buts'], ['cor_', 'Corners Total']]) {
    for (const l of linesOf(oa, ob, new RegExp(`^${pfx}(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
      const ok = `${pfx}over_${l}`, uk = `${pfx}under_${l}`;
      const fam = `${lbl} ${l}`;
      pushArb(out, fam, `+${l}`, oa[ok], bookA, `−${l}`, ob[uk], bookB, idsOf(oa, ok), idsOf(ob, uk));
      pushArb(out, fam, `+${l}`, ob[ok], bookB, `−${l}`, oa[uk], bookA, idsOf(ob, ok), idsOf(oa, uk));
    }
  }
  // 1X2+DC mi-temps. Meme cross-check DC vs 1X2 par mi-temps.
  for (const [pfx, lbl] of [['ht_', '1MT'], ['h2_', '2MT']]) {
    const dcAhalf = dcCoherence(oa, pfx), dcBhalf = dcCoherence(ob, pfx);
    for (const [sk, dk, aL, bL] of [
      ['match_1', 'dc_X2', 'Domicile', 'Nul ou Ext.'],
      ['match_2', 'dc_1X', 'Extérieur', 'Dom. ou Nul'],
      ['match_X', 'dc_12', 'Nul', 'Un gagnant'],
    ]) {
      if (dcBhalf[dk]) pushArb(out, `${lbl} 1X2 — ${aL}`, aL, oa[`${pfx}${sk}`], bookA, bL, ob[`${pfx}${dk}`], bookB, idsOf(oa, `${pfx}${sk}`), idsOf(ob, `${pfx}${dk}`));
      if (dcAhalf[dk]) pushArb(out, `${lbl} 1X2 — ${aL}`, aL, ob[`${pfx}${sk}`], bookB, bL, oa[`${pfx}${dk}`], bookA, idsOf(ob, `${pfx}${sk}`), idsOf(oa, `${pfx}${dk}`));
    }
  }
  // BTTS par mi-temps — meme cross-book coherence check.
  for (const [pfx, lbl] of [['ht_', '1MT BTTS'], ['h2_', '2MT BTTS']]) {
    if (crossBookImpliedProbOK(oa, ob, `${pfx}btts_yes`, `${pfx}btts_no`)) {
      pushArb(out, lbl, 'Oui', oa[`${pfx}btts_yes`], bookA, 'Non', ob[`${pfx}btts_no`], bookB, idsOf(oa, `${pfx}btts_yes`), idsOf(ob, `${pfx}btts_no`));
      pushArb(out, lbl, 'Oui', ob[`${pfx}btts_yes`], bookB, 'Non', oa[`${pfx}btts_no`], bookA, idsOf(ob, `${pfx}btts_yes`), idsOf(oa, `${pfx}btts_no`));
    }
  }
  // DNB par mi-temps — meme cross-check.
  const dnbAht = dnbCoherence(oa, 'ht_'), dnbBht = dnbCoherence(ob, 'ht_');
  if (dnbBht.dnb_2) pushArb(out, '1MT Draw No Bet', 'Dom. (DNB)', oa.ht_dnb_1, bookA, 'Ext. (DNB)', ob.ht_dnb_2, bookB, idsOf(oa, 'ht_dnb_1'), idsOf(ob, 'ht_dnb_2'));
  if (dnbAht.dnb_2) pushArb(out, '1MT Draw No Bet', 'Dom. (DNB)', ob.ht_dnb_1, bookB, 'Ext. (DNB)', oa.ht_dnb_2, bookA, idsOf(ob, 'ht_dnb_1'), idsOf(oa, 'ht_dnb_2'));
  const dnbAh2 = dnbCoherence(oa, 'h2_'), dnbBh2 = dnbCoherence(ob, 'h2_');
  if (dnbBh2.dnb_2) pushArb(out, '2MT Draw No Bet', 'Dom. (DNB)', oa.h2_dnb_1, bookA, 'Ext. (DNB)', ob.h2_dnb_2, bookB, idsOf(oa, 'h2_dnb_1'), idsOf(ob, 'h2_dnb_2'));
  if (dnbAh2.dnb_2) pushArb(out, '2MT Draw No Bet', 'Dom. (DNB)', ob.h2_dnb_1, bookB, 'Ext. (DNB)', oa.h2_dnb_2, bookA, idsOf(ob, 'h2_dnb_1'), idsOf(oa, 'h2_dnb_2'));
  // Pair/Impair.
  pushArb(out, 'Pair/Impair', 'Impair', oa.odd, bookA, 'Pair', ob.even, bookB, idsOf(oa, 'odd'), idsOf(ob, 'even'));
  pushArb(out, 'Pair/Impair', 'Impair', ob.odd, bookB, 'Pair', oa.even, bookA, idsOf(ob, 'odd'), idsOf(oa, 'even'));
  for (const [pfx, lbl] of [['ht_', '1MT Pair/Impair'], ['h2_', '2MT Pair/Impair']]) {
    pushArb(out, lbl, 'Impair', oa[`${pfx}odd`], bookA, 'Pair', ob[`${pfx}even`], bookB, idsOf(oa, `${pfx}odd`), idsOf(ob, `${pfx}even`));
    pushArb(out, lbl, 'Impair', ob[`${pfx}odd`], bookB, 'Pair', oa[`${pfx}even`], bookA, idsOf(ob, `${pfx}odd`), idsOf(oa, `${pfx}even`));
  }
  // Handicap FOOT par mi-temps — meme convention "Handicap" (pas asiatique).
  // isHalfLine filtre les demi-lignes (0.5/1.5/2.5...) = handicap simple.
  for (const [pfx, lbl] of [['ht_', '1MT Handicap'], ['h2_', '2MT Handicap']]) {
    for (const l of linesOf(oa, ob, new RegExp(`^${pfx}hcp_home_(-?\\d+(?:\\.\\d+)?)$`))) {
      const lNum = parseFloat(l);
      const hk = `${pfx}hcp_home_${l}`, ak = `${pfx}hcp_away_${-lNum}`;
      const fam = `${lbl} ${lNum > 0 ? '+' + l : l}`;
      pushArb(out, fam, `Dom. ${lNum > 0 ? '+' + l : l}`, oa[hk], bookA, `Ext. ${-lNum > 0 ? '+' + (-lNum) : -lNum}`, ob[ak], bookB, idsOf(oa, hk), idsOf(ob, ak));
      pushArb(out, fam, `Dom. ${lNum > 0 ? '+' + l : l}`, ob[hk], bookB, `Ext. ${-lNum > 0 ? '+' + (-lNum) : -lNum}`, oa[ak], bookA, idsOf(ob, hk), idsOf(oa, ak));
    }
  }
  // Totaux individuels par mi-temps — lignes DYNAMIQUES.
  for (const [pfx, lbl] of [['ht_', '1MT'], ['h2_', '2MT']]) {
    for (const [side, teamLbl] of [['home', 'Dom.'], ['away', 'Ext.']]) {
      for (const l of linesOf(oa, ob, new RegExp(`^${pfx}tt_${side}_(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
        const ok = `${pfx}tt_${side}_over_${l}`, uk = `${pfx}tt_${side}_under_${l}`;
        const fam = `${lbl} Total ${teamLbl} ${l}`;
        pushArb(out, fam, `${teamLbl} +${l}`, oa[ok], bookA, `${teamLbl} −${l}`, ob[uk], bookB, idsOf(oa, ok), idsOf(ob, uk));
        pushArb(out, fam, `${teamLbl} +${l}`, ob[ok], bookB, `${teamLbl} −${l}`, oa[uk], bookA, idsOf(ob, ok), idsOf(oa, uk));
      }
    }
  }
  // Corners handicap.
  for (const l of linesOf(oa, ob, /^cor_hcp_home_(-?\d+(?:\.\d+)?)$/)) {
    const hk = `cor_hcp_home_${l}`, ak = `cor_hcp_away_${-parseFloat(l)}`;
    const fam = `Corners Handicap ${parseFloat(l) > 0 ? '+' + l : l}`;
    pushArb(out, fam, `Dom. ${parseFloat(l) > 0 ? '+' + l : l}`, oa[hk], bookA, `Ext. ${-parseFloat(l) > 0 ? '+' + (-parseFloat(l)) : -parseFloat(l)}`, ob[ak], bookB, idsOf(oa, hk), idsOf(ob, ak));
    pushArb(out, fam, `Dom. ${parseFloat(l) > 0 ? '+' + l : l}`, ob[hk], bookB, `Ext. ${-parseFloat(l) > 0 ? '+' + (-parseFloat(l)) : -parseFloat(l)}`, oa[ak], bookA, idsOf(ob, hk), idsOf(oa, ak));
  }
  // Corners pair/impair.
  pushArb(out, 'Corners Pair/Impair', 'Impair', oa.cor_odd, bookA, 'Pair', ob.cor_even, bookB, idsOf(oa, 'cor_odd'), idsOf(ob, 'cor_even'));
  pushArb(out, 'Corners Pair/Impair', 'Impair', ob.cor_odd, bookB, 'Pair', oa.cor_even, bookA, idsOf(ob, 'cor_odd'), idsOf(oa, 'cor_even'));
  // Corners 1MT total.
  for (const l of linesOf(oa, ob, /^cor_ht_(?:over|under)_(\d+(?:\.\d+)?)$/)) {
    pushArb(out, `Corners 1MT Total ${l}`, `+${l}`, oa[`cor_ht_over_${l}`], bookA, `−${l}`, ob[`cor_ht_under_${l}`], bookB, idsOf(oa, `cor_ht_over_${l}`), idsOf(ob, `cor_ht_under_${l}`));
    pushArb(out, `Corners 1MT Total ${l}`, `+${l}`, ob[`cor_ht_over_${l}`], bookB, `−${l}`, oa[`cor_ht_under_${l}`], bookA, idsOf(ob, `cor_ht_over_${l}`), idsOf(oa, `cor_ht_under_${l}`));
  }
  // Corners 1MT handicap.
  for (const l of linesOf(oa, ob, /^cor_ht_hcp_home_(-?\d+(?:\.\d+)?)$/)) {
    const hk = `cor_ht_hcp_home_${l}`, ak = `cor_ht_hcp_away_${-parseFloat(l)}`;
    const fam = `Corners 1MT Handicap ${parseFloat(l) > 0 ? '+' + l : l}`;
    pushArb(out, fam, `Dom. ${parseFloat(l) > 0 ? '+' + l : l}`, oa[hk], bookA, `Ext. ${-parseFloat(l) > 0 ? '+' + (-parseFloat(l)) : -parseFloat(l)}`, ob[ak], bookB, idsOf(oa, hk), idsOf(ob, ak));
    pushArb(out, fam, `Dom. ${parseFloat(l) > 0 ? '+' + l : l}`, ob[hk], bookB, `Ext. ${-parseFloat(l) > 0 ? '+' + (-parseFloat(l)) : -parseFloat(l)}`, oa[ak], bookA, idsOf(ob, hk), idsOf(oa, ak));
  }
  // Corners 1MT pair/impair.
  pushArb(out, 'Corners 1MT Pair/Impair', 'Impair', oa.cor_ht_odd, bookA, 'Pair', ob.cor_ht_even, bookB, idsOf(oa, 'cor_ht_odd'), idsOf(ob, 'cor_ht_even'));
  pushArb(out, 'Corners 1MT Pair/Impair', 'Impair', ob.cor_ht_odd, bookB, 'Pair', oa.cor_ht_even, bookA, idsOf(ob, 'cor_ht_odd'), idsOf(oa, 'cor_ht_even'));
  // Corners Matchbet 1X2 (FT) — 3-way avec pushArbPeriodWinner.
  pushArbPeriodWinner(out, 'Corners', oa, ob, bookA, bookB, 'cor_');
  pushArbPeriodWinner(out, 'Corners', ob, oa, bookB, bookA, 'cor_');
  // Corners Matchbet 1X2 (1MT) — 3-way.
  pushArbPeriodWinner(out, 'Corners 1MT', oa, ob, bookA, bookB, 'cor_ht_');
  pushArbPeriodWinner(out, 'Corners 1MT', ob, oa, bookB, bookA, 'cor_ht_');
  // HT/H2 individual totals (par mi-temps).
  for (const [pfx, lbl] of [['ht_', '1MT'], ['h2_', '2MT']]) {
    for (const [side, teamLbl] of [['home', 'Dom.'], ['away', 'Ext.']]) {
      for (const l of linesOf(oa, ob, new RegExp(`^${pfx}tt_${side}_(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
        const ok = `${pfx}tt_${side}_over_${l}`, uk = `${pfx}tt_${side}_under_${l}`;
        const fam = `${lbl} Total ${teamLbl} ${l}`;
        pushArb(out, fam, `${teamLbl} +${l}`, oa[ok], bookA, `${teamLbl} −${l}`, ob[uk], bookB, idsOf(oa, ok), idsOf(ob, uk));
        pushArb(out, fam, `${teamLbl} +${l}`, ob[ok], bookB, `${teamLbl} −${l}`, oa[uk], bookA, idsOf(ob, ok), idsOf(oa, uk));
      }
    }
  }
  // Full-match individual totals (total buts par équipe sur tout le match) —
  // marché standard émis par BetMomo/Apollo/Congobet. Manquait au comparateur foot.
  for (const [side, teamLbl] of [['home', 'Dom.'], ['away', 'Ext.']]) {
    for (const l of linesOf(oa, ob, new RegExp(`^tt_${side}_(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
      const ok = `tt_${side}_over_${l}`, uk = `tt_${side}_under_${l}`;
      const fam = `Total ${teamLbl} ${l}`;
      pushArb(out, fam, `${teamLbl} +${l}`, oa[ok], bookA, `${teamLbl} −${l}`, ob[uk], bookB, idsOf(oa, ok), idsOf(ob, uk));
      pushArb(out, fam, `${teamLbl} +${l}`, ob[ok], bookB, `${teamLbl} −${l}`, oa[uk], bookA, idsOf(ob, ok), idsOf(oa, uk));
    }
  }
  // ═══ Nouveaux marchés cross-book (audit Congobet + Apollo 2026-08-13) ═══
  // Team Clean Sheet (2-way Yes/No) — Congobet 10013/10014, Apollo 901/902
  for (const side of ['home', 'away']) {
    const yk = `cs_${side}_yes`, nk = `cs_${side}_no`;
    const lbl = side === 'home' ? 'Domicile' : 'Extérieur';
    const fam = `Clean Sheet ${lbl}`;
    if (oa[yk] && ob[nk] && crossBookImpliedProbOK(oa, ob, yk, nk)) {
      pushArb(out, fam, 'Oui', oa[yk], bookA, 'Non', ob[nk], bookB, idsOf(oa, yk), idsOf(ob, nk));
    }
    if (ob[yk] && oa[nk] && crossBookImpliedProbOK(ob, oa, yk, nk)) {
      pushArb(out, fam, 'Oui', ob[yk], bookB, 'Non', oa[nk], bookA, idsOf(ob, yk), idsOf(oa, nk));
    }
  }
  // Team goals Odd/Even (2-way) — Congobet 10089/10090, Apollo 965/966
  for (const side of ['home', 'away']) {
    const ok = `tt_${side}_odd`, ek = `tt_${side}_even`;
    const lbl = side === 'home' ? 'Domicile' : 'Extérieur';
    const fam = `Buts ${lbl} Pair/Impair`;
    pushArb(out, fam, 'Impair', oa[ok], bookA, 'Pair', ob[ek], bookB, idsOf(oa, ok), idsOf(ob, ek));
    pushArb(out, fam, 'Impair', ob[ok], bookB, 'Pair', oa[ek], bookA, idsOf(ob, ok), idsOf(oa, ek));
  }
  // Team scores each half (2-way Y/N) — Congobet 10032/10033 (autres books à activer)
  for (const side of ['home', 'away']) {
    const yk = `tt_${side}_score_each_half_yes`, nk = `tt_${side}_score_each_half_no`;
    const lbl = side === 'home' ? 'Domicile' : 'Extérieur';
    const fam = `${lbl} marque chaque mi-temps`;
    if (oa[yk] && ob[nk]) pushArb(out, fam, 'Oui', oa[yk], bookA, 'Non', ob[nk], bookB, idsOf(oa, yk), idsOf(ob, nk));
    if (ob[yk] && oa[nk]) pushArb(out, fam, 'Oui', ob[yk], bookB, 'Non', oa[nk], bookA, idsOf(ob, yk), idsOf(oa, nk));
  }
  // Team wins both halves (2-way Y/N)
  for (const side of ['home', 'away']) {
    const yk = `tt_${side}_wins_both_halves_yes`, nk = `tt_${side}_wins_both_halves_no`;
    const lbl = side === 'home' ? 'Domicile' : 'Extérieur';
    const fam = `${lbl} gagne les 2 MT`;
    if (oa[yk] && ob[nk]) pushArb(out, fam, 'Oui', oa[yk], bookA, 'Non', ob[nk], bookB, idsOf(oa, yk), idsOf(ob, nk));
    if (ob[yk] && oa[nk]) pushArb(out, fam, 'Oui', ob[yk], bookB, 'Non', oa[nk], bookA, idsOf(ob, yk), idsOf(oa, nk));
  }
  // Team wins to nil (2-way Y/N)
  for (const side of ['home', 'away']) {
    const yk = `tt_${side}_wins_to_nil_yes`, nk = `tt_${side}_wins_to_nil_no`;
    const lbl = side === 'home' ? 'Domicile' : 'Extérieur';
    const fam = `${lbl} gagne sans encaisser`;
    if (oa[yk] && ob[nk]) pushArb(out, fam, 'Oui', oa[yk], bookA, 'Non', ob[nk], bookB, idsOf(oa, yk), idsOf(ob, nk));
    if (ob[yk] && oa[nk]) pushArb(out, fam, 'Oui', ob[yk], bookB, 'Non', oa[nk], bookA, idsOf(ob, yk), idsOf(oa, nk));
  }
  // Team wins at least one half (2-way Y/N)
  for (const side of ['home', 'away']) {
    const yk = `tt_${side}_wins_atleast_one_half_yes`, nk = `tt_${side}_wins_atleast_one_half_no`;
    const lbl = side === 'home' ? 'Domicile' : 'Extérieur';
    const fam = `${lbl} gagne au moins 1 MT`;
    if (oa[yk] && ob[nk]) pushArb(out, fam, 'Oui', oa[yk], bookA, 'Non', ob[nk], bookB, idsOf(oa, yk), idsOf(ob, nk));
    if (ob[yk] && oa[nk]) pushArb(out, fam, 'Oui', ob[yk], bookB, 'Non', oa[nk], bookA, idsOf(ob, yk), idsOf(oa, nk));
  }
  // BTTS each half (2-way Y/N)
  if (oa.btts_each_half_yes && ob.btts_each_half_no) {
    pushArb(out, 'BTTS chaque MT', 'Oui', oa.btts_each_half_yes, bookA, 'Non', ob.btts_each_half_no, bookB, idsOf(oa, 'btts_each_half_yes'), idsOf(ob, 'btts_each_half_no'));
  }
  if (ob.btts_each_half_yes && oa.btts_each_half_no) {
    pushArb(out, 'BTTS chaque MT', 'Oui', ob.btts_each_half_yes, bookB, 'Non', oa.btts_each_half_no, bookA, idsOf(ob, 'btts_each_half_yes'), idsOf(oa, 'btts_each_half_no'));
  }
  // Over/Under 1.5 each half (2-way Y/N) — 2 marchés séparés (over each / under each)
  if (oa['over_1.5_each_half_yes'] && ob['over_1.5_each_half_no']) {
    pushArb(out, 'Plus 1.5 buts chaque MT', 'Oui', oa['over_1.5_each_half_yes'], bookA, 'Non', ob['over_1.5_each_half_no'], bookB, idsOf(oa, 'over_1.5_each_half_yes'), idsOf(ob, 'over_1.5_each_half_no'));
  }
  if (ob['over_1.5_each_half_yes'] && oa['over_1.5_each_half_no']) {
    pushArb(out, 'Plus 1.5 buts chaque MT', 'Oui', ob['over_1.5_each_half_yes'], bookB, 'Non', oa['over_1.5_each_half_no'], bookA, idsOf(ob, 'over_1.5_each_half_yes'), idsOf(oa, 'over_1.5_each_half_no'));
  }
  // Team clean sheet par mi-temps (1MT / 2MT)
  for (const [pfx, lbl] of [['ht_', '1MT'], ['h2_', '2MT']]) {
    for (const side of ['home', 'away']) {
      const yk = `${pfx}cs_${side}_yes`, nk = `${pfx}cs_${side}_no`;
      const sideLbl = side === 'home' ? 'Domicile' : 'Extérieur';
      const fam = `${lbl} Clean Sheet ${sideLbl}`;
      if (oa[yk] && ob[nk]) pushArb(out, fam, 'Oui', oa[yk], bookA, 'Non', ob[nk], bookB, idsOf(oa, yk), idsOf(ob, nk));
      if (ob[yk] && oa[nk]) pushArb(out, fam, 'Oui', ob[yk], bookB, 'Non', oa[nk], bookA, idsOf(ob, yk), idsOf(oa, nk));
    }
  }
  // Note : les opps 3-way (1ère équipe à marquer, mi-temps la plus prolifique)
  // étaient génerées via pushArb3 mais leur `market_family` "... (3 issues)"
  // n'est pas reconstructible par marketKeyFromOpp, donc rejetées noKey au
  // re-fetch confirm. Rares en pratique et peu actionnables — retirées pour
  // éliminer le bruit dans la distribution des rejets.
  return out;
}

// Detecte si les 2 books ont inverse home/away pour le meme match. En tennis
// il n'y a pas de vrai "home", l'ordre J1/J2 est arbitraire par book. Si les
// noms de "home" sont differents entre books (matchA.home ~ matchB.away plus
// que matchA.home ~ matchB.home), on doit flipper les cotes du book B pour
// que les comparaisons hcp_home_X ↔ hcp_away_-X soient valides.
function orientationsInverted(matchA, matchB) {
  if (!matchA?.home || !matchB?.home || !matchA?.away || !matchB?.away) return false;
  const sameHome = teamSim(matchA.home, matchB.home);
  const invHome = teamSim(matchA.home, matchB.away);
  const sameAway = teamSim(matchA.away, matchB.away);
  const invAway = teamSim(matchA.away, matchB.home);
  // Inversion : matchA.home est plus proche de matchB.away que de matchB.home
  // ET matchA.away est plus proche de matchB.home que de matchB.away
  return invHome > sameHome + 0.15 && invAway > sameAway + 0.15;
}

// Flippe home ↔ away pour toutes les cles de tennis. Applique aux cotes du
// book B quand orientationsInverted() detecte que J1/J2 sont echanges vs A.
function flipTennisOdds(odds) {
  const out = {};
  const swapHomeAway = (k) => {
    // match_1 ↔ match_2 (winner)
    if (k === 'match_1') return 'match_2';
    if (k === 'match_2') return 'match_1';
    // sN_match_1 ↔ sN_match_2
    let m = k.match(/^(s[1-5])_match_1$/);
    if (m) return `${m[1]}_match_2`;
    m = k.match(/^(s[1-5])_match_2$/);
    if (m) return `${m[1]}_match_1`;
    // hcp_home_X ↔ hcp_away_-X (signe s'inverse aussi)
    m = k.match(/^hcp_home_(-?\d+(?:\.\d+)?)$/);
    if (m) return `hcp_away_${-parseFloat(m[1])}`;
    m = k.match(/^hcp_away_(-?\d+(?:\.\d+)?)$/);
    if (m) return `hcp_home_${-parseFloat(m[1])}`;
    // sN_hcp_home_X ↔ sN_hcp_away_-X
    m = k.match(/^(s[1-5])_hcp_home_(-?\d+(?:\.\d+)?)$/);
    if (m) return `${m[1]}_hcp_away_${-parseFloat(m[2])}`;
    m = k.match(/^(s[1-5])_hcp_away_(-?\d+(?:\.\d+)?)$/);
    if (m) return `${m[1]}_hcp_home_${-parseFloat(m[2])}`;
    // hcp_sets_home_X ↔ hcp_sets_away_-X
    m = k.match(/^hcp_sets_home_(-?\d+(?:\.\d+)?)$/);
    if (m) return `hcp_sets_away_${-parseFloat(m[1])}`;
    m = k.match(/^hcp_sets_away_(-?\d+(?:\.\d+)?)$/);
    if (m) return `hcp_sets_home_${-parseFloat(m[1])}`;
    // tt_home ↔ tt_away
    m = k.match(/^tt_home_(over|under)_(\d+(?:\.\d+)?)$/);
    if (m) return `tt_away_${m[1]}_${m[2]}`;
    m = k.match(/^tt_away_(over|under)_(\d+(?:\.\d+)?)$/);
    if (m) return `tt_home_${m[1]}_${m[2]}`;
    // Neutres : totals match, total_sets, odd/even, sN_over/under
    return k;
  };
  for (const [k, v] of Object.entries(odds)) out[swapHomeAway(k)] = v;
  return out;
}

// Comparateur TENNIS 2-way (pas de nul → pas de DC, pas de BTTS, pas de DNB).
// Marches supportes :
// - Vainqueur du Match       (match_1 vs match_2, croisé cross-book)
// - Handicap Jeux X          (hcp_home_X vs hcp_away_-X)
// - Total Jeux Match X       (match_over_X vs match_under_X)
// - Total Jeux J1/J2 X       (tt_home/tt_away over/under)
// - Total Sets X             (total_sets_over/under)
// - Handicap Sets X          (hcp_sets_home_X vs hcp_sets_away_-X)
// - Vainqueur Set N          (sN_match_1 vs sN_match_2)
// - Handicap Jeux Set N X    (sN_hcp_home_X vs sN_hcp_away_-X)
// - Total Jeux Set N X       (sN_over_X vs sN_under_X)
// - Pair/Impair Jeux         (odd vs even)
export function compareTennisTwoBooks(rawA, bookA, rawB, bookB, matchA = null, matchB = null) {
  const oa = normalizeAliases(rawA);
  let ob = normalizeAliases(rawB);
  // Fix fake arbs 40%+ : si les 2 books ont inverse J1/J2 pour ce match, on
  // flippe les cotes du book B pour aligner les orientations. Sinon on
  // compare hcp_home_-2.5 de A (Duckworth doit gagner de +3) avec hcp_away_+2.5
  // de B (Duckworth outsider avec avantage) → fake arb.
  if (orientationsInverted(matchA, matchB)) {
    ob = flipTennisOdds(ob);
  }
  if (staleBookMismatch(oa, ob)) return [];
  const out = [];

  // Vainqueur du Match : 2-way sans nul. match_1 vs match_2 sont complementaires.
  pushArb(out, 'Vainqueur du Match', 'Joueur 1', oa.match_1, bookA, 'Joueur 2', ob.match_2, bookB, idsOf(oa, 'match_1'), idsOf(ob, 'match_2'));
  pushArb(out, 'Vainqueur du Match', 'Joueur 1', ob.match_1, bookB, 'Joueur 2', oa.match_2, bookA, idsOf(ob, 'match_1'), idsOf(oa, 'match_2'));

  // Handicap Jeux (games handicap) — signe positif = avantage
  for (const l of linesOf(oa, ob, /^hcp_home_(-?\d+(?:\.\d+)?)$/)) {
    const lNum = parseFloat(l);
    const hk = `hcp_home_${l}`, ak = `hcp_away_${-lNum}`;
    const sign = lNum > 0 ? '+' + l : l;
    const fam = `Handicap Jeux ${sign}`;
    pushArb(out, fam, `J1 ${sign}`, oa[hk], bookA, `J2 ${-lNum > 0 ? '+' + (-lNum) : -lNum}`, ob[ak], bookB, idsOf(oa, hk), idsOf(ob, ak));
    pushArb(out, fam, `J1 ${sign}`, ob[hk], bookB, `J2 ${-lNum > 0 ? '+' + (-lNum) : -lNum}`, oa[ak], bookA, idsOf(ob, hk), idsOf(oa, ak));
  }

  // Total Jeux du match
  for (const l of linesOf(oa, ob, /^match_(?:over|under)_(\d+(?:\.\d+)?)$/)) {
    const fam = `Total Jeux Match ${l}`;
    pushArb(out, fam, `+${l}`, oa[`match_over_${l}`], bookA, `−${l}`, ob[`match_under_${l}`], bookB, idsOf(oa, `match_over_${l}`), idsOf(ob, `match_under_${l}`));
    pushArb(out, fam, `+${l}`, ob[`match_over_${l}`], bookB, `−${l}`, oa[`match_under_${l}`], bookA, idsOf(ob, `match_over_${l}`), idsOf(oa, `match_under_${l}`));
  }

  // Total Jeux par joueur (tt_home = J1, tt_away = J2)
  for (const [side, lbl] of [['home', 'J1'], ['away', 'J2']]) {
    for (const l of linesOf(oa, ob, new RegExp(`^tt_${side}_(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
      const ok = `tt_${side}_over_${l}`, uk = `tt_${side}_under_${l}`;
      const fam = `Total Jeux ${lbl} ${l}`;
      pushArb(out, fam, `${lbl} +${l}`, oa[ok], bookA, `${lbl} −${l}`, ob[uk], bookB, idsOf(oa, ok), idsOf(ob, uk));
      pushArb(out, fam, `${lbl} +${l}`, ob[ok], bookB, `${lbl} −${l}`, oa[uk], bookA, idsOf(ob, ok), idsOf(oa, uk));
    }
  }

  // Total Sets (nombre de sets du match)
  for (const l of linesOf(oa, ob, /^total_sets_(?:over|under)_(\d+(?:\.\d+)?)$/)) {
    const fam = `Total Sets ${l}`;
    pushArb(out, fam, `+${l}`, oa[`total_sets_over_${l}`], bookA, `−${l}`, ob[`total_sets_under_${l}`], bookB, idsOf(oa, `total_sets_over_${l}`), idsOf(ob, `total_sets_under_${l}`));
    pushArb(out, fam, `+${l}`, ob[`total_sets_over_${l}`], bookB, `−${l}`, oa[`total_sets_under_${l}`], bookA, idsOf(ob, `total_sets_over_${l}`), idsOf(oa, `total_sets_under_${l}`));
  }

  // Passerelle de notation : certains books cotent le NOMBRE EXACT de sets
  // (total_sets_2 = "match en 2 sets") au lieu d'une ligne over/under. "2 sets
  // exactement" et "plus de 2.5 sets" sont strictement complementaires quel que
  // soit le format (best-of-3 comme best-of-5) : l'un ou l'autre arrive toujours.
  // On ne relie PAS total_sets_2 a total_sets_3 : en best-of-5 (Grand Chelem) un
  // match peut faire 4 ou 5 sets, la paire ne couvrirait pas toutes les issues.
  pushArb(out, 'Total Sets 2.5', '2 sets', oa.total_sets_2, bookA, '3 sets ou +', ob['total_sets_over_2.5'], bookB, idsOf(oa, 'total_sets_2'), idsOf(ob, 'total_sets_over_2.5'));
  pushArb(out, 'Total Sets 2.5', '2 sets', ob.total_sets_2, bookB, '3 sets ou +', oa['total_sets_over_2.5'], bookA, idsOf(ob, 'total_sets_2'), idsOf(oa, 'total_sets_over_2.5'));

  // Handicap Sets
  for (const l of linesOf(oa, ob, /^hcp_sets_home_(-?\d+(?:\.\d+)?)$/)) {
    const lNum = parseFloat(l);
    const hk = `hcp_sets_home_${l}`, ak = `hcp_sets_away_${-lNum}`;
    const sign = lNum > 0 ? '+' + l : l;
    const fam = `Handicap Sets ${sign}`;
    pushArb(out, fam, `J1 ${sign}`, oa[hk], bookA, `J2 ${-lNum > 0 ? '+' + (-lNum) : -lNum}`, ob[ak], bookB, idsOf(oa, hk), idsOf(ob, ak));
    pushArb(out, fam, `J1 ${sign}`, ob[hk], bookB, `J2 ${-lNum > 0 ? '+' + (-lNum) : -lNum}`, oa[ak], bookA, idsOf(ob, hk), idsOf(oa, ak));
  }

  // Marches par set : Vainqueur, Handicap (sur les jeux du set), Total Jeux
  // Labels ordinaux FR clairs : "1er Set" / "2e Set" etc. Handicap ici = handicap
  // sur les jeux gagnes DANS le set (different de "Handicap Sets" qui porte sur
  // le nombre total de sets du match). Ancien "Handicap Jeux Set N" ambigu →
  // renomme "Handicap 1er Set" (jeux implicite, plus court, plus clair FR).
  const ORDINAL = ['1er', '2e', '3e', '4e', '5e'];
  for (const n of ['1', '2', '3', '4', '5']) {
    const pfx = `s${n}_`;
    const ord = ORDINAL[parseInt(n, 10) - 1];
    // Vainqueur du Set
    pushArb(out, `Vainqueur ${ord} Set`, 'J1', oa[`${pfx}match_1`], bookA, 'J2', ob[`${pfx}match_2`], bookB, idsOf(oa, `${pfx}match_1`), idsOf(ob, `${pfx}match_2`));
    pushArb(out, `Vainqueur ${ord} Set`, 'J1', ob[`${pfx}match_1`], bookB, 'J2', oa[`${pfx}match_2`], bookA, idsOf(ob, `${pfx}match_1`), idsOf(oa, `${pfx}match_2`));
    // Handicap DANS le set (sur les jeux gagnes de ce set)
    for (const l of linesOf(oa, ob, new RegExp(`^${pfx}hcp_home_(-?\\d+(?:\\.\\d+)?)$`))) {
      const lNum = parseFloat(l);
      const hk = `${pfx}hcp_home_${l}`, ak = `${pfx}hcp_away_${-lNum}`;
      const sign = lNum > 0 ? '+' + l : l;
      const fam = `Handicap ${ord} Set ${sign}`;
      pushArb(out, fam, `J1 ${sign}`, oa[hk], bookA, `J2 ${-lNum > 0 ? '+' + (-lNum) : -lNum}`, ob[ak], bookB, idsOf(oa, hk), idsOf(ob, ak));
      pushArb(out, fam, `J1 ${sign}`, ob[hk], bookB, `J2 ${-lNum > 0 ? '+' + (-lNum) : -lNum}`, oa[ak], bookA, idsOf(ob, hk), idsOf(oa, ak));
    }
    // Total jeux du set
    for (const l of linesOf(oa, ob, new RegExp(`^${pfx}(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
      const fam = `Total Jeux ${ord} Set ${l}`;
      pushArb(out, fam, `+${l}`, oa[`${pfx}over_${l}`], bookA, `−${l}`, ob[`${pfx}under_${l}`], bookB, idsOf(oa, `${pfx}over_${l}`), idsOf(ob, `${pfx}under_${l}`));
      pushArb(out, fam, `+${l}`, ob[`${pfx}over_${l}`], bookB, `−${l}`, oa[`${pfx}under_${l}`], bookA, idsOf(ob, `${pfx}over_${l}`), idsOf(oa, `${pfx}under_${l}`));
    }
  }

  // Pair/Impair jeux
  pushArb(out, 'Pair/Impair Jeux', 'Impair', oa.odd, bookA, 'Pair', ob.even, bookB, idsOf(oa, 'odd'), idsOf(ob, 'even'));
  pushArb(out, 'Pair/Impair Jeux', 'Impair', ob.odd, bookB, 'Pair', oa.even, bookA, idsOf(ob, 'odd'), idsOf(oa, 'even'));

  // ═══ Nouveaux marchés tennis (audit Congobet + Apollo 2026-08-13) ═══
  // Team wins a set (2-way Y/N) — Congobet 10050/10053, Apollo 211/212
  for (const side of ['home', 'away']) {
    const yk = `tt_${side}_wins_a_set_yes`, nk = `tt_${side}_wins_a_set_no`;
    const lbl = side === 'home' ? 'J1' : 'J2';
    const fam = `${lbl} gagne un set`;
    if (oa[yk] && ob[nk]) pushArb(out, fam, 'Oui', oa[yk], bookA, 'Non', ob[nk], bookB, idsOf(oa, yk), idsOf(ob, nk));
    if (ob[yk] && oa[nk]) pushArb(out, fam, 'Oui', ob[yk], bookB, 'Non', oa[nk], bookA, idsOf(ob, yk), idsOf(oa, nk));
  }
  // 6-0 possible (Y/N) — Congobet 10049, Apollo 852
  if (oa.set_60_yes && ob.set_60_no) pushArb(out, 'Set 6-0 possible', 'Oui', oa.set_60_yes, bookA, 'Non', ob.set_60_no, bookB, idsOf(oa, 'set_60_yes'), idsOf(ob, 'set_60_no'));
  if (ob.set_60_yes && oa.set_60_no) pushArb(out, 'Set 6-0 possible', 'Oui', ob.set_60_yes, bookB, 'Non', oa.set_60_no, bookA, idsOf(ob, 'set_60_yes'), idsOf(oa, 'set_60_no'));

  return out;
}

// Comparateur BASKET 2-way (marchés incl. OT majoritaires).
// Convention keys : match_/hcp_/tt_ + prefixes q1_/q2_/q3_/q4_/h1_/h2_.
// Pas de flip home/away (basket a des équipes home/away claires, contrairement
// au tennis où J1/J2 est arbitraire par book).
// Marchés supportés :
//   - Vainqueur du Match          (match_1 vs match_2)
//   - Handicap Points X           (hcp_home_X vs hcp_away_-X)
//   - Total Points Match X        (match_over_X vs match_under_X)
//   - Total Points Dom./Ext. X    (tt_home/away over/under)
//   - Pair/Impair Points          (odd vs even)
//   Par quarter Q1..Q4 (qN_)      : Vainqueur, Total, Handicap, Odd/Even
//   Par mi-temps H1/H2 (hN_)      : Vainqueur, Total, Handicap, Odd/Even, TT
export function compareBasketTwoBooks(rawA, bookA, rawB, bookB) {
  const oa = normalizeAliases(rawA);
  const ob = normalizeAliases(rawB);
  if (staleBookMismatch(oa, ob)) return [];
  const out = [];

  // Vainqueur du Match : 2-way.
  pushArb(out, 'Vainqueur du Match', 'Dom.', oa.match_1, bookA, 'Ext.', ob.match_2, bookB, idsOf(oa, 'match_1'), idsOf(ob, 'match_2'));
  pushArb(out, 'Vainqueur du Match', 'Dom.', ob.match_1, bookB, 'Ext.', oa.match_2, bookA, idsOf(ob, 'match_1'), idsOf(oa, 'match_2'));

  // Handicap Points (asian handicap sur points, ±L).
  for (const l of linesOf(oa, ob, /^hcp_home_(-?\d+(?:\.\d+)?)$/)) {
    const lNum = parseFloat(l);
    const hk = `hcp_home_${l}`, ak = `hcp_away_${-lNum}`;
    const sign = lNum > 0 ? '+' + l : l;
    const fam = `Handicap Points ${sign}`;
    const aL = `Dom. ${sign}`;
    const bL = `Ext. ${-lNum > 0 ? '+' + (-lNum) : -lNum}`;
    pushArb(out, fam, aL, oa[hk], bookA, bL, ob[ak], bookB, idsOf(oa, hk), idsOf(ob, ak));
    pushArb(out, fam, aL, ob[hk], bookB, bL, oa[ak], bookA, idsOf(ob, hk), idsOf(oa, ak));
  }

  // Total Points match.
  for (const l of linesOf(oa, ob, /^match_(?:over|under)_(\d+(?:\.\d+)?)$/)) {
    const fam = `Total Points Match ${l}`;
    pushArb(out, fam, `+${l}`, oa[`match_over_${l}`], bookA, `−${l}`, ob[`match_under_${l}`], bookB, idsOf(oa, `match_over_${l}`), idsOf(ob, `match_under_${l}`));
    pushArb(out, fam, `+${l}`, ob[`match_over_${l}`], bookB, `−${l}`, oa[`match_under_${l}`], bookA, idsOf(ob, `match_over_${l}`), idsOf(oa, `match_under_${l}`));
  }

  // Total Points individuel (Dom./Ext.).
  for (const [side, lbl] of [['home', 'Dom.'], ['away', 'Ext.']]) {
    for (const l of linesOf(oa, ob, new RegExp(`^tt_${side}_(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
      const ok = `tt_${side}_over_${l}`, uk = `tt_${side}_under_${l}`;
      const fam = `Total Points ${lbl} ${l}`;
      pushArb(out, fam, `${lbl} +${l}`, oa[ok], bookA, `${lbl} −${l}`, ob[uk], bookB, idsOf(oa, ok), idsOf(ob, uk));
      pushArb(out, fam, `${lbl} +${l}`, ob[ok], bookB, `${lbl} −${l}`, oa[uk], bookA, idsOf(ob, ok), idsOf(oa, uk));
    }
  }

  // Pair/Impair Points (match).
  pushArb(out, 'Pair/Impair Points', 'Impair', oa.odd, bookA, 'Pair', ob.even, bookB, idsOf(oa, 'odd'), idsOf(ob, 'even'));
  pushArb(out, 'Pair/Impair Points', 'Impair', ob.odd, bookB, 'Pair', oa.even, bookA, idsOf(ob, 'odd'), idsOf(oa, 'even'));

  // ─── Par quarter (Q1..Q4) et par mi-temps (H1/H2) ────────────────
  const PERIODS = [
    ['q1_', 'Q1'], ['q2_', 'Q2'], ['q3_', 'Q3'], ['q4_', 'Q4'],
    ['h1_', '1MT'], ['h2_', '2MT'],
  ];
  for (const [pfx, lbl] of PERIODS) {
    // Vainqueur — MARCHE 3-WAY (H/X/A) : une periode basket peut se terminer
    // sur un nul (score identique en fin de Q1/Q2/Q3/Q4 ou de 1MT/2MT). Notre
    // parseur 1win et sportybet ecrivent d'ailleurs qN_match_X / hN_match_X
    // (la Draw). Le comparator DOIT valider en 3-way, sinon 1/H + 1/A < 1
    // sans compter la Draw = FAKE arb (bug decouvert 2026-08-08 sur ADRM
    // Maringa Q1 6-9 à 7' : 1xbet Maringa @ 3.77 + SB Campo @ 4.15 →
    // "arb +49%" alors que Draw a 6-6/9-9 est tres probable → 1/3.77 + 1/4.15
    // + 1/Draw_reel >= 1 → aucun arbitrage garanti).
    //
    // pushArbPeriodWinner exige :
    //   1) Au moins UN des 2 books expose la Draw (qN_match_X ou hN_match_X)
    //   2) La couverture 3-way (H + A + best_Draw) doit rester < 1 en inverse_sum
    //   3) Le profit_pct est calcule sur la couverture 3-way complete
    pushArbPeriodWinner(out, lbl, oa, ob, bookA, bookB, pfx);
    pushArbPeriodWinner(out, lbl, ob, oa, bookB, bookA, pfx);
    // Total Points
    for (const l of linesOf(oa, ob, new RegExp(`^${pfx}(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
      const fam = `${lbl} Total Points ${l}`;
      pushArb(out, fam, `+${l}`, oa[`${pfx}over_${l}`], bookA, `−${l}`, ob[`${pfx}under_${l}`], bookB, idsOf(oa, `${pfx}over_${l}`), idsOf(ob, `${pfx}under_${l}`));
      pushArb(out, fam, `+${l}`, ob[`${pfx}over_${l}`], bookB, `−${l}`, oa[`${pfx}under_${l}`], bookA, idsOf(ob, `${pfx}over_${l}`), idsOf(oa, `${pfx}under_${l}`));
    }
    // Handicap
    for (const l of linesOf(oa, ob, new RegExp(`^${pfx}hcp_home_(-?\\d+(?:\\.\\d+)?)$`))) {
      const lNum = parseFloat(l);
      const hk = `${pfx}hcp_home_${l}`, ak = `${pfx}hcp_away_${-lNum}`;
      const sign = lNum > 0 ? '+' + l : l;
      const fam = `${lbl} Handicap ${sign}`;
      const aL = `Dom. ${sign}`;
      const bL = `Ext. ${-lNum > 0 ? '+' + (-lNum) : -lNum}`;
      pushArb(out, fam, aL, oa[hk], bookA, bL, ob[ak], bookB, idsOf(oa, hk), idsOf(ob, ak));
      pushArb(out, fam, aL, ob[hk], bookB, bL, oa[ak], bookA, idsOf(ob, hk), idsOf(oa, ak));
    }
    // Pair/Impair
    pushArb(out, `${lbl} Pair/Impair`, 'Impair', oa[`${pfx}odd`], bookA, 'Pair', ob[`${pfx}even`], bookB, idsOf(oa, `${pfx}odd`), idsOf(ob, `${pfx}even`));
    pushArb(out, `${lbl} Pair/Impair`, 'Impair', ob[`${pfx}odd`], bookB, 'Pair', oa[`${pfx}even`], bookA, idsOf(ob, `${pfx}odd`), idsOf(oa, `${pfx}even`));
    // TT (half only — pas de TT quarter dans les données observées)
    if (/^h[12]_$/.test(pfx)) {
      for (const [side, teamLbl] of [['home', 'Dom.'], ['away', 'Ext.']]) {
        for (const l of linesOf(oa, ob, new RegExp(`^${pfx}tt_${side}_(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
          const ok = `${pfx}tt_${side}_over_${l}`, uk = `${pfx}tt_${side}_under_${l}`;
          const fam = `${lbl} Total Points ${teamLbl} ${l}`;
          pushArb(out, fam, `${teamLbl} +${l}`, oa[ok], bookA, `${teamLbl} −${l}`, ob[uk], bookB, idsOf(oa, ok), idsOf(ob, uk));
          pushArb(out, fam, `${teamLbl} +${l}`, ob[ok], bookB, `${teamLbl} −${l}`, oa[uk], bookA, idsOf(ob, ok), idsOf(oa, uk));
        }
      }
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPARATOR HOCKEY — vainqueur 3-way (regulation 60min), handicap, total,
// team totals, odd/even. Convention keys : match_1/X/2, hcp_home/away_L,
// match_over/under_L, tt_home/away_over/under_L, odd/even.
// NOTE : winner en regulation time = 3-way (draw possible apres 60 min). On
// utilise pushArbPeriodWinner comme basket pour valider la couverture 3-way
// et eviter fake arbs sans compter la draw (bug basket documente).
// Periodes P1/P2/P3 : NON couvertes en v1 (needs probe cross-book per book).
// ═══════════════════════════════════════════════════════════════════════════════
export function compareHockeyTwoBooks(rawA, bookA, rawB, bookB) {
  const oa = normalizeAliases(rawA);
  const ob = normalizeAliases(rawB);
  if (staleBookMismatch(oa, ob)) return [];
  const out = [];

  // Vainqueur regulation 3-way. compareTwoBooks (foot) traite deja 1X2 3-way
  // en cherchant complementarites 1+X2, 2+1X, X+12. On reutilise sa logique
  // via pushArbPeriodWinner (validation couverture 3-way).
  pushArbPeriodWinner(out, 'Match', oa, ob, bookA, bookB, '');
  pushArbPeriodWinner(out, 'Match', ob, oa, bookB, bookA, '');

  // Handicap (buts, ±L).
  for (const l of linesOf(oa, ob, /^hcp_home_(-?\d+(?:\.\d+)?)$/)) {
    const lNum = parseFloat(l);
    const hk = `hcp_home_${l}`, ak = `hcp_away_${-lNum}`;
    const sign = lNum > 0 ? '+' + l : l;
    const fam = `Handicap ${sign}`;
    const aL = `Dom. ${sign}`;
    const bL = `Ext. ${-lNum > 0 ? '+' + (-lNum) : -lNum}`;
    pushArb(out, fam, aL, oa[hk], bookA, bL, ob[ak], bookB, idsOf(oa, hk), idsOf(ob, ak));
    pushArb(out, fam, aL, ob[hk], bookB, bL, oa[ak], bookA, idsOf(ob, hk), idsOf(oa, ak));
  }

  // Total buts match.
  for (const l of linesOf(oa, ob, /^match_(?:over|under)_(\d+(?:\.\d+)?)$/)) {
    const fam = `Total Buts ${l}`;
    pushArb(out, fam, `+${l}`, oa[`match_over_${l}`], bookA, `−${l}`, ob[`match_under_${l}`], bookB, idsOf(oa, `match_over_${l}`), idsOf(ob, `match_under_${l}`));
    pushArb(out, fam, `+${l}`, ob[`match_over_${l}`], bookB, `−${l}`, oa[`match_under_${l}`], bookA, idsOf(ob, `match_over_${l}`), idsOf(oa, `match_under_${l}`));
  }

  // Total buts individuel (Dom./Ext.).
  for (const [side, lbl] of [['home', 'Dom.'], ['away', 'Ext.']]) {
    for (const l of linesOf(oa, ob, new RegExp(`^tt_${side}_(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
      const ok = `tt_${side}_over_${l}`, uk = `tt_${side}_under_${l}`;
      const fam = `Total Buts ${lbl} ${l}`;
      pushArb(out, fam, `${lbl} +${l}`, oa[ok], bookA, `${lbl} −${l}`, ob[uk], bookB, idsOf(oa, ok), idsOf(ob, uk));
      pushArb(out, fam, `${lbl} +${l}`, ob[ok], bookB, `${lbl} −${l}`, oa[uk], bookA, idsOf(ob, ok), idsOf(oa, uk));
    }
  }

  // Pair/Impair Buts.
  pushArb(out, 'Pair/Impair Buts', 'Impair', oa.odd, bookA, 'Pair', ob.even, bookB, idsOf(oa, 'odd'), idsOf(ob, 'even'));
  pushArb(out, 'Pair/Impair Buts', 'Impair', ob.odd, bookB, 'Pair', oa.even, bookA, idsOf(ob, 'odd'), idsOf(oa, 'even'));

  // Double Chance (regulation 3-way donc DC 1X/12/X2 valide).
  const dcPairs = [['dc_1X', '2', 'dc_1X', 'Ext.'], ['dc_12', 'X', 'dc_12', 'Nul'], ['dc_X2', '1', 'dc_X2', 'Dom.']];
  for (const [dcKey, otherOutcome, dcKey2, otherLabel] of dcPairs) {
    const otherK = otherOutcome === '1' ? 'match_1' : otherOutcome === 'X' ? 'match_X' : 'match_2';
    const dcLabel = dcKey === 'dc_1X' ? 'Dom./Nul' : dcKey === 'dc_12' ? 'Dom./Ext.' : 'Nul/Ext.';
    const fam = `Double Chance vs ${otherLabel}`;
    pushArb(out, fam, dcLabel, oa[dcKey], bookA, otherLabel, ob[otherK], bookB, idsOf(oa, dcKey), idsOf(ob, otherK));
    pushArb(out, fam, dcLabel, ob[dcKey2], bookB, otherLabel, oa[otherK], bookA, idsOf(ob, dcKey2), idsOf(oa, otherK));
  }

  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPARATOR VOLLEYBALL — 2-way winner (pas de nul, best-of-5), sets, handicap
// points, total points, team totals, odd/even, total sets. Structure hybride
// tennis (sets s1_/s2_/s3_) + basket (hcp/total points + tt).
// Pas de match_X (volley = 2-way toujours). Pas de comparaison sets 5 (0.5%
// des matchs), gardons jusqu'a s3.
// ═══════════════════════════════════════════════════════════════════════════════
export function compareVolleyballTwoBooks(rawA, bookA, rawB, bookB) {
  const oa = normalizeAliases(rawA);
  const ob = normalizeAliases(rawB);
  if (staleBookMismatch(oa, ob)) return [];
  const out = [];

  // Vainqueur du Match : 2-way. match_1/2 complementaires.
  pushArb(out, 'Vainqueur du Match', 'Dom.', oa.match_1, bookA, 'Ext.', ob.match_2, bookB, idsOf(oa, 'match_1'), idsOf(ob, 'match_2'));
  pushArb(out, 'Vainqueur du Match', 'Dom.', ob.match_1, bookB, 'Ext.', oa.match_2, bookA, idsOf(ob, 'match_1'), idsOf(oa, 'match_2'));

  // Handicap Points Match (±L, demi-lignes 0.5-19.5).
  for (const l of linesOf(oa, ob, /^hcp_home_(-?\d+(?:\.\d+)?)$/)) {
    const lNum = parseFloat(l);
    const hk = `hcp_home_${l}`, ak = `hcp_away_${-lNum}`;
    const sign = lNum > 0 ? '+' + l : l;
    const fam = `Handicap Points ${sign}`;
    const aL = `Dom. ${sign}`;
    const bL = `Ext. ${-lNum > 0 ? '+' + (-lNum) : -lNum}`;
    pushArb(out, fam, aL, oa[hk], bookA, bL, ob[ak], bookB, idsOf(oa, hk), idsOf(ob, ak));
    pushArb(out, fam, aL, ob[hk], bookB, bL, oa[ak], bookA, idsOf(ob, hk), idsOf(oa, ak));
  }

  // Total Points Match (60-180 typique).
  for (const l of linesOf(oa, ob, /^match_(?:over|under)_(\d+(?:\.\d+)?)$/)) {
    const fam = `Total Points Match ${l}`;
    pushArb(out, fam, `+${l}`, oa[`match_over_${l}`], bookA, `−${l}`, ob[`match_under_${l}`], bookB, idsOf(oa, `match_over_${l}`), idsOf(ob, `match_under_${l}`));
    pushArb(out, fam, `+${l}`, ob[`match_over_${l}`], bookB, `−${l}`, oa[`match_under_${l}`], bookA, idsOf(ob, `match_over_${l}`), idsOf(oa, `match_under_${l}`));
  }

  // Total Points individuel Dom./Ext.
  for (const [side, lbl] of [['home', 'Dom.'], ['away', 'Ext.']]) {
    for (const l of linesOf(oa, ob, new RegExp(`^tt_${side}_(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
      const ok = `tt_${side}_over_${l}`, uk = `tt_${side}_under_${l}`;
      const fam = `Total Points ${lbl} ${l}`;
      pushArb(out, fam, `${lbl} +${l}`, oa[ok], bookA, `${lbl} −${l}`, ob[uk], bookB, idsOf(oa, ok), idsOf(ob, uk));
      pushArb(out, fam, `${lbl} +${l}`, ob[ok], bookB, `${lbl} −${l}`, oa[uk], bookA, idsOf(ob, ok), idsOf(oa, uk));
    }
  }

  // Handicap Sets (±1.5 typique best-of-3 ou ±2.5 best-of-5).
  for (const l of linesOf(oa, ob, /^hcp_sets_home_(-?\d+(?:\.\d+)?)$/)) {
    const lNum = parseFloat(l);
    const hk = `hcp_sets_home_${l}`, ak = `hcp_sets_away_${-lNum}`;
    const sign = lNum > 0 ? '+' + l : l;
    const fam = `Handicap Sets ${sign}`;
    pushArb(out, fam, `Dom. ${sign}`, oa[hk], bookA, `Ext. ${-lNum > 0 ? '+' + (-lNum) : -lNum}`, ob[ak], bookB, idsOf(oa, hk), idsOf(ob, ak));
    pushArb(out, fam, `Dom. ${sign}`, ob[hk], bookB, `Ext. ${-lNum > 0 ? '+' + (-lNum) : -lNum}`, oa[ak], bookA, idsOf(ob, hk), idsOf(oa, ak));
  }

  // Total Sets (2/3 best-of-3, 3.5 best-of-5).
  for (const l of linesOf(oa, ob, /^total_sets_(?:over|under)_(\d+(?:\.\d+)?)$/)) {
    const fam = `Total Sets ${l}`;
    pushArb(out, fam, `+${l}`, oa[`total_sets_over_${l}`], bookA, `−${l}`, ob[`total_sets_under_${l}`], bookB, idsOf(oa, `total_sets_over_${l}`), idsOf(ob, `total_sets_under_${l}`));
    pushArb(out, fam, `+${l}`, ob[`total_sets_over_${l}`], bookB, `−${l}`, oa[`total_sets_under_${l}`], bookA, idsOf(ob, `total_sets_over_${l}`), idsOf(oa, `total_sets_under_${l}`));
  }
  // PAS de paire "2 sets" x "3 sets" : en best-of-5 (volley) un match peut faire
  // 4 ou 5 sets et AUCUNE des 2 jambes ne couvre alors l'issue -> ce n'etait pas
  // un surebet. La seule couverture complete est total_sets_2 x total_sets_over_2.5,
  // deja traitee dans le comparateur tennis pour le best-of-3.

  // Pair/Impair Points.
  pushArb(out, 'Pair/Impair Points', 'Impair', oa.odd, bookA, 'Pair', ob.even, bookB, idsOf(oa, 'odd'), idsOf(ob, 'even'));
  pushArb(out, 'Pair/Impair Points', 'Impair', ob.odd, bookB, 'Pair', oa.even, bookA, idsOf(ob, 'odd'), idsOf(oa, 'even'));

  // ─── Par SET (s1/s2/s3) : Vainqueur, Handicap points, Total points, O/E
  const ORDINAL = ['1er', '2e', '3e', '4e', '5e'];
  for (const n of ['1', '2', '3', '4', '5']) {
    const pfx = `s${n}_`;
    const ord = ORDINAL[parseInt(n, 10) - 1];
    // Vainqueur du set (2-way, pas de nul)
    pushArb(out, `Vainqueur ${ord} Set`, 'Dom.', oa[`${pfx}match_1`], bookA, 'Ext.', ob[`${pfx}match_2`], bookB, idsOf(oa, `${pfx}match_1`), idsOf(ob, `${pfx}match_2`));
    pushArb(out, `Vainqueur ${ord} Set`, 'Dom.', ob[`${pfx}match_1`], bookB, 'Ext.', oa[`${pfx}match_2`], bookA, idsOf(ob, `${pfx}match_1`), idsOf(oa, `${pfx}match_2`));
    // Handicap points dans le set
    for (const l of linesOf(oa, ob, new RegExp(`^${pfx}hcp_home_(-?\\d+(?:\\.\\d+)?)$`))) {
      const lNum = parseFloat(l);
      const hk = `${pfx}hcp_home_${l}`, ak = `${pfx}hcp_away_${-lNum}`;
      const sign = lNum > 0 ? '+' + l : l;
      const fam = `Handicap ${ord} Set ${sign}`;
      pushArb(out, fam, `Dom. ${sign}`, oa[hk], bookA, `Ext. ${-lNum > 0 ? '+' + (-lNum) : -lNum}`, ob[ak], bookB, idsOf(oa, hk), idsOf(ob, ak));
      pushArb(out, fam, `Dom. ${sign}`, ob[hk], bookB, `Ext. ${-lNum > 0 ? '+' + (-lNum) : -lNum}`, oa[ak], bookA, idsOf(ob, hk), idsOf(oa, ak));
    }
    // Total points du set
    for (const l of linesOf(oa, ob, new RegExp(`^${pfx}(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
      const fam = `Total Points ${ord} Set ${l}`;
      pushArb(out, fam, `+${l}`, oa[`${pfx}over_${l}`], bookA, `−${l}`, ob[`${pfx}under_${l}`], bookB, idsOf(oa, `${pfx}over_${l}`), idsOf(ob, `${pfx}under_${l}`));
      pushArb(out, fam, `+${l}`, ob[`${pfx}over_${l}`], bookB, `−${l}`, oa[`${pfx}under_${l}`], bookA, idsOf(ob, `${pfx}over_${l}`), idsOf(oa, `${pfx}under_${l}`));
    }
    // Pair/Impair points du set
    pushArb(out, `Pair/Impair ${ord} Set`, 'Impair', oa[`${pfx}odd`], bookA, 'Pair', ob[`${pfx}even`], bookB, idsOf(oa, `${pfx}odd`), idsOf(ob, `${pfx}even`));
    pushArb(out, `Pair/Impair ${ord} Set`, 'Impair', ob[`${pfx}odd`], bookB, 'Pair', oa[`${pfx}even`], bookA, idsOf(ob, `${pfx}odd`), idsOf(oa, `${pfx}even`));
  }

  return out;
}

export function dedupeOpportunities(opps) {
  const seen = new Set();
  const out = [];
  for (const o of opps) {
    const legA = `${o.leg_a_book}:${o.leg_a_label}@${o.leg_a_odd}`;
    const legB = `${o.leg_b_book}:${o.leg_b_label}@${o.leg_b_odd}`;
    const key = [legA, legB].sort().join('||') + '|' + (o.market_family || '') + '|' + (o.match_label || '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}
