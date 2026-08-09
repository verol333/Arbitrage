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

function byName(outcomes) {
  const map = {};
  for (const o of (outcomes || [])) {
    const v = Number(o.value);
    if (Number.isFinite(v) && v > 1) map[cleanName(o.name)] = v;
  }
  return map;
}

// Helpers réutilisables (mêmes formats prematch/live pour les markets sans score suffix)
function put1x2(m, pfx, odds) {
  const p = byName(m.outcomes);
  if (p['1']) odds[`${pfx}match_1`] = p['1'];
  if (p['X'] || p['x']) odds[`${pfx}match_X`] = p['X'] || p['x'];
  if (p['2']) odds[`${pfx}match_2`] = p['2'];
}
function putDC(m, pfx, odds) {
  const p = byName(m.outcomes);
  if (p['1X'] || p['1x']) odds[`${pfx}dc_1X`] = p['1X'] || p['1x'];
  if (p['12']) odds[`${pfx}dc_12`] = p['12'];
  if (p['X2'] || p['x2']) odds[`${pfx}dc_X2`] = p['X2'] || p['x2'];
}
function putBtts(m, pfx, odds) {
  const p = byName(m.outcomes);
  const yes = p['Oui'] || p['Yes'] || p['oui'] || p['yes'];
  const no = p['Non'] || p['No'] || p['non'] || p['no'];
  if (yes) odds[`${pfx}btts_yes`] = yes;
  if (no) odds[`${pfx}btts_no`] = no;
}
function putDnb(m, pfx, odds) {
  const p = byName(m.outcomes);
  if (p['1']) odds[`${pfx}dnb_1`] = p['1'];
  if (p['2']) odds[`${pfx}dnb_2`] = p['2'];
}
function putOddEven(m, pfx, odds) {
  const p = byName(m.outcomes);
  const odd = p['Impair'] || p['Odd'] || p['impair'] || p['odd'];
  const even = p['Pair'] || p['Even'] || p['pair'] || p['even'];
  if (odd) odds[`${pfx}odd`] = odd;
  if (even) odds[`${pfx}even`] = even;
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
    if (/plus|over|\+/.test(nm)) odds[`${pfx}over_${line}`] = v;
    else if (/moins|under/.test(nm)) odds[`${pfx}under_${line}`] = v;
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
    if (/plus|over|\+/.test(nm)) odds[`${pfx}tt_${side}_over_${line}`] = v;
    else if (/moins|under/.test(nm)) odds[`${pfx}tt_${side}_under_${line}`] = v;
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
    if (nm === '1') odds[`${pfx}hcp_home_${line}`] = v;
    else if (nm === '2') odds[`${pfx}hcp_away_${line}`] = v;
  }
}
function putHighestScoringHalf(m, odds) {
  const p = byName(m.outcomes);
  const first = p['1er'] || p['1ère Mi-Temps'] || p['1ere Mi-Temps'];
  const second = p['2ème'] || p['2ème Mi-Temps'] || p['2eme Mi-Temps'];
  const equal = p['Egalité'] || p['Égalité'] || p['Equal'];
  if (first) odds.half_most_ht = first;
  if (second) odds.half_most_h2 = second;
  if (equal) odds.half_most_equal = equal;
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
  const odds = {};
  if (sport === 'tennis') parseTennis(markets, odds);
  // Basket : marketType IDs basket PremierBet non probes en prod. Sans mapping
  // valide, retourner odds vides plutot que mismapper des IDs foot/tennis sur du
  // basket (produirait des fake arbs). A activer apres probe depuis GH Actions.
  else if (sport === 'basket') return odds;
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
  const p = byName(m.outcomes);
  if (p['1']) odds[`${pfx}match_1`] = p['1'];
  if (p['2']) odds[`${pfx}match_2`] = p['2'];
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
    if (nm === '1') odds[`${pfx}hcp_home_${h}`] = v;
    else if (nm === '2') odds[`${pfx}hcp_away_${h}`] = v;
  }
}
function putTennisTotal(m, pfx, odds) {
  for (const o of (m.outcomes || [])) {
    const v = Number(o.value);
    if (!Number.isFinite(v) || v <= 1) continue;
    const h = o.handicap != null ? Number(String(o.handicap).replace(/^\+/, '')) : null;
    if (h == null || !isHalfLine(h)) continue;
    const nm = (o.name || '').toLowerCase().trim();
    if (/plus|over/.test(nm)) odds[`${pfx}over_${h}`] = v;
    else if (/moins|under/.test(nm)) odds[`${pfx}under_${h}`] = v;
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
