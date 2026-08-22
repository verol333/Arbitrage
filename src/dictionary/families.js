// CATALOGUE DES FAMILLES DE MARCHES FOOT
// Chaque famille = une fonction qui prend une selection et retourne un predicat (h,a)=>bool.
// h = buts home, a = buts away.
// Une famille peut avoir des parametres (ligne, seuil, etc.) qui sont passes au mapping.
//
// Convention : si un marche ne matche AUCUNE famille clairement definie ici, on ne l'utilise pas.
// Zero regex sur les noms de selection : chaque famille declare explicitement ses selections.
//
// Chaque predicat retourne :
//   true  → cellule (h,a) gagne cette selection
//   false → cellule (h,a) perd cette selection
//
// Familles avec "REFUND_ON" : cas de remboursement (Draw No Bet, quart-lines).
// Ces cases doivent etre exclues du mask (le book rembourse, ni gain ni perte).
// On les modelise comme "cellule non couverte par cette selection" ET "cellule non exclue" (rembourse).

// ─── Familles simples ─────────────────────────────────────────────────────
export const MATCH_1X2 = {
  key: 'MATCH_1X2',
  desc: 'Resultat du match : 1/X/2 (Home/Draw/Away)',
  selections: {
    '1': { pred: (h,a) => h > a, label: 'Home wins' },
    'X': { pred: (h,a) => h === a, label: 'Draw' },
    '2': { pred: (h,a) => a > h, label: 'Away wins' },
  },
};

export const DOUBLE_CHANCE = {
  key: 'DOUBLE_CHANCE',
  desc: 'Double chance : 1X/X2/12',
  selections: {
    '1X': { pred: (h,a) => h >= a, label: 'Home wins or draw' },
    'X2': { pred: (h,a) => a >= h, label: 'Draw or away wins' },
    '12': { pred: (h,a) => h !== a, label: 'Home or away wins (no draw)' },
  },
};

export const DRAW_NO_BET = {
  key: 'DRAW_NO_BET',
  desc: 'Draw No Bet : 1/2 (nul = remboursement)',
  selections: {
    '1': { pred: (h,a) => h > a, refund: (h,a) => h === a, label: 'Home wins (refund on draw)' },
    '2': { pred: (h,a) => a > h, refund: (h,a) => h === a, label: 'Away wins (refund on draw)' },
  },
};

export const BTTS = {
  key: 'BTTS',
  desc: 'Both Teams To Score : Yes/No',
  selections: {
    'yes': { pred: (h,a) => h >= 1 && a >= 1, label: 'Les 2 marquent' },
    'no':  { pred: (h,a) => h === 0 || a === 0, label: 'Au moins une equipe ne marque pas' },
  },
};

// ─── Over/Under totaux ────────────────────────────────────────────────────
export const OVER_UNDER = (line) => ({
  key: `OVER_UNDER_${line}`,
  desc: `Over/Under total buts, ligne ${line}`,
  line,
  selections: {
    'over':  { pred: (h,a) => (h + a) > line, label: `Total > ${line}` },
    'under': { pred: (h,a) => (h + a) < line, label: `Total < ${line}` },
  },
});

// ─── Team Totals ──────────────────────────────────────────────────────────
export const TT_HOME_OU = (line) => ({
  key: `TT_HOME_OU_${line}`,
  desc: `Home team total O/U ${line}`,
  line,
  selections: {
    'over':  { pred: (h,_a) => h > line, label: `Home > ${line}` },
    'under': { pred: (h,_a) => h < line, label: `Home < ${line}` },
  },
});

export const TT_AWAY_OU = (line) => ({
  key: `TT_AWAY_OU_${line}`,
  desc: `Away team total O/U ${line}`,
  line,
  selections: {
    'over':  { pred: (_h,a) => a > line, label: `Away > ${line}` },
    'under': { pred: (_h,a) => a < line, label: `Away < ${line}` },
  },
});

export const TT_HOME_EXACT = () => ({
  key: 'TT_HOME_EXACT',
  desc: 'Nombre exact de buts inscrits par home',
  selections: {
    // selection = string "N" ou "N+"
    exactN: (n)  => ({ pred: (h,_a) => h === n, label: `Home marque exactement ${n}` }),
    plusN:  (n)  => ({ pred: (h,_a) => h >= n, label: `Home marque ${n}+` }),
  },
});

