// RESOLVERS PAR BOOK
// resolveOutcome({book, market, selection, homeTeam, awayTeam}) → {family, key, pred, label} ou null.
// Aucun regex heuristique sur les selections — seulement des correspondances explicites
// definies dans les catalogues de familles.
//
// Un retour null signifie : marche/selection non exploitable ou non compris.
// SKIP explicite pour :
//   - Tout ce qui necessite le score MT (HT/FT, halves)
//   - Tout ce qui depend de l'ordre des buts (Race to N, First goal)
//   - Marches joueurs/cartes/corners/tirs
import * as F from './families.js';

// Normalise une string : accents, espaces multiples, minuscule
function norm(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ');
}

// Reference une equipe dans un nom de marche/selection
function containsTeam(text, teamName) {
  if (!teamName) return false;
  const nt = norm(teamName);
  const ntext = norm(text);
  // On cherche au moins 2 mots consecutifs de l'equipe dans le texte
  const words = nt.split(' ').filter(w => w.length >= 4);
  if (words.length === 0) return ntext.includes(nt);
  return words.filter(w => ntext.includes(w)).length >= Math.min(2, words.length);
}

// Extrait une ligne "[X.Y]" du market name (ex: "Handicap [1.5]" → 1.5)
function extractLine(market) {
  const m = String(market).match(/\[\s*(-?\d+(?:\.\d+)?)\s*\]/);
  return m ? parseFloat(m[1]) : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONGOBET
// ═══════════════════════════════════════════════════════════════════════════
function resolveCongobet({ market, selection, homeTeam, awayTeam }) {
  const m = norm(market);
  const s = norm(selection);

  // 1X2
  if (m === 'resultat du match') {
    if (s === '1') return { family: 'MATCH_1X2', selection: '1', pred: F.MATCH_1X2.selections['1'].pred, label: F.MATCH_1X2.selections['1'].label };
    if (s === 'x') return { family: 'MATCH_1X2', selection: 'X', pred: F.MATCH_1X2.selections['X'].pred, label: F.MATCH_1X2.selections['X'].label };
    if (s === '2') return { family: 'MATCH_1X2', selection: '2', pred: F.MATCH_1X2.selections['2'].pred, label: F.MATCH_1X2.selections['2'].label };
  }

  // Double Chance
  if (m === 'double chance') {
    if (s === '1x') return { family: 'DOUBLE_CHANCE', selection: '1X', pred: F.DOUBLE_CHANCE.selections['1X'].pred };
    if (s === 'x2') return { family: 'DOUBLE_CHANCE', selection: 'X2', pred: F.DOUBLE_CHANCE.selections['X2'].pred };
    if (s === '12') return { family: 'DOUBLE_CHANCE', selection: '12', pred: F.DOUBLE_CHANCE.selections['12'].pred };
  }

  // Draw No Bet
  if (m === "victoire d'une des deux equipes") {
    if (s === '1') return { family: 'DRAW_NO_BET', selection: '1', pred: F.DRAW_NO_BET.selections['1'].pred, refund: F.DRAW_NO_BET.selections['1'].refund };
    if (s === '2') return { family: 'DRAW_NO_BET', selection: '2', pred: F.DRAW_NO_BET.selections['2'].pred, refund: F.DRAW_NO_BET.selections['2'].refund };
  }

  // BTTS
  if (m === 'les deux equipes marquent') {
    if (s === 'oui' || s === 'yes') return { family: 'BTTS', selection: 'yes', pred: F.BTTS.selections.yes.pred };
    if (s === 'non' || s === 'no')  return { family: 'BTTS', selection: 'no',  pred: F.BTTS.selections.no.pred };
  }

  // Over/Under (total buts, format "> 1.5" / "< 2.5")
  if (m === 'nombre de buts') {
    const ov = s.match(/^>\s*(\d+(?:\.\d+)?)$/);
    const un = s.match(/^<\s*(\d+(?:\.\d+)?)$/);
    if (ov) {
      const line = parseFloat(ov[1]);
      if (isQuarter(line)) return null;
      return { family: `OVER_UNDER_${line}`, selection: 'over', pred: F.OVER_UNDER(line).selections.over.pred, line };
    }
    if (un) {
      const line = parseFloat(un[1]);
      if (isQuarter(line)) return null;
      return { family: `OVER_UNDER_${line}`, selection: 'under', pred: F.OVER_UNDER(line).selections.under.pred, line };
    }
  }

  // Nombre exact de buts (total)
  if (m === 'nombre exact de buts') {
    const n = s.match(/^(\d+)$/);
    if (n) return { family: 'EXACT_GOALS', selection: `=${n[1]}`, pred: (h,a) => (h + a) === parseInt(n[1]) };
    const p = s.match(/^(\d+)\+$/);
    if (p) return { family: 'EXACT_GOALS', selection: `>=${p[1]}`, pred: (h,a) => (h + a) >= parseInt(p[1]) };
  }

  // Team totals home/away : "Nombre de buts de X" / "Total de buts de X"
  if (m.startsWith('nombre de buts de ') || m.startsWith('total de buts de ')) {
    const teamPart = market.replace(/^nombre de buts de\s+/i, '').replace(/^total de buts de\s+/i, '');
    const isHome = containsTeam(teamPart, homeTeam);
    const isAway = containsTeam(teamPart, awayTeam);
    if (!isHome && !isAway) return null;
    const ov = s.match(/^>\s*(\d+(?:\.\d+)?)$/);
    const un = s.match(/^<\s*(\d+(?:\.\d+)?)$/);
    if (ov) {
      const line = parseFloat(ov[1]);
      if (isQuarter(line)) return null;
      if (isHome && !isAway) return { family: `TT_HOME_OU_${line}`, selection: 'over', pred: (h,_a) => h > line };
      if (isAway && !isHome) return { family: `TT_AWAY_OU_${line}`, selection: 'over', pred: (_h,a) => a > line };
    }
    if (un) {
      const line = parseFloat(un[1]);
      if (isQuarter(line)) return null;
      if (isHome && !isAway) return { family: `TT_HOME_OU_${line}`, selection: 'under', pred: (h,_a) => h < line };
      if (isAway && !isHome) return { family: `TT_AWAY_OU_${line}`, selection: 'under', pred: (_h,a) => a < line };
    }
  }

  // Team exact goals : "Nombre exact de buts inscrits par X"
  if (m.startsWith('nombre exact de buts inscrits par ')) {
    const teamPart = market.replace(/^nombre exact de buts inscrits par\s+/i, '');
    const isHome = containsTeam(teamPart, homeTeam);
    const isAway = containsTeam(teamPart, awayTeam);
    if (!isHome && !isAway) return null;
    const n = s.match(/^(\d+)$/);
    if (n) {
      const num = parseInt(n[1]);
      if (isHome && !isAway) return { family: 'TT_HOME_EXACT', selection: `=${num}`, pred: (h,_a) => h === num };
      if (isAway && !isHome) return { family: 'TT_AWAY_EXACT', selection: `=${num}`, pred: (_h,a) => a === num };
    }
    const p = s.match(/^(\d+)\+$/);
    if (p) {
      const num = parseInt(p[1]);
      if (isHome && !isAway) return { family: 'TT_HOME_EXACT', selection: `>=${num}`, pred: (h,_a) => h >= num };
      if (isAway && !isHome) return { family: 'TT_AWAY_EXACT', selection: `>=${num}`, pred: (_h,a) => a >= num };
    }
  }

  // Score exact
  if (m === 'score exact') {
    const sc = s.match(/^(\d+)\s*[:\-]\s*(\d+)$/);
    if (sc) {
      const x = parseInt(sc[1]), y = parseInt(sc[2]);
      return { family: 'CORRECT_SCORE', selection: `${x}-${y}`, pred: (h,a) => h === x && a === y };
    }
    // "Autre score victoire domicile" etc.
    if (/autre.*domicile|autre.*home/i.test(selection)) return { family: 'CORRECT_SCORE', selection: 'anyHome', pred: (h,a) => h > a && (h >= 4 || a >= 3) };
    if (/autre.*exterieur|autre.*away/i.test(selection)) return { family: 'CORRECT_SCORE', selection: 'anyAway', pred: (h,a) => a > h && (a >= 4 || h >= 3) };
    if (/autre.*nul|autre.*draw/i.test(selection)) return { family: 'CORRECT_SCORE', selection: 'anyDraw', pred: (h,a) => h === a && h >= 3 };
  }

  // Marge du vainqueur / Ecart entre equipes
  if (m === 'marge du vainqueur' || m === 'ecart entre equipes') {
    // Format "1 par N", "1 par N+", "2 par N", "Nul", "Aucun but"
    if (/nul|draw/i.test(s) && !/par/i.test(s)) return { family: 'WINNING_MARGIN', selection: 'draw', pred: (h,a) => h === a };
    const homeP = s.match(/^1\s*par\s*(\d+)\+?$/);
    if (homeP) {
      const n = parseInt(homeP[1]);
      const plus = /\+$/.test(homeP[0]);
      return { family: 'WINNING_MARGIN', selection: `home${plus?'+':'='}${n}`, pred: (h,a) => plus ? (h-a) >= n : (h-a) === n };
    }
    const awayP = s.match(/^2\s*par\s*(\d+)\+?$/);
    if (awayP) {
      const n = parseInt(awayP[1]);
      const plus = /\+$/.test(awayP[0]);
      return { family: 'WINNING_MARGIN', selection: `away${plus?'+':'='}${n}`, pred: (h,a) => plus ? (a-h) >= n : (a-h) === n };
    }
    // Ecart entre equipes utilise aussi format "1 (+0.5)" / "2 (-1.5)" — c'est un HANDICAP, pas marge
    // On skip pour eviter confusion avec la vraie marge
    return null;
  }

  // Handicap Europeen
  if (m === 'handicap europeen') {
    // Format specific : "1 (+1)", "X (+1)", "2 (+1)" — la ligne "(+1)" est dans la selection
    const paren = selection.match(/^([12x])\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*\)$/i);
    if (paren) {
      const [, side, hcpStr] = paren;
      const line = parseFloat(hcpStr);
      if (isQuarter(line)) return null;
      if (side === '1') return { family: `HANDICAP_1X2_${line}`, selection: '1', pred: (h,a) => (h + line) > a };
      if (side.toLowerCase() === 'x') return { family: `HANDICAP_1X2_${line}`, selection: 'X', pred: (h,a) => (h + line) === a };
      if (side === '2') return { family: `HANDICAP_1X2_${line}`, selection: '2', pred: (h,a) => a > (h + line) };
    }
    return null;
  }

  // Resultat du match + BTTS combines : "1 / Oui", "X / Non", etc.
  if (m === 'resultat du match et les deux equipes marquent') {
    const combo = s.replace(/\s+/g, '').match(/^([12x])\/(oui|non|yes|no)$/i);
    if (combo) {
      const [, side, yn] = combo;
      const isYes = /oui|yes/i.test(yn);
      const key = `${side.toUpperCase()}/${isYes ? 'yes' : 'no'}`;
      const spec = F.RESULT_AND_BTTS.selections[`${side.toLowerCase()}/${isYes ? 'yes' : 'no'}`];
      if (spec) return { family: 'RESULT_AND_BTTS', selection: key, pred: spec.pred, label: spec.label };
    }
    return null;
  }

  // Resultat + Nombre de buts : "1 / > 2.5", "X / < 1.5"
  if (m === 'resultat du match et nombre de buts') {
    const combo = s.replace(/\s+/g, '').match(/^([12x])\/([<>])(\d+(?:\.\d+)?)$/i);
    if (combo) {
      const [, side, op, lineStr] = combo;
      const line = parseFloat(lineStr);
      if (isQuarter(line)) return null;
      const isOver = op === '>';
      const sel = `${side.toLowerCase()}/${isOver ? 'over' : 'under'}`;
      const spec = F.RESULT_AND_TOTAL(line).selections[sel];
      if (spec) return { family: `RESULT_AND_TOTAL_${line}`, selection: `${side.toUpperCase()}/${isOver ? 'O' : 'U'}${line}`, pred: spec.pred, label: spec.label };
    }
    return null;
  }

  // Double chance + Nombre de buts : "1X / > 2.5"
  if (m === 'double chance et nombre de buts') {
    const combo = s.replace(/\s+/g, '').match(/^(1x|x2|12)\/([<>])(\d+(?:\.\d+)?)$/i);
    if (combo) {
      const [, side, op, lineStr] = combo;
      const line = parseFloat(lineStr);
      if (isQuarter(line)) return null;
      const isOver = op === '>';
      const sel = `${side.toLowerCase()}/${isOver ? 'over' : 'under'}`;
      const spec = F.DC_AND_TOTAL(line).selections[sel];
      if (spec) return { family: `DC_AND_TOTAL_${line}`, selection: `${side.toUpperCase()}/${isOver ? 'O' : 'U'}${line}`, pred: spec.pred, label: spec.label };
    }
    return null;
  }

  // Double chance + BTTS : "1X / Oui"
  if (m === 'double chance et les deux equipes marquent') {
    const combo = s.replace(/\s+/g, '').match(/^(1x|x2|12)\/(oui|non|yes|no)$/i);
    if (combo) {
      const [, side, yn] = combo;
      const isYes = /oui|yes/i.test(yn);
      const sel = `${side.toLowerCase()}/${isYes ? 'yes' : 'no'}`;
      const spec = F.DC_AND_BTTS.selections[sel];
      if (spec) return { family: 'DC_AND_BTTS', selection: `${side.toUpperCase()}/${isYes ? 'yes' : 'no'}`, pred: spec.pred };
    }
    return null;
  }

  // BTTS + Nombre de buts : "Oui / > 2.5"
  if (m === 'les deux equipes marquent et nombre de buts') {
    const combo = s.replace(/\s+/g, '').match(/^(oui|non|yes|no)\/([<>])(\d+(?:\.\d+)?)$/i);
    if (combo) {
      const [, yn, op, lineStr] = combo;
      const line = parseFloat(lineStr);
      if (isQuarter(line)) return null;
      const isYes = /oui|yes/i.test(yn);
      const isOver = op === '>';
      // Custom : BTTS AND Over/Under
      const pred = (h,a) => {
        const btts = isYes ? (h >= 1 && a >= 1) : (h === 0 || a === 0);
        const ou = isOver ? (h + a) > line : (h + a) < line;
        return btts && ou;
      };
      return { family: `BTTS_AND_TOTAL_${line}`, selection: `${isYes?'YES':'NO'}/${isOver?'O':'U'}${line}`, pred };
    }
    return null;
  }

  // "X n'encaisse pas de but" — CLEAN SHEET pour l'equipe X
  if (m.endsWith(" n'encaisse pas de but")) {
    const teamPart = market.replace(/n'encaisse pas de but$/i, '').trim();
    const isHome = containsTeam(teamPart, homeTeam);
    const isAway = containsTeam(teamPart, awayTeam);
    if (!isHome && !isAway) return null;
    const isYes = /oui|yes/i.test(s);
    const isNo  = /non|no/i.test(s);
    if (isHome && !isAway) {
      if (isYes) return { family: 'CLEAN_SHEET_HOME', selection: 'yes', pred: (_h,a) => a === 0 };
      if (isNo)  return { family: 'CLEAN_SHEET_HOME', selection: 'no',  pred: (_h,a) => a >= 1 };
    }
    if (isAway && !isHome) {
      if (isYes) return { family: 'CLEAN_SHEET_AWAY', selection: 'yes', pred: (h,_a) => h === 0 };
      if (isNo)  return { family: 'CLEAN_SHEET_AWAY', selection: 'no',  pred: (h,_a) => h >= 1 };
    }
    return null;
  }

  // "X gagne sans encaisser de buts" — WIN TO NIL pour l'equipe X
  if (m.endsWith(' gagne sans encaisser de buts')) {
    const teamPart = market.replace(/gagne sans encaisser de buts$/i, '').trim();
    const isHome = containsTeam(teamPart, homeTeam);
    const isAway = containsTeam(teamPart, awayTeam);
    if (!isHome && !isAway) return null;
    const isYes = /oui|yes/i.test(s);
    const isNo  = /non|no/i.test(s);
    if (isHome && !isAway) {
      if (isYes) return { family: 'WIN_TO_NIL_HOME', selection: 'yes', pred: (h,a) => h > 0 && a === 0 };
      if (isNo)  return { family: 'WIN_TO_NIL_HOME', selection: 'no',  pred: (h,a) => !(h > 0 && a === 0) };
    }
    if (isAway && !isHome) {
      if (isYes) return { family: 'WIN_TO_NIL_AWAY', selection: 'yes', pred: (h,a) => a > 0 && h === 0 };
      if (isNo)  return { family: 'WIN_TO_NIL_AWAY', selection: 'no',  pred: (h,a) => !(a > 0 && h === 0) };
    }
    return null;
  }

  // SKIP explicitement : "X gagne ou ..." (combines complexes), HT/FT, halves
  if (/gagne ou /i.test(m)) return null;
  if (/mi-temps.*fin de match|halftime|halves|marque a chaque mi-temps/i.test(m)) return null;
  if (m === 'match nul ou les deux equipes marquent') return null;
  if (m === "match nul ou au moins une equipe n'encaisse pas de but") return null;

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// BETPAWA
// ═══════════════════════════════════════════════════════════════════════════
function resolveBetpawa({ market, selection, homeTeam, awayTeam }) {
  const m = norm(market);
  const s = norm(selection);

  // 1X2 - FT
  if (m === '1x2 - ft') {
    if (s === '1' || s === 'home') return { family: 'MATCH_1X2', selection: '1', pred: F.MATCH_1X2.selections['1'].pred };
    if (s === 'x' || s === 'draw') return { family: 'MATCH_1X2', selection: 'X', pred: F.MATCH_1X2.selections['X'].pred };
    if (s === '2' || s === 'away') return { family: 'MATCH_1X2', selection: '2', pred: F.MATCH_1X2.selections['2'].pred };
  }

  // Double Chance - FT
  if (m === 'double chance - ft') {
    if (s === '1x' || s === 'home/draw') return { family: 'DOUBLE_CHANCE', selection: '1X', pred: F.DOUBLE_CHANCE.selections['1X'].pred };
    if (s === 'x2' || s === 'draw/away') return { family: 'DOUBLE_CHANCE', selection: 'X2', pred: F.DOUBLE_CHANCE.selections['X2'].pred };
    if (s === '12' || s === 'home/away') return { family: 'DOUBLE_CHANCE', selection: '12', pred: F.DOUBLE_CHANCE.selections['12'].pred };
  }

  // Draw No Bet - FT
  if (m === 'draw no bet - ft') {
    if (s === '1' || s === 'home') return { family: 'DRAW_NO_BET', selection: '1', pred: F.DRAW_NO_BET.selections['1'].pred, refund: F.DRAW_NO_BET.selections['1'].refund };
    if (s === '2' || s === 'away') return { family: 'DRAW_NO_BET', selection: '2', pred: F.DRAW_NO_BET.selections['2'].pred, refund: F.DRAW_NO_BET.selections['2'].refund };
  }

  // BTTS - FT
  if (m === 'both teams to score - ft') {
    if (s === 'yes' || s === 'oui') return { family: 'BTTS', selection: 'yes', pred: F.BTTS.selections.yes.pred };
    if (s === 'no'  || s === 'non') return { family: 'BTTS', selection: 'no',  pred: F.BTTS.selections.no.pred };
  }

  // Total Score Over/Under - FT [X.Y]
  const ouMatch = m.match(/^total score over\/under - ft \[(-?\d+(?:\.\d+)?)\]$/);
  if (ouMatch) {
    const line = parseFloat(ouMatch[1]);
    if (isQuarter(line)) return null;
    if (s === 'over' || s === 'over ' + line) return { family: `OVER_UNDER_${line}`, selection: 'over', pred: (h,a) => (h + a) > line };
    if (s === 'under' || s === 'under ' + line) return { family: `OVER_UNDER_${line}`, selection: 'under', pred: (h,a) => (h + a) < line };
  }

  // Team totals O/U : "Total Score Over/Under - FT - Home Team [X.Y]"
  const ttHome = m.match(/^total score over\/under - ft - home team \[(-?\d+(?:\.\d+)?)\]$/);
  if (ttHome) {
    const line = parseFloat(ttHome[1]);
    if (isQuarter(line)) return null;
    if (s === 'over')  return { family: `TT_HOME_OU_${line}`, selection: 'over', pred: (h,_a) => h > line };
    if (s === 'under') return { family: `TT_HOME_OU_${line}`, selection: 'under', pred: (h,_a) => h < line };
  }
  const ttAway = m.match(/^total score over\/under - ft - away team \[(-?\d+(?:\.\d+)?)\]$/);
  if (ttAway) {
    const line = parseFloat(ttAway[1]);
    if (isQuarter(line)) return null;
    if (s === 'over')  return { family: `TT_AWAY_OU_${line}`, selection: 'over', pred: (_h,a) => a > line };
    if (s === 'under') return { family: `TT_AWAY_OU_${line}`, selection: 'under', pred: (_h,a) => a < line };
  }

  // Correct Score (26 Outcomes)
  if (m === 'correct score (26 outcomes)') {
    const sc = s.match(/^(\d+)\s*[:\-]\s*(\d+)$/);
    if (sc) {
      const x = parseInt(sc[1]), y = parseInt(sc[2]);
      return { family: 'CORRECT_SCORE', selection: `${x}-${y}`, pred: (h,a) => h === x && a === y };
    }
    if (/any other home win/i.test(selection)) return { family: 'CORRECT_SCORE', selection: 'anyHome', pred: (h,a) => h > a && (h >= 4 || a >= 3) };
    if (/any other away win/i.test(selection)) return { family: 'CORRECT_SCORE', selection: 'anyAway', pred: (h,a) => a > h && (a >= 4 || h >= 3) };
    if (/any other draw/i.test(selection))     return { family: 'CORRECT_SCORE', selection: 'anyDraw', pred: (h,a) => h === a && h >= 3 };
  }

  // Winning Margin - FT
  if (m === 'winning margin - ft') {
    const hp = s.match(/^home by (\d+)(\+?)$/i);
    if (hp) {
      const n = parseInt(hp[1]);
      const plus = hp[2] === '+';
      return { family: 'WINNING_MARGIN', selection: `home${plus?'+':'='}${n}`, pred: (h,a) => plus ? (h - a) >= n : (h - a) === n };
    }
    const ap = s.match(/^away by (\d+)(\+?)$/i);
    if (ap) {
      const n = parseInt(ap[1]);
      const plus = ap[2] === '+';
      return { family: 'WINNING_MARGIN', selection: `away${plus?'+':'='}${n}`, pred: (h,a) => plus ? (a - h) >= n : (a - h) === n };
    }
    if (/draw|match nul/i.test(s)) return { family: 'WINNING_MARGIN', selection: 'draw', pred: (h,a) => h === a };
    if (/no goal|scoreless/i.test(s)) return { family: 'WINNING_MARGIN', selection: 'noGoal', pred: (h,a) => h === 0 && a === 0 };
  }

  // Multigoals - FT
  if (m === 'multigoals - ft') {
    if (s === '0') return { family: 'MULTIGOALS', selection: '=0', pred: (h,a) => (h + a) === 0 };
    const range = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (range) {
      const lo = parseInt(range[1]), hi = parseInt(range[2]);
      return { family: `MULTIGOALS_${lo}_${hi}`, selection: `${lo}-${hi}`, pred: (h,a) => (h+a) >= lo && (h+a) <= hi };
    }
    const plus = s.match(/^(\d+)\+$/);
    if (plus) {
      const n = parseInt(plus[1]);
      return { family: `MULTIGOALS_${n}plus`, selection: `${n}+`, pred: (h,a) => (h + a) >= n };
    }
  }

  // Multigoals home / away
  if (m === 'multigoals - ft - home team') {
    if (s === '0') return { family: 'TT_HOME_MG', selection: '=0', pred: (h,_a) => h === 0 };
    const r = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (r) {
      const lo = parseInt(r[1]), hi = parseInt(r[2]);
      return { family: `TT_HOME_MG_${lo}_${hi}`, selection: `${lo}-${hi}`, pred: (h,_a) => h >= lo && h <= hi };
    }
    const p = s.match(/^(\d+)\+$/);
    if (p) { const n = parseInt(p[1]); return { family: `TT_HOME_MG_${n}plus`, selection: `${n}+`, pred: (h,_a) => h >= n }; }
  }
  if (m === 'multigoals - ft - away team') {
    if (s === '0') return { family: 'TT_AWAY_MG', selection: '=0', pred: (_h,a) => a === 0 };
    const r = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (r) {
      const lo = parseInt(r[1]), hi = parseInt(r[2]);
      return { family: `TT_AWAY_MG_${lo}_${hi}`, selection: `${lo}-${hi}`, pred: (_h,a) => a >= lo && a <= hi };
    }
    const p = s.match(/^(\d+)\+$/);
    if (p) { const n = parseInt(p[1]); return { family: `TT_AWAY_MG_${n}plus`, selection: `${n}+`, pred: (_h,a) => a >= n }; }
  }

  // Total Goals Exact - FT
  if (m === 'total goals exact - ft') {
    const n = s.match(/^(\d+)\+?$/);
    if (n) {
      const num = parseInt(n[1]);
      const plus = /\+$/.test(s);
      return { family: plus ? `EXACT_GOALS_${num}plus` : `EXACT_GOALS_${num}`, selection: plus ? `${num}+` : `=${num}`,
               pred: plus ? (h,a) => (h+a) >= num : (h,a) => (h+a) === num };
    }
  }
  if (m === 'total goals exact - ft - home team') {
    const n = s.match(/^(\d+)\+?$/);
    if (n) {
      const num = parseInt(n[1]);
      const plus = /\+$/.test(s);
      return { family: plus ? `TT_HOME_EXACT_${num}plus` : `TT_HOME_EXACT_${num}`, selection: plus ? `${num}+` : `=${num}`,
               pred: plus ? (h,_a) => h >= num : (h,_a) => h === num };
    }
  }
  if (m === 'total goals exact - ft - away team') {
    const n = s.match(/^(\d+)\+?$/);
    if (n) {
      const num = parseInt(n[1]);
      const plus = /\+$/.test(s);
      return { family: plus ? `TT_AWAY_EXACT_${num}plus` : `TT_AWAY_EXACT_${num}`, selection: plus ? `${num}+` : `=${num}`,
               pred: plus ? (_h,a) => a >= num : (_h,a) => a === num };
    }
  }

  // Asian Handicap - FT [line]
  const ahMatch = m.match(/^asian handicap - ft \[(-?\d+(?:\.\d+)?)\]$/);
  if (ahMatch) {
    const line = parseFloat(ahMatch[1]);
    if (isQuarter(line)) return null;
    if (s === '1' || s === 'home') return { family: `HANDICAP_ASIAN_${line}`, selection: 'home', pred: (h,a) => (h + line) > a, refund: (h,a) => (h + line) === a };
    if (s === '2' || s === 'away') return { family: `HANDICAP_ASIAN_${line}`, selection: 'away', pred: (h,a) => a > (h + line), refund: (h,a) => (h + line) === a };
  }

  // Handicap 1X2 - FT [line] (3-way)
  const h1x2Match = m.match(/^handicap 1x2 - ft \[(-?\d+(?:\.\d+)?)\]$/);
  if (h1x2Match) {
    const line = parseFloat(h1x2Match[1]);
    if (isQuarter(line)) return null;
    if (s === '1') return { family: `HANDICAP_1X2_${line}`, selection: '1', pred: (h,a) => (h + line) > a };
    if (s === 'x') return { family: `HANDICAP_1X2_${line}`, selection: 'X', pred: (h,a) => (h + line) === a };
    if (s === '2') return { family: `HANDICAP_1X2_${line}`, selection: '2', pred: (h,a) => a > (h + line) };
  }

  // Clean Sheet Home/Away Team - FT
  if (m === 'clean sheet home team - ft') {
    if (s === 'yes' || s === 'oui') return { family: 'CLEAN_SHEET_HOME', selection: 'yes', pred: (_h,a) => a === 0 };
    if (s === 'no'  || s === 'non') return { family: 'CLEAN_SHEET_HOME', selection: 'no',  pred: (_h,a) => a >= 1 };
  }
  if (m === 'clean sheet away team - ft') {
    if (s === 'yes' || s === 'oui') return { family: 'CLEAN_SHEET_AWAY', selection: 'yes', pred: (h,_a) => h === 0 };
    if (s === 'no'  || s === 'non') return { family: 'CLEAN_SHEET_AWAY', selection: 'no',  pred: (h,_a) => h >= 1 };
  }

  // 1X2 + BTTS combines
  if (m === '1x2 and both teams to score - ft') {
    return resolveResultBTTS(selection);
  }

  // 1X2 + Totals [line]
  const rt = m.match(/^1x2 and totals - ft \[(-?\d+(?:\.\d+)?)\]$/);
  if (rt) {
    const line = parseFloat(rt[1]);
    if (isQuarter(line)) return null;
    return resolveResultTotal(selection, line);
  }

  // Double Chance + BTTS
  if (m === 'double chance and both teams to score - ft') {
    return resolveDCBTTS(selection);
  }

  // Double Chance + Totals [line]
  const dct = m.match(/^double chance and totals - ft \[(-?\d+(?:\.\d+)?)\]$/);
  if (dct) {
    const line = parseFloat(dct[1]);
    if (isQuarter(line)) return null;
    return resolveDCTotal(selection, line);
  }

  // SKIP explicites
  if (m.includes('ht/ft')) return null;
  if (m.includes('score in both halves')) return null;
  if (m.includes('double chance 1up')) return null; // marche a regle particuliere

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1WIN
// ═══════════════════════════════════════════════════════════════════════════
function resolve1win({ market, selection, homeTeam, awayTeam }) {
  const m = norm(market);
  const s = norm(selection);

  if (m === 'full time result' || m === 'full time result (regular time)') {
    if (s === '1' || s === 'home' || s === 'w1') return { family: 'MATCH_1X2', selection: '1', pred: F.MATCH_1X2.selections['1'].pred };
    if (s === 'x' || s === 'draw') return { family: 'MATCH_1X2', selection: 'X', pred: F.MATCH_1X2.selections['X'].pred };
    if (s === '2' || s === 'away' || s === 'w2') return { family: 'MATCH_1X2', selection: '2', pred: F.MATCH_1X2.selections['2'].pred };
  }

  if (m === 'double chance') {
    if (s === '1x') return { family: 'DOUBLE_CHANCE', selection: '1X', pred: F.DOUBLE_CHANCE.selections['1X'].pred };
    if (s === 'x2') return { family: 'DOUBLE_CHANCE', selection: 'X2', pred: F.DOUBLE_CHANCE.selections['X2'].pred };
    if (s === '12') return { family: 'DOUBLE_CHANCE', selection: '12', pred: F.DOUBLE_CHANCE.selections['12'].pred };
  }

  if (m === 'both teams to score') {
    if (s === 'yes' || s === 'both teams to score') return { family: 'BTTS', selection: 'yes', pred: F.BTTS.selections.yes.pred };
    if (s === 'no' || s === 'both teams not to score') return { family: 'BTTS', selection: 'no', pred: F.BTTS.selections.no.pred };
  }

  // Total (over N.Y / under N.Y)
  if (m === 'total') {
    const ov = s.match(/^over\s+(\d+(?:\.\d+)?)$/i);
    if (ov) { const line = parseFloat(ov[1]); if (isQuarter(line)) return null; return { family: `OVER_UNDER_${line}`, selection: 'over', pred: (h,a) => (h+a) > line }; }
    const un = s.match(/^under\s+(\d+(?:\.\d+)?)$/i);
    if (un) { const line = parseFloat(un[1]); if (isQuarter(line)) return null; return { family: `OVER_UNDER_${line}`, selection: 'under', pred: (h,a) => (h+a) < line }; }
  }

  if (m === 'odd/even') {
    if (s === 'odd') return { family: 'TOTAL_ODD_EVEN', selection: 'odd', pred: F.TOTAL_ODD_EVEN.selections.odd.pred };
    if (s === 'even') return { family: 'TOTAL_ODD_EVEN', selection: 'even', pred: F.TOTAL_ODD_EVEN.selections.even.pred };
  }

  if (m === 'exact number of goals') {
    const n = s.match(/^(\d+)$/);
    if (n) { const num = parseInt(n[1]); return { family: `EXACT_GOALS_${num}`, selection: `=${num}`, pred: (h,a) => (h+a) === num }; }
    const p = s.match(/^(\d+)\+$/);
    if (p) { const num = parseInt(p[1]); return { family: `EXACT_GOALS_${num}plus`, selection: `${num}+`, pred: (h,a) => (h+a) >= num }; }
  }

  if (m === 'correct score') {
    const sc = s.match(/^(\d+)\s*[:\-]\s*(\d+)$/);
    if (sc) { const x = parseInt(sc[1]), y = parseInt(sc[2]); return { family: 'CORRECT_SCORE', selection: `${x}-${y}`, pred: (h,a) => h === x && a === y }; }
  }

  // 1win combines : "Result and both teams to score"
  if (m === 'result and both teams to score') {
    return resolveResultBTTS(selection);
  }
  // "Result and total"
  if (m === 'result and total') {
    // Format : "1 And Over 2.5" ou "1 & Under 2.5"
    const parts = selection.toLowerCase().split(/\s+and\s+|\s*&\s*/);
    if (parts.length === 2) {
      const [sideRaw, ouRaw] = parts;
      const side = sideRaw.trim();
      const ou = ouRaw.match(/^(over|under)\s+(\d+(?:\.\d+)?)$/i);
      if (ou) {
        const line = parseFloat(ou[2]);
        if (isQuarter(line)) return null;
        const isOver = /over/i.test(ou[1]);
        const sel = `${side}/${isOver ? 'over' : 'under'}`;
        const spec = F.RESULT_AND_TOTAL(line).selections[sel];
        if (spec) return { family: `RESULT_AND_TOTAL_${line}`, selection: `${side.toUpperCase()}/${isOver?'O':'U'}${line}`, pred: spec.pred };
      }
    }
    return null;
  }
  if (m === 'total and both teams to score') {
    // Ex : "Over 2.5 And Yes"
    const parts = selection.toLowerCase().split(/\s+and\s+|\s*&\s*/);
    if (parts.length === 2) {
      const ou = parts[0].match(/^(over|under)\s+(\d+(?:\.\d+)?)$/);
      const yn = /^(yes|no)$/.test(parts[1].trim()) ? parts[1].trim() : null;
      if (ou && yn) {
        const line = parseFloat(ou[2]);
        if (isQuarter(line)) return null;
        const isOver = ou[1] === 'over';
        const isYes = yn === 'yes';
        return {
          family: `BTTS_AND_TOTAL_${line}`, selection: `${isYes?'YES':'NO'}/${isOver?'O':'U'}${line}`,
          pred: (h,a) => {
            const btts = isYes ? (h >= 1 && a >= 1) : (h === 0 || a === 0);
            const oouu = isOver ? (h+a) > line : (h+a) < line;
            return btts && oouu;
          }
        };
      }
    }
    return null;
  }

  // Handicap nu 1win (format "W1 (-1.5)" ou "Home (-0.5)")
  if (m === 'handicap') {
    const p = selection.match(/^(w1|w2|home|away|1|2)\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*\)$/i);
    if (p) {
      const [, side, hcpStr] = p;
      const line = parseFloat(hcpStr);
      if (isQuarter(line)) return null;
      const isHome = /^(w1|home|1)$/i.test(side);
      if (isHome) return { family: `HANDICAP_ASIAN_${line}`, selection: 'home', pred: (h,a) => (h + line) > a, refund: (h,a) => (h + line) === a };
      return { family: `HANDICAP_ASIAN_${line}`, selection: 'away', pred: (h,a) => a > (h + line), refund: (h,a) => (h + line) === a };
    }
  }

  if (m === 'to win to nil') {
    // Ambigu : peut etre home ou away. On skip pour eviter les faux positifs.
    return null;
  }

  // SKIP HT/FT et halves
  if (m === 'halftime/fulltime' || m.includes('halves') || m === 'to win both halves' || m === 'to win either half' || m === 'to score in both halves') return null;
  // SKIP early payout (regles particulieres)
  if (m.includes('early payout')) return null;

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1XBET (limite aux 11 marches KEEP explicites, en attendant mapping des groupes)
// ═══════════════════════════════════════════════════════════════════════════
function resolve1xbet({ market, selection, homeTeam, awayTeam }) {
  const m = norm(market);
  const s = norm(selection);

  if (m === 'match result') {
    if (s === 'home' || s === '1' || s === 'w1') return { family: 'MATCH_1X2', selection: '1', pred: F.MATCH_1X2.selections['1'].pred };
    if (s === 'draw' || s === 'x') return { family: 'MATCH_1X2', selection: 'X', pred: F.MATCH_1X2.selections['X'].pred };
    if (s === 'away' || s === '2' || s === 'w2') return { family: 'MATCH_1X2', selection: '2', pred: F.MATCH_1X2.selections['2'].pred };
  }
  if (m === 'double chance') {
    if (s === '1x') return { family: 'DOUBLE_CHANCE', selection: '1X', pred: F.DOUBLE_CHANCE.selections['1X'].pred };
    if (s === '12') return { family: 'DOUBLE_CHANCE', selection: '12', pred: F.DOUBLE_CHANCE.selections['12'].pred };
    if (s === 'x2') return { family: 'DOUBLE_CHANCE', selection: 'X2', pred: F.DOUBLE_CHANCE.selections['X2'].pred };
  }
  if (m === 'both teams to score') {
    if (s === 'yes') return { family: 'BTTS', selection: 'yes', pred: F.BTTS.selections.yes.pred };
    if (s === 'no')  return { family: 'BTTS', selection: 'no',  pred: F.BTTS.selections.no.pred };
  }
  // Over/Under : "Over [2.5]" / "Under [3.5]"
  if (m === 'over/under') {
    const p = s.match(/^(over|under)\s*\[(-?\d+(?:\.\d+)?)\]$/);
    if (p) {
      const line = parseFloat(p[2]);
      if (isQuarter(line)) return null;
      if (p[1] === 'over') return { family: `OVER_UNDER_${line}`, selection: 'over', pred: (h,a) => (h+a) > line };
      if (p[1] === 'under') return { family: `OVER_UNDER_${line}`, selection: 'under', pred: (h,a) => (h+a) < line };
    }
  }
  if (m === 'team 1 total') {
    const p = s.match(/^(over|under)\s*\[(-?\d+(?:\.\d+)?)\]$/);
    if (p) {
      const line = parseFloat(p[2]);
      if (isQuarter(line)) return null;
      if (p[1] === 'over') return { family: `TT_HOME_OU_${line}`, selection: 'over', pred: (h,_a) => h > line };
      if (p[1] === 'under') return { family: `TT_HOME_OU_${line}`, selection: 'under', pred: (h,_a) => h < line };
    }
  }
  if (m === 'team 2 total') {
    const p = s.match(/^(over|under)\s*\[(-?\d+(?:\.\d+)?)\]$/);
    if (p) {
      const line = parseFloat(p[2]);
      if (isQuarter(line)) return null;
      if (p[1] === 'over') return { family: `TT_AWAY_OU_${line}`, selection: 'over', pred: (_h,a) => a > line };
      if (p[1] === 'under') return { family: `TT_AWAY_OU_${line}`, selection: 'under', pred: (_h,a) => a < line };
    }
  }
  if (m === 'odd/even') {
    if (s === 'odd') return { family: 'TOTAL_ODD_EVEN', selection: 'odd', pred: F.TOTAL_ODD_EVEN.selections.odd.pred };
    if (s === 'even') return { family: 'TOTAL_ODD_EVEN', selection: 'even', pred: F.TOTAL_ODD_EVEN.selections.even.pred };
  }
  if (m === 'correct score') {
    const sc = s.match(/^(\d+)\s*[:\-]\s*(\d+)$/);
    if (sc) { const x=parseInt(sc[1]), y=parseInt(sc[2]); return { family: 'CORRECT_SCORE', selection: `${x}-${y}`, pred: (h,a) => h === x && a === y }; }
  }
  if (m === 'multigoals') {
    if (s === '0') return { family: 'MULTIGOALS_0', selection: '=0', pred: (h,a) => (h+a) === 0 };
    const r = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (r) { const lo=parseInt(r[1]), hi=parseInt(r[2]); return { family: `MULTIGOALS_${lo}_${hi}`, selection: `${lo}-${hi}`, pred: (h,a) => (h+a) >= lo && (h+a) <= hi }; }
    const p = s.match(/^(\d+)\+$/);
    if (p) { const n=parseInt(p[1]); return { family: `MULTIGOALS_${n}plus`, selection: `${n}+`, pred: (h,a) => (h+a) >= n }; }
  }
  if (m === 'exact goals') {
    const n = s.match(/^(\d+)$/);
    if (n) { const num=parseInt(n[1]); return { family: `EXACT_GOALS_${num}`, selection: `=${num}`, pred: (h,a) => (h+a) === num }; }
  }
  if (m === 'handicap') {
    const p = s.match(/^(home|away)\s*\((-?\d+(?:\.\d+)?)\)$/i);
    if (p) {
      const line = parseFloat(p[2]);
      if (isQuarter(line)) return null;
      if (/home/i.test(p[1])) return { family: `HANDICAP_ASIAN_${line}`, selection: 'home', pred: (h,a) => (h + line) > a, refund: (h,a) => (h + line) === a };
      return { family: `HANDICAP_ASIAN_${line}`, selection: 'away', pred: (h,a) => a > (h + line), refund: (h,a) => (h + line) === a };
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS COMMUNS
// ═══════════════════════════════════════════════════════════════════════════
function isQuarter(line) {
  const frac = Math.abs(line) % 0.5;
  return frac > 0.01 && frac < 0.49;
}

function resolveResultBTTS(selection) {
  const s = String(selection).toLowerCase().replace(/\s+/g, '');
  const combo = s.match(/^([12x])[\/&\-](oui|non|yes|no)$/);
  if (!combo) return null;
  const [, side, yn] = combo;
  const isYes = /oui|yes/i.test(yn);
  const sel = `${side}/${isYes ? 'yes' : 'no'}`;
  const spec = F.RESULT_AND_BTTS.selections[sel];
  if (!spec) return null;
  return { family: 'RESULT_AND_BTTS', selection: `${side.toUpperCase()}/${isYes ? 'yes' : 'no'}`, pred: spec.pred, label: spec.label };
}

function resolveResultTotal(selection, line) {
  const s = String(selection).toLowerCase();
  // Format "1 & Over" / "1 - Under" / "1/Over 2.5"
  const parts = s.split(/\s*[&\/\-]\s*/).map(p => p.trim());
  if (parts.length !== 2) return null;
  const side = parts[0];
  const ou = parts[1].match(/^(over|under)(?:\s*\d+(?:\.\d+)?)?$/);
  if (!ou) return null;
  const isOver = ou[1] === 'over';
  const sel = `${side}/${isOver ? 'over' : 'under'}`;
  const spec = F.RESULT_AND_TOTAL(line).selections[sel];
  if (!spec) return null;
  return { family: `RESULT_AND_TOTAL_${line}`, selection: `${side.toUpperCase()}/${isOver?'O':'U'}${line}`, pred: spec.pred };
}

function resolveDCBTTS(selection) {
  const s = String(selection).toLowerCase().replace(/\s+/g, '');
  const combo = s.match(/^(1x|x2|12)[\/&\-](oui|non|yes|no)$/);
  if (!combo) return null;
  const [, side, yn] = combo;
  const isYes = /oui|yes/i.test(yn);
  const sel = `${side}/${isYes ? 'yes' : 'no'}`;
  const spec = F.DC_AND_BTTS.selections[sel];
  if (!spec) return null;
  return { family: 'DC_AND_BTTS', selection: `${side.toUpperCase()}/${isYes ? 'yes' : 'no'}`, pred: spec.pred };
}

function resolveDCTotal(selection, line) {
  const s = String(selection).toLowerCase();
  const parts = s.split(/\s*[&\/\-]\s*/).map(p => p.trim());
  if (parts.length !== 2) return null;
  const side = parts[0];
  const ou = parts[1].match(/^(over|under)(?:\s*\d+(?:\.\d+)?)?$/);
  if (!ou) return null;
  const isOver = ou[1] === 'over';
  const sel = `${side}/${isOver ? 'over' : 'under'}`;
  const spec = F.DC_AND_TOTAL(line).selections[sel];
  if (!spec) return null;
  return { family: `DC_AND_TOTAL_${line}`, selection: `${side.toUpperCase()}/${isOver?'O':'U'}${line}`, pred: spec.pred };
}

// ═══════════════════════════════════════════════════════════════════════════
// DISPATCH
// ═══════════════════════════════════════════════════════════════════════════
const RESOLVERS = {
  congobet: resolveCongobet,
  betpawa: resolveBetpawa,
  '1win': resolve1win,
  '1xbet': resolve1xbet,
};

export function resolveOutcome({ book, market, selection, homeTeam, awayTeam }) {
  const fn = RESOLVERS[book];
  if (!fn) return null;
  try {
    return fn({ market, selection, homeTeam, awayTeam });
  } catch (e) {
    return null;
  }
}
