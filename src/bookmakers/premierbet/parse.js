// Parseur PremierBet — mapping DIFFÉRENT en PREMATCH vs LIVE.
// Découverte critique (probe live dump 2026-08-02) : les market IDs changent
// entre les 2 endpoints. Ex : id=3 en prematch = "1X2", en live = "Handicap".
// Sans distinguer, les cotes handicap étaient lues comme 1X2 → fake arbs
// massifs (bug user : cote 12.50 sur équipe qui perdait).
import { isHalfLine } from '../../core/markets.js';

// Strip score suffix [0:1] des outcome names en live (id=7, 8, 27, 28 etc.)
function cleanName(n) {
  return String(n || '').replace(/\[\d+:\d+\]/g, '').trim();
}

// byNameFull retourne { label: outcomeObject } au lieu de { label: cote }.
// Utilisé par les helpers refactorés pour retrouver l'outcome complet et son
// nom natif exact (o.name) au moment d'écrire dans _ids.
function byNameFull(outcomes) {
  const map = {};
  for (const o of (outcomes || [])) {
    const v = Number(o.value);
    if (Number.isFinite(v) && v > 1) map[cleanName(o.name)] = o;
  }
  return map;
}

// Helper écrit odds[key] = v ET odds._ids[key] avec les 3 champs libellés natifs
// (P2 dev report 2026-08-14). PremierBet n'expose pas de coupon code natif dans
// l'API guineegames — seuls les libellés sont capturés.
function pbPut(odds, key, v, m, outcomeName) {
  odds[key] = v;
  if (!odds._ids) odds._ids = {};
  odds._ids[key] = {
    market_name_native: m?.name ? String(m.name) : null,
    selection_name_native: outcomeName ? String(outcomeName) : null,
    market_path_native: null,
  };
}

// Helpers réutilisables (mêmes formats prematch/live pour les markets sans score suffix)
function put1x2(m, pfx, odds) {
  const p = byNameFull(m.outcomes);
  const o1 = p['1']; const oX = p['X'] || p['x']; const o2 = p['2'];
  if (o1) pbPut(odds, `${pfx}match_1`, Number(o1.value), m, o1.name);
  if (oX) pbPut(odds, `${pfx}match_X`, Number(oX.value), m, oX.name);
  if (o2) pbPut(odds, `${pfx}match_2`, Number(o2.value), m, o2.name);
}
function putDC(m, pfx, odds) {
  const p = byNameFull(m.outcomes);
  const o1X = p['1X'] || p['1x']; const o12 = p['12']; const oX2 = p['X2'] || p['x2'];
  if (o1X) pbPut(odds, `${pfx}dc_1X`, Number(o1X.value), m, o1X.name);
  if (o12) pbPut(odds, `${pfx}dc_12`, Number(o12.value), m, o12.name);
  if (oX2) pbPut(odds, `${pfx}dc_X2`, Number(oX2.value), m, oX2.name);
}
function putBtts(m, pfx, odds) {
  const p = byNameFull(m.outcomes);
  const yes = p['Oui'] || p['Yes'] || p['oui'] || p['yes'];
  const no = p['Non'] || p['No'] || p['non'] || p['no'];
  if (yes) pbPut(odds, `${pfx}btts_yes`, Number(yes.value), m, yes.name);
  if (no) pbPut(odds, `${pfx}btts_no`, Number(no.value), m, no.name);
}
function putDnb(m, pfx, odds) {
  const p = byNameFull(m.outcomes);
  if (p['1']) pbPut(odds, `${pfx}dnb_1`, Number(p['1'].value), m, p['1'].name);
  if (p['2']) pbPut(odds, `${pfx}dnb_2`, Number(p['2'].value), m, p['2'].name);
}
function putOddEven(m, pfx, odds) {
  const p = byNameFull(m.outcomes);
  const odd = p['Impair'] || p['Odd'] || p['impair'] || p['odd'];
  const even = p['Pair'] || p['Even'] || p['pair'] || p['even'];
  if (odd) pbPut(odds, `${pfx}odd`, Number(odd.value), m, odd.name);
  if (even) pbPut(odds, `${pfx}even`, Number(even.value), m, even.name);
}
function putTotalMultiLine(m, pfx, odds) {
  for (const o of (m.outcomes || [])) {
    const hRaw = o.handicap;
    if (hRaw == null) continue;
    const line = Number(String(hRaw).replace(/^\+/, ''));
    if (!Number.isFinite(line) || !isHalfLine(line)) continue;
    const nm = String(o.name || '').toLowerCase();
    const v = Number(o.value);
    if (!Number.isFinite(v) || v <= 1) continue;
    if (/plus|over|\+/.test(nm)) pbPut(odds, `${pfx}over_${line}`, v, m, o.name);
    else if (/moins|under/.test(nm)) pbPut(odds, `${pfx}under_${line}`, v, m, o.name);
  }
}
function putTeamTotalMultiLine(m, side, pfx, odds) {
  for (const o of (m.outcomes || [])) {
    const hRaw = o.handicap;
    if (hRaw == null) continue;
    const line = Number(String(hRaw).replace(/^\+/, ''));
    if (!Number.isFinite(line) || !isHalfLine(line)) continue;
    const nm = String(o.name || '').toLowerCase();
    const v = Number(o.value);
    if (!Number.isFinite(v) || v <= 1) continue;
    if (/plus|over|\+/.test(nm)) pbPut(odds, `${pfx}tt_${side}_over_${line}`, v, m, o.name);
    else if (/moins|under/.test(nm)) pbPut(odds, `${pfx}tt_${side}_under_${line}`, v, m, o.name);
  }
}
function putHcpMultiLine(m, pfx, odds) {
  for (const o of (m.outcomes || [])) {
    const hRaw = o.handicap;
    if (hRaw == null) continue;
    const line = Number(String(hRaw).replace(/^\+/, ''));
    if (!Number.isFinite(line) || !isHalfLine(line)) continue;
    const nm = String(o.name || '').trim();
    const v = Number(o.value);
    if (!Number.isFinite(v) || v <= 1) continue;
    if (nm === '1') pbPut(odds, `${pfx}hcp_home_${line}`, v, m, o.name);
    else if (nm === '2') pbPut(odds, `${pfx}hcp_away_${line}`, v, m, o.name);
  }
}
function putHighestScoringHalf(m, odds) {
  const p = byNameFull(m.outcomes);
  const first = p['1er'] || p['1ère Mi-Temps'] || p['1ere Mi-Temps'];
  const second = p['2ème'] || p['2ème Mi-Temps'] || p['2eme Mi-Temps'];
  const equal = p['Egalité'] || p['Égalité'] || p['Equal'];
  if (first) pbPut(odds, 'half_most_ht', Number(first.value), m, first.name);
  if (second) pbPut(odds, 'half_most_h2', Number(second.value), m, second.name);
  if (equal) pbPut(odds, 'half_most_equal', Number(equal.value), m, equal.name);
}