export const TT_AWAY_EXACT = () => ({
  key: 'TT_AWAY_EXACT',
  desc: 'Nombre exact de buts inscrits par away',
  selections: {
    exactN: (n) => ({ pred: (_h,a) => a === n, label: `Away marque exactement ${n}` }),
    plusN:  (n) => ({ pred: (_h,a) => a >= n, label: `Away marque ${n}+` }),
  },
});

// ─── Exact Goals total ───────────────────────────────────────────────────
export const EXACT_GOALS = () => ({
  key: 'EXACT_GOALS',
  desc: 'Nombre exact de buts total dans le match',
  selections: {
    exactN: (n) => ({ pred: (h,a) => (h + a) === n, label: `Total = ${n} buts` }),
    plusN:  (n) => ({ pred: (h,a) => (h + a) >= n, label: `Total ≥ ${n} buts` }),
  },
});

// ─── Multigoals (ranges) ──────────────────────────────────────────────────
export const MULTIGOALS = () => ({
  key: 'MULTIGOALS',
  desc: 'Multigoals : plage [lo..hi]',
  selections: {
    range: (lo, hi) => ({ pred: (h,a) => (h + a) >= lo && (h + a) <= hi, label: `Total ∈ [${lo}..${hi}]` }),
    exactN: (n) => ({ pred: (h,a) => (h + a) === n, label: `Total = ${n}` }),
    plusN: (n) => ({ pred: (h,a) => (h + a) >= n, label: `Total ≥ ${n}` }),
  },
});

// ─── Odd/Even ─────────────────────────────────────────────────────────────
export const TOTAL_ODD_EVEN = {
  key: 'TOTAL_ODD_EVEN',
  desc: 'Total buts pair/impair',
  selections: {
    'odd':  { pred: (h,a) => (h + a) % 2 === 1, label: 'Total impair' },
    'even': { pred: (h,a) => (h + a) % 2 === 0, label: 'Total pair' },
  },
};

export const TT_HOME_ODD_EVEN = {
  key: 'TT_HOME_ODD_EVEN',
  desc: 'Buts home pair/impair',
  selections: {
    'odd':  { pred: (h,_a) => h % 2 === 1, label: 'Home impair' },
    'even': { pred: (h,_a) => h % 2 === 0, label: 'Home pair' },
  },
};

export const TT_AWAY_ODD_EVEN = {
  key: 'TT_AWAY_ODD_EVEN',
  desc: 'Buts away pair/impair',
  selections: {
    'odd':  { pred: (_h,a) => a % 2 === 1, label: 'Away impair' },
    'even': { pred: (_h,a) => a % 2 === 0, label: 'Away pair' },
  },
};

// ─── Correct Score ────────────────────────────────────────────────────────
export const CORRECT_SCORE = () => ({
  key: 'CORRECT_SCORE',
  desc: 'Score exact',
  selections: {
    exact: (x, y) => ({ pred: (h,a) => h === x && a === y, label: `Score exact ${x}-${y}` }),
    anyOtherHomeWin: () => ({ pred: (h,a) => h > a && (h >= 4 || a >= 3), label: 'Autre score victoire home' }),
    anyOtherAwayWin: () => ({ pred: (h,a) => a > h && (a >= 4 || h >= 3), label: 'Autre score victoire away' }),
    anyOtherDraw:    () => ({ pred: (h,a) => h === a && h >= 3, label: 'Autre score nul (3+)' }),
  },
});

// ─── Winning Margin ───────────────────────────────────────────────────────
export const WINNING_MARGIN = () => ({
  key: 'WINNING_MARGIN',
  desc: 'Marge du vainqueur',
  selections: {
    homeByN:      (n) => ({ pred: (h,a) => (h - a) === n, label: `Home gagne par exactement ${n}` }),
    homeByNplus:  (n) => ({ pred: (h,a) => (h - a) >= n, label: `Home gagne par ${n}+` }),
    awayByN:      (n) => ({ pred: (h,a) => (a - h) === n, label: `Away gagne par exactement ${n}` }),
    awayByNplus:  (n) => ({ pred: (h,a) => (a - h) >= n, label: `Away gagne par ${n}+` }),
    draw:         () =>  ({ pred: (h,a) => h === a, label: 'Match nul' }),
    noGoal:       () =>  ({ pred: (h,a) => h === 0 && a === 0, label: 'Aucun but (0-0)' }),
  },
});

