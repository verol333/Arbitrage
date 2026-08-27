// DICTIONNAIRE 1xBET — libelles des marches par (G, T).
//
// 1xBet ne renvoie AUCUN texte dans GetGameZip : chaque groupe est un G numerique
// et chaque issue un T numerique (verifie le 2026-08-27 en interrogeant l'API :
// les seules cles presentes sont G, GS, E puis T, P, C, CV, RI). Aucun endpoint
// public de dictionnaire n'existe (GetTypeList / GetBetTypes / genfiles : 404).
//
// PROVENANCE DES LIBELLES CI-DESSOUS : uniquement le mapping deja valide en
// production dans src/bookmakers/xbet/odds.js, confirme par des placements de
// paris reels. Rien n'est devine. Tout groupe absent de cette table reste
// volontairement anonyme (voir xbetMarketName) et n'est donc jamais classe
// dans une famille : mieux vaut un marche ignore qu'un marche mal identifie.

// G -> libelle du marche (langue: francais, aligne sur le vocabulaire bookmaker)
export const XBET_GROUPS = {
  1: '1X2',
  11581: '1X2 (temps reglementaire)',
  8: 'Double chance',
  9: 'Draw no bet',
  17: 'Total du match',
  19: 'Les deux equipes marquent',
  15: 'Total individuel equipe 1',
  62: 'Total individuel equipe 2',
  2: 'Handicap asiatique',
  14: 'Pair / Impair',
  169: '1ere equipe a marquer',
  445: 'Mi-temps la plus prolifique',
};

// 'G:T' -> libelle de l'issue (meme provenance : odds.js, valide en production)
export const XBET_SELECTIONS = {
  '1:1': '1', '1:2': 'X', '1:3': '2',
  '11581:16684': '1', '11581:16685': 'X', '11581:16686': '2',
  '8:4': '1X', '8:5': '12', '8:6': 'X2',
  '9:703': '1', '9:704': '2',
  '17:9': 'Plus de', '17:10': 'Moins de',
  '19:180': 'Oui', '19:181': 'Non',
  '15:11': 'Plus de', '15:12': 'Moins de',
  '62:13': 'Plus de', '62:14': 'Moins de',
  '2:7': 'Handicap equipe 1', '2:8': 'Handicap equipe 2',
  '14:182': 'Pair', '14:183': 'Impair',
  '169:923': 'Equipe 1', '169:925': 'Aucune', '169:924': 'Equipe 2',
  '445:1305': '1ere mi-temps', '445:1306': '2eme mi-temps', '445:1307': 'Egalite',
};

// Libelle du marche, ou identifiant brut explicitement non resolu.
// Le prefixe 'xbet-G' garantit que le classifieur le renvoie en OTHER
// (aucun mot-cle metier dedans) : un groupe inconnu ne peut pas etre
// confondu avec un marche connu.
export function xbetMarketName(G) {
  return XBET_GROUPS[G] || ('xbet-G' + G);
}

export function xbetSelectionName(G, T, P) {
  const base = XBET_SELECTIONS[G + ':' + T] || ('T' + T);
  return P == null ? base : base + ' ' + P;
}