// ─── MAPPING PREMATCH (dump F12 initial) ─────────────────────────
function parsePrematch(markets, odds) {
  for (const m of markets) {
    const id = String(m.id || '');
    switch (id) {
      case '3': put1x2(m, '', odds); break;
      case '7': putBtts(m, '', odds); break;
      case '17': putDC(m, '', odds); break;
      case '18': putDnb(m, '', odds); break;
      case '23': putHcpMultiLine(m, '', odds); break;
      case '29': putTotalMultiLine(m, 'match_', odds); break;
      case '353': putTeamTotalMultiLine(m, 'home', '', odds); break;
      case '352': putTeamTotalMultiLine(m, 'away', '', odds); break;
      case '35': putHighestScoringHalf(m, odds); break;
      case '16': putOddEven(m, '', odds); break;
      case '6': put1x2(m, 'ht_', odds); break;
      case '155': putBtts(m, 'ht_', odds); break;
      case '44': putDC(m, 'ht_', odds); break;
      case '19': putDnb(m, 'ht_', odds); break;
      case '119': putTotalMultiLine(m, 'ht_', odds); break;
      case '392': putTeamTotalMultiLine(m, 'home', 'ht_', odds); break;
      case '393': putTeamTotalMultiLine(m, 'away', 'ht_', odds); break;
      case '396': putHcpMultiLine(m, 'ht_', odds); break;
      case '96': put1x2(m, 'h2_', odds); break;
      case '156': putBtts(m, 'h2_', odds); break;
      case '45': putDC(m, 'h2_', odds); break;
      case '120': putTotalMultiLine(m, 'h2_', odds); break;
      case '397': putTeamTotalMultiLine(m, 'home', 'h2_', odds); break;
      case '398': putTeamTotalMultiLine(m, 'away', 'h2_', odds); break;
      case '111': put1x2(m, 'cor_', odds); break;
      case '107': putTotalMultiLine(m, 'cor_', odds); break;
      case '1852': putTeamTotalMultiLine(m, 'home', 'cor_', odds); break;
      case '1853': putTeamTotalMultiLine(m, 'away', 'cor_', odds); break;
      case '109': putHcpMultiLine(m, 'cor_', odds); break;
      case '113': putOddEven(m, 'cor_', odds); break;
      case '110': putHcpMultiLine(m, 'cor_ht_', odds); break;
      default: break;
    }
  }
}