// ─── Handicaps ────────────────────────────────────────────────────────────
// Convention Asian Handicap : la ligne X est appliquee au HOME.
//   Home avec +X gagne si h+X > a
//   Away avec -X gagne si a > h+X (soit a-X > h)
// Rejette les quart-lines (0.25, 0.75) : demi-gain/demi-perte non representable.
export const HANDICAP_ASIAN = (line) => ({
  key: `HANDICAP_ASIAN_${line}`,
  desc: `Asian Handicap ligne ${line} (donnee au home)`,
  line,
  isQuarter: (Math.abs(line) % 0.5 > 0.01 && Math.abs(line) % 0.5 < 0.49),
  selections: {
    'home': { pred: (h,a) => (h + line) > a, refund: (h,a) => (h + line) === a, label: `Home ${line >= 0 ? '+' : ''}${line}` },
    'away': { pred: (h,a) => a > (h + line), refund: (h,a) => (h + line) === a, label: `Away ${line >= 0 ? '-' : '+'}${Math.abs(line)}` },
  },
});

// European Handicap 3-way (avec Draw handicape)
export const HANDICAP_1X2 = (line) => ({
  key: `HANDICAP_1X2_${line}`,
  desc: `European Handicap 1X2 ligne ${line}`,
  line,
  selections: {
    '1': { pred: (h,a) => (h + line) > a, label: `Home wins avec handicap ${line}` },
    'X': { pred: (h,a) => (h + line) === a, label: `Nul apres handicap ${line}` },
    '2': { pred: (h,a) => a > (h + line), label: `Away wins avec handicap` },
  },
});

// ─── Clean Sheet (equipe ne concede pas) ──────────────────────────────────
// ⚠️ Different de Win To Nil : clean sheet = juste "n'encaisse pas", peu importe le resultat.
export const CLEAN_SHEET_HOME = {
  key: 'CLEAN_SHEET_HOME',
  desc: 'Clean Sheet Home : Thailand (home) n\'encaisse pas de but',
  selections: {
    'yes': { pred: (_h,a) => a === 0, label: 'Home ne concede pas (a=0)' },
    'no':  { pred: (_h,a) => a >= 1, label: 'Home concede au moins 1 but (a≥1)' },
  },
};

export const CLEAN_SHEET_AWAY = {
  key: 'CLEAN_SHEET_AWAY',
  desc: 'Clean Sheet Away : Vietnam (away) n\'encaisse pas de but',
  selections: {
    'yes': { pred: (h,_a) => h === 0, label: 'Away ne concede pas (h=0)' },
    'no':  { pred: (h,_a) => h >= 1, label: 'Away concede au moins 1 but (h≥1)' },
  },
};

// ─── Win To Nil (gagne sans encaisser) ─────────────────────────────────────
// ⚠️ Different de Clean Sheet : ici il faut GAGNER en plus de ne pas encaisser.
export const WIN_TO_NIL_HOME = {
  key: 'WIN_TO_NIL_HOME',
  desc: 'Win To Nil Home : home gagne ET ne concede pas',
  selections: {
    'yes': { pred: (h,a) => h > 0 && a === 0, label: 'Home wins to nil (h≥1, a=0)' },
    'no':  { pred: (h,a) => !(h > 0 && a === 0), label: 'Home does not win to nil' },
  },
};

export const WIN_TO_NIL_AWAY = {
  key: 'WIN_TO_NIL_AWAY',
  desc: 'Win To Nil Away : away gagne ET ne concede pas',
  selections: {
    'yes': { pred: (h,a) => a > 0 && h === 0, label: 'Away wins to nil (a≥1, h=0)' },
    'no':  { pred: (h,a) => !(a > 0 && h === 0), label: 'Away does not win to nil' },
  },
};