// ─── MAPPING LIVE (dump 2026-08-02 : IDs complètement différents) ─
// SÉCURITAIRE : ne mappe QUE les markets vérifiés dans le dump live.
// Les markets ambigus (id=3 handicap avec score suffix, id=7 "reste du match",
// id=18 combo 1X2+total, id=12 score exact) sont IGNORÉS pour éviter fake arbs.
function parseLive(markets, odds) {
  for (const m of markets) {
    const id = String(m.id || '');
    switch (id) {
      // Full time
      case '1': put1x2(m, '', odds); break;                          // 1X2 (live: id=1, prematch: id=3)
      case '2': putTotalMultiLine(m, 'match_', odds); break;         // Total match
      case '6': putDnb(m, '', odds); break;                          // DNB (live: id=6, prematch: id=18)
      case '9': putDC(m, '', odds); break;                           // DC (live: id=9, prematch: id=17)
      case '15': putTeamTotalMultiLine(m, 'home', '', odds); break;  // Home total
      case '16': putTeamTotalMultiLine(m, 'away', '', odds); break;  // Away total
      case '17': putBtts(m, '', odds); break;                        // BTTS (live: id=17, prematch: id=7)
      case '20': putOddEven(m, '', odds); break;                     // Odd/Even
      case '21': putHighestScoringHalf(m, odds); break;              // Highest scoring half
      // 1ère mi-temps
      case '23': put1x2(m, 'ht_', odds); break;                      // 1MT 1X2 (live: id=23, prematch: id=6)
      case '24': putTotalMultiLine(m, 'ht_', odds); break;           // 1MT Total
      case '56': putDnb(m, 'ht_', odds); break;                      // 1MT DNB
      case '147': putDC(m, 'ht_', odds); break;                      // 1MT DC (live: id=147, prematch: id=44)
      case '724': putBtts(m, 'ht_', odds); break;                    // 1MT BTTS (live: id=724, prematch: id=155)
      case '2509': putTeamTotalMultiLine(m, 'home', 'ht_', odds); break; // 1MT home total
      case '2510': putTeamTotalMultiLine(m, 'away', 'ht_', odds); break; // 1MT away total
      // 2ème mi-temps
      case '33': put1x2(m, 'h2_', odds); break;                      // 2MT 1X2 (live: id=33, prematch: id=96)
      case '34': putTotalMultiLine(m, 'h2_', odds); break;           // 2MT Total
      case '611': putDnb(m, 'h2_', odds); break;                     // 2MT DNB
      case '743': putDC(m, 'h2_', odds); break;                      // 2MT DC (live: id=743, prematch: id=45)
      case '744': putBtts(m, 'h2_', odds); break;                    // 2MT BTTS
      // Corners
      case '109': putTotalMultiLine(m, 'cor_', odds); break;         // Corners total
      case '115': putTeamTotalMultiLine(m, 'home', 'cor_', odds); break;
      case '116': putTeamTotalMultiLine(m, 'away', 'cor_', odds); break;
      case '93': putHcpMultiLine(m, 'cor_', odds); break;            // Corner handicap
      // IGNORÉS explicitement (risque fake arbs) :
      // 3 (Handicap avec score suffix [0:1] non-standard)
      // 7 (Rest of match winner — pas comparable cross-book)
      // 8, 27, 28 (Next goal — non 2-way pur)
      // 12 (Score exact — 26+ outcomes)
      // 18 (1X2 + Total combo)
      // 88 (Corner matchbet — 3-way)
      // 294, 725, 731, 720, 721, 743 (autres combos)
      // 30, 125, 126, 127, 123, 611, 716, 747, 2509, 2510 déjà mappés
      default: break;
    }
  }
}

export function premierbetFlatOdds(markets, { live = false, sport = 'football' } = {}) {
  const odds = { _ids: {} };
  if (sport === 'tennis') parseTennis(markets, odds);
  else if (sport === 'basket') parseBasket(markets, odds);
  else if (sport === 'hockey') parseHockey(markets, odds);
  else if (live) parseLive(markets, odds);
  else parsePrematch(markets, odds);
  return odds;
}