// ─── Combines : Resultat + BTTS ──────────────────────────────────────────
// Marche 6-way : chaque cellule (h,a) tombe dans exactement UNE case.
export const RESULT_AND_BTTS = {
  key: 'RESULT_AND_BTTS',
  desc: 'Resultat + BTTS combines (6 selections)',
  selections: {
    '1/yes': { pred: (h,a) => h > a && h >= 1 && a >= 1, label: 'Home wins ET les 2 marquent' },
    '1/no':  { pred: (h,a) => h > a && a === 0, label: 'Home wins ET away ne marque pas' },
    'X/yes': { pred: (h,a) => h === a && h >= 1, label: 'Nul avec buts (1-1, 2-2, ...)' },
    'X/no':  { pred: (h,a) => h === 0 && a === 0, label: 'Nul 0-0' },
    '2/yes': { pred: (h,a) => a > h && h >= 1 && a >= 1, label: 'Away wins ET les 2 marquent' },
    '2/no':  { pred: (h,a) => a > h && h === 0, label: 'Away wins ET home ne marque pas' },
  },
};

// ─── Combines : Resultat + Nombre de buts (Over/Under) ────────────────────
export const RESULT_AND_TOTAL = (line) => ({
  key: `RESULT_AND_TOTAL_${line}`,
  desc: `Resultat + Total O/U ${line} (6 selections)`,
  line,
  selections: {
    '1/over':  { pred: (h,a) => h > a && (h + a) > line, label: `Home wins & total > ${line}` },
    '1/under': { pred: (h,a) => h > a && (h + a) < line, label: `Home wins & total < ${line}` },
    'X/over':  { pred: (h,a) => h === a && (h + a) > line, label: `Draw & total > ${line}` },
    'X/under': { pred: (h,a) => h === a && (h + a) < line, label: `Draw & total < ${line}` },
    '2/over':  { pred: (h,a) => a > h && (h + a) > line, label: `Away wins & total > ${line}` },
    '2/under': { pred: (h,a) => a > h && (h + a) < line, label: `Away wins & total < ${line}` },
  },
});

// ─── Combines : Double Chance + Total ────────────────────────────────────
export const DC_AND_TOTAL = (line) => ({
  key: `DC_AND_TOTAL_${line}`,
  desc: `Double Chance + Total O/U ${line} (6 selections)`,
  line,
  selections: {
    '1X/over':  { pred: (h,a) => h >= a && (h + a) > line, label: `1X & total > ${line}` },
    '1X/under': { pred: (h,a) => h >= a && (h + a) < line, label: `1X & total < ${line}` },
    'X2/over':  { pred: (h,a) => a >= h && (h + a) > line, label: `X2 & total > ${line}` },
    'X2/under': { pred: (h,a) => a >= h && (h + a) < line, label: `X2 & total < ${line}` },
    '12/over':  { pred: (h,a) => h !== a && (h + a) > line, label: `12 & total > ${line}` },
    '12/under': { pred: (h,a) => h !== a && (h + a) < line, label: `12 & total < ${line}` },
  },
});

// ─── Combines : Double Chance + BTTS ─────────────────────────────────────
export const DC_AND_BTTS = {
  key: 'DC_AND_BTTS',
  desc: 'Double Chance + BTTS (6 selections)',
  selections: {
    '1X/yes': { pred: (h,a) => h >= a && h >= 1 && a >= 1, label: '1X & BTTS Yes' },
    '1X/no':  { pred: (h,a) => h >= a && (h === 0 || a === 0), label: '1X & BTTS No' },
    'X2/yes': { pred: (h,a) => a >= h && h >= 1 && a >= 1, label: 'X2 & BTTS Yes' },
    'X2/no':  { pred: (h,a) => a >= h && (h === 0 || a === 0), label: 'X2 & BTTS No' },
    '12/yes': { pred: (h,a) => h !== a && h >= 1 && a >= 1, label: '12 & BTTS Yes' },
    '12/no':  { pred: (h,a) => h !== a && (h === 0 || a === 0), label: '12 & BTTS No' },
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// FAMILLES REJETEES (score final insuffisant) — documente pour reference
// ═══════════════════════════════════════════════════════════════════════════
// - HT/FT (Halftime/Fulltime) : necessite score MT, pas dans notre modele (h,a) final
// - Score in Both Halves : necessite score MT
// - Win Both Halves / Win Either Half : necessite score MT
// - Race to N Goals : depend de l'ORDRE des buts, pas juste du score final
// - First Team to Score / Last Team to Score : idem
// - Highest Scoring Half : necessite score MT
// - Player markets, corners, cards, shots : hors scope score match