// ═══════════════════════════════════════════════════════════════
// PARSEUR TENNIS PremierBet (guineegames sportId=5).
// Verifie via dict-premierbet-tennis probe : 7 marketIds, 6 utiles.
// Structure outcomes : name="1"/"2" (winner/hcp) ou "plus de"/"moins de" (total).
// Handicap : outcome.handicap = ligne (signe inclus).
// ═══════════════════════════════════════════════════════════════
function putTennisWinner(m, pfx, odds) {
  const p = byNameFull(m.outcomes);
  if (p['1']) pbPut(odds, `${pfx}match_1`, Number(p['1'].value), m, p['1'].name);
  if (p['2']) pbPut(odds, `${pfx}match_2`, Number(p['2'].value), m, p['2'].name);
}
// FIX fake arb tennis 40% : ne PAS flipper le signe pour l'outcome "2".
// PB fournit deja les 2 outcomes complementaires avec leurs signes propres :
// "1" home h=-1.5 (home -1.5) + "2" away h=+1.5 (away +1.5). Le flip
// `${-h}` ancien stockait away sous la meme polarite que home → l'arb
// pairait home_-2.5 (Tirante -2.5) avec away_+2.5 KEY (qui contenait en
// realite Fritz -2.5) → 2 paris identiques marches comme complementaires.
// Convention identique au parseur foot putHcpMultiLine (${line} sans flip).
function putTennisHcp(m, pfx, odds) {
  for (const o of (m.outcomes || [])) {
    const v = Number(o.value);
    if (!Number.isFinite(v) || v <= 1) continue;
    const h = o.handicap != null ? Number(String(o.handicap).replace(/^\+/, '')) : null;
    if (h == null || !isHalfLine(Math.abs(h))) continue;
    const nm = cleanName(o.name);
    if (nm === '1') pbPut(odds, `${pfx}hcp_home_${h}`, v, m, o.name);
    else if (nm === '2') pbPut(odds, `${pfx}hcp_away_${h}`, v, m, o.name);
  }
}
function putTennisTotal(m, pfx, odds) {
  for (const o of (m.outcomes || [])) {
    const v = Number(o.value);
    if (!Number.isFinite(v) || v <= 1) continue;
    const h = o.handicap != null ? Number(String(o.handicap).replace(/^\+/, '')) : null;
    if (h == null || !isHalfLine(h)) continue;
    const nm = (o.name || '').toLowerCase().trim();
    if (/plus|over/.test(nm)) pbPut(odds, `${pfx}over_${h}`, v, m, o.name);
    else if (/moins|under/.test(nm)) pbPut(odds, `${pfx}under_${h}`, v, m, o.name);
  }
}

function parseTennis(markets, odds) {
  for (const m of markets) {
    const id = String(m.id || '');
    switch (id) {
      case '4':   putTennisWinner(m, '', odds); break;         // Gagnant Du Match
      case '23':  putTennisHcp(m, '', odds); break;            // Jeux Handicap
      case '64':  putTennisTotal(m, 'match_', odds); break;    // Plus De/Moins De (total games)
      case '33':  putTennisWinner(m, 's1_', odds); break;      // Gagnant 1er Set
      case '340': putTennisTotal(m, 's1_', odds); break;       // Total 1er Set
      // IGNORE : 219 (1er Set - Score Exact, granulaire)
      // DESACTIVE : 339 (Handicap 1er Set) — le marche existe sur guineegames
      // mais pas sur l'app PremierBet Congo cote user → arbs non-actionnables
      // + valeurs suspectes (1.78/1.79 sur matchs desequilibres 5.60 vs 1.08
      // = odds trop hautes). Reactiver seulement apres cross-check PB Congo.
      default: break;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// PARSEUR BASKET PremierBet (guineegames sportId basket).
// Probe discovery : 32 marketIds observes ; on mappe 22 utiles.
// Convention keys : match_* / h1_* (1MT = mi-temps NBA) / qN_* (quarter).
// Handicap/Total : outcome.handicap = ligne signee, isHalfLine filtre.
// Winner 2-way (id=4, id=354-357) : put1x2 suffit (X absent en basket 2-way).
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// PARSEUR HOCKEY PremierBet (guineegames sportId=4, KHL).
// Hockey a un vrai 3-way regulation (60min), donc 1X2 s'applique. Les market
// IDs guineegames sont partages cross-sport pour les marches generiques :
// 3=1X2, 23=Handicap, 29=Total, 352/353=TT home/away, 16=Odd/Even, 17=DC,
// 18=DNB, 6=1MT 1X2 (P1 pour hockey), 396=1MT Handicap, 119=1MT Total.
// V1 conservateur : full-time only ; periodes P1/P2/P3 en follow-up apres probe.
// ═══════════════════════════════════════════════════════════════
// Hockey PremierBet marketIds decouverts via probe-hockey-premierbet-raw
// (Lokomotiv Iaroslavl vs Traktor Tcheliabinsk KHL, 5 marketIds distincts) :
//   3   = "1X2" (regulation 3-way)
//   66  = "Handicap (Prolongations Incl.)" (multi-line hcp)
//   67  = "IceHockeyOddType.TotalSpreadsovertime" (Total incl OT, alias 377)
//   377 = "Plus de/Moins de (Prolongations Incl.)" (Total incl OT)
//   378 = "Gagnant du Match (Prolongations Incl.)" (Winner 2-way IGNORE
//         — semantique differente du 3-way regulation)
function parseHockey(markets, odds) {
  for (const m of markets) {
    const id = String(m.id || '');
    switch (id) {
      case '3':   put1x2(m, '', odds); break;                     // 1X2 regulation
      case '66':  putHcpMultiLine(m, '', odds); break;            // Handicap incl OT
      case '67':  putTotalMultiLine(m, 'match_', odds); break;    // Total incl OT (alias KHL)
      case '377': putTotalMultiLine(m, 'match_', odds); break;    // Total incl OT (principal KHL)
      case '28':  putTotalMultiLine(m, 'match_', odds); break;    // Total incl OT (alias sources bielorusse/slovaque)
      // Skip marketId=378 (Gagnant incl OT 2-way) — pas comparable au 3-way regulation.
      // Skip aussi les marketIds foot (7/17/18/23/29/352/353/16) : n'existent pas en
      // hockey PB (confirme via probe raw).
      default: break;
    }
  }
}

function parseBasket(markets, odds) {
  for (const m of markets) {
    const id = String(m.id || '');
    switch (id) {
      // Full time (inclut prolongations)
      case '4':   put1x2(m, '', odds); break;                        // Gagnant Du Match (2-way)
      case '16':  putOddEven(m, '', odds); break;                    // Pair/Impair total
      case '23':  putHcpMultiLine(m, '', odds); break;               // Handicap incl OT
      case '24':  putTotalMultiLine(m, 'match_', odds); break;       // Total Points incl OT
      case '352': putTeamTotalMultiLine(m, 'away', '', odds); break; // Away TT
      case '353': putTeamTotalMultiLine(m, 'home', '', odds); break; // Home TT
      // 1ère mi-temps (H1)
      case '6':   put1x2(m, 'h1_', odds); break;                     // 1MT 1X2 (peut avoir X)
      case '25':  putHcpMultiLine(m, 'h1_', odds); break;            // 1MT Handicap
      case '26':  putTotalMultiLine(m, 'h1_', odds); break;          // 1MT Total
      case '49':  putOddEven(m, 'h1_', odds); break;                 // 1MT Pair/Impair
      // Quart-temps (Q1-Q4)
      case '354': put1x2(m, 'q1_', odds); break;                     // Q1 1X2
      case '355': put1x2(m, 'q2_', odds); break;                     // Q2 1X2
      case '356': put1x2(m, 'q3_', odds); break;                     // Q3 1X2
      case '357': put1x2(m, 'q4_', odds); break;                     // Q4 1X2
      case '362': putTotalMultiLine(m, 'q1_', odds); break;          // Q1 Total
      case '363': putTotalMultiLine(m, 'q2_', odds); break;          // Q2 Total
      case '364': putTotalMultiLine(m, 'q3_', odds); break;          // Q3 Total
      case '365': putTotalMultiLine(m, 'q4_', odds); break;          // Q4 Total
      case '366': putHcpMultiLine(m, 'q1_', odds); break;            // Q1 Handicap
      case '367': putHcpMultiLine(m, 'q2_', odds); break;            // Q2 Handicap
      case '368': putHcpMultiLine(m, 'q3_', odds); break;            // Q3 Handicap
      case '369': putHcpMultiLine(m, 'q4_', odds); break;            // Q4 Handicap
      case '370': putOddEven(m, 'q1_', odds); break;                 // Q1 Pair/Impair
      case '371': putOddEven(m, 'q2_', odds); break;                 // Q2 Pair/Impair
      case '372': putOddEven(m, 'q3_', odds); break;                 // Q3 Pair/Impair
      case '373': putOddEven(m, 'q4_', odds); break;                 // Q4 Pair/Impair
      // IGNORE explicite : 15 (MT/FT combo), 36 (result+total combo),
      // 51 (OT y/n), 52 (marge victoire), 62 (highest quarter),
      // 772 (2 points ahead) — non 2-way pur, non comparables cross-book.
      default: break;
    }
  }
}
