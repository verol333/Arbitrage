// Parseur PremierBet mobile API — mapping par MARKET ID (déterministe).
// Basé sur dump F12 réel : chaque marché a un id stable (7, 29, 155, etc.),
// stable entre matchs. Les regex par nom français étaient AMBIGUËS : le
// marché "Equipe à l'extérieur gagne les deux Mi-Temps" (id=318, Oui=8.00)
// était classé comme "1MT BTTS" par mégarde car son nom contient "les deux"
// + "mi-temps" — ça écrasait le vrai 1MT BTTS (id=155). D'où fake arbs.
import { isHalfLine } from '../../core/markets.js';

export function premierbetFlatOdds(markets) {
  const odds = {};

  const byName = (outcomes) => {
    const map = {};
    for (const o of (outcomes || [])) {
      const v = Number(o.value);
      if (Number.isFinite(v) && v > 1) map[String(o.name || '').trim()] = v;
    }
    return map;
  };

  const put1x2 = (m, pfx) => {
    const p = byName(m.outcomes);
    if (p['1']) odds[`${pfx}match_1`] = p['1'];
    if (p['X'] || p['x']) odds[`${pfx}match_X`] = p['X'] || p['x'];
    if (p['2']) odds[`${pfx}match_2`] = p['2'];
  };
  const putDC = (m, pfx) => {
    const p = byName(m.outcomes);
    if (p['1X'] || p['1x']) odds[`${pfx}dc_1X`] = p['1X'] || p['1x'];
    if (p['12']) odds[`${pfx}dc_12`] = p['12'];
    if (p['X2'] || p['x2']) odds[`${pfx}dc_X2`] = p['X2'] || p['x2'];
  };
  const putBtts = (m, pfx) => {
    const p = byName(m.outcomes);
    const yes = p['Oui'] || p['Yes'] || p['oui'] || p['yes'];
    const no = p['Non'] || p['No'] || p['non'] || p['no'];
    if (yes) odds[`${pfx}btts_yes`] = yes;
    if (no) odds[`${pfx}btts_no`] = no;
  };
  const putDnb = (m, pfx) => {
    const p = byName(m.outcomes);
    if (p['1']) odds[`${pfx}dnb_1`] = p['1'];
    if (p['2']) odds[`${pfx}dnb_2`] = p['2'];
  };
  const putOddEven = (m, pfx) => {
    const p = byName(m.outcomes);
    const odd = p['Impair'] || p['Odd'] || p['impair'] || p['odd'];
    const even = p['Pair'] || p['Even'] || p['pair'] || p['even'];
    if (odd) odds[`${pfx}odd`] = odd;
    if (even) odds[`${pfx}even`] = even;
  };
  // Total avec plusieurs lignes : outcomes ont handicap="X.5" + name "Plus de"/"Moins de".
  const putTotalMultiLine = (m, pfx) => {
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
  };
  const putTeamTotalMultiLine = (m, side, pfx) => {
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
  };
  // Handicap asian : outcomes ont handicap ("+1.5"/"-0.5") et name "1"/"2".
  const putHcpMultiLine = (m, pfx) => {
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
  };
  const putHighestScoringHalf = (m) => {
    const p = byName(m.outcomes);
    if (p['1er']) odds.half_most_ht = p['1er'];
    if (p['2ème']) odds.half_most_h2 = p['2ème'];
    if (p['Egalité'] || p['Égalité']) odds.half_most_equal = p['Egalité'] || p['Égalité'];
  };

  for (const m of markets) {
    const id = String(m.id || '');
    switch (id) {
      // ─── Full time — mapping ID-based (déterministe) ──────────────────────
      case '3': put1x2(m, ''); break;                                 // 1X2
      case '7': putBtts(m, ''); break;                                // Les Deux Equipes Marquent
      case '17': putDC(m, ''); break;                                 // Double Chance
      case '18': putDnb(m, ''); break;                                // Pari Remboursé si nul (DNB)
      case '23': putHcpMultiLine(m, ''); break;                       // Handicap Asian
      case '29': putTotalMultiLine(m, 'match_'); break;               // Total de Buts
      case '353': putTeamTotalMultiLine(m, 'home', ''); break;        // Total Équipe Domicile
      case '352': putTeamTotalMultiLine(m, 'away', ''); break;        // Total Équipe Extérieur
      case '35': putHighestScoringHalf(m); break;                     // Mi-Temps avec le Plus de Buts
      case '16': putOddEven(m, ''); break;                            // Impair/Pair Total de Buts
      // ─── 1ère mi-temps ────────────────────────────────────────────────────
      case '6': put1x2(m, 'ht_'); break;                              // 1ère Mi-Temps 1X2
      case '155': putBtts(m, 'ht_'); break;                           // 1ère Mi-Temps BTTS (VRAI code — pas confondre avec 315/318)
      case '44': putDC(m, 'ht_'); break;                              // 1ère Mi-Temps DC
      case '19': putDnb(m, 'ht_'); break;                             // 1ère Mi-Temps DNB
      case '119': putTotalMultiLine(m, 'ht_'); break;                 // 1ère Mi-Temps Total
      case '392': putTeamTotalMultiLine(m, 'home', 'ht_'); break;     // 1ère MT Total Domicile
      case '393': putTeamTotalMultiLine(m, 'away', 'ht_'); break;     // 1ère MT Total Extérieur
      case '396': putHcpMultiLine(m, 'ht_'); break;                   // 1ère MT Handicap
      // ─── 2ème mi-temps ────────────────────────────────────────────────────
      case '96': put1x2(m, 'h2_'); break;                             // 2ème Mi-Temps 1X2
      case '156': putBtts(m, 'h2_'); break;                           // 2ème Mi-Temps BTTS
      case '45': putDC(m, 'h2_'); break;                              // 2ème Mi-Temps DC
      case '120': putTotalMultiLine(m, 'h2_'); break;                 // 2ème Mi-Temps Total
      case '397': putTeamTotalMultiLine(m, 'home', 'h2_'); break;     // 2ème MT Total Dom.
      case '398': putTeamTotalMultiLine(m, 'away', 'h2_'); break;     // 2ème MT Total Ext.
      // ─── Corners ──────────────────────────────────────────────────────────
      case '111': put1x2(m, 'cor_'); break;                           // Corners 1X2
      case '107': putTotalMultiLine(m, 'cor_'); break;                // Nombre de Corners
      case '1852': putTeamTotalMultiLine(m, 'home', 'cor_'); break;   // Corners Dom.
      case '1853': putTeamTotalMultiLine(m, 'away', 'cor_'); break;   // Corners Ext.
      case '109': putHcpMultiLine(m, 'cor_'); break;                  // Handicap Corners
      case '113': putOddEven(m, 'cor_'); break;                       // Corners Impair/Pair
      case '110': putHcpMultiLine(m, 'cor_ht_'); break;               // 1ère MT Handicap Corners
      // ─── IGNORÉS explicitement (documentation) ─────────────────────────────
      // Combos multi-marchés non comparables 2-way pure :
      //   386, 36, 414, 554, 573, 570, 569, 413, 412, 571, 1741
      // 3-way European handicap + scores exacts :
      //   27 (1X2-Handicap), 332 (Score Exact), 32 (1MT Score Exact), 15 (HT/FT 9-way)
      // Marchés team-specific yes/no NON confondables avec BTTS :
      //   315, 316, 318, 319 : "Equipe X Gagne les deux/une Mi-Temps"
      //     ATTENTION : leurs noms contiennent "les deux" + "mi-temps" mais NE
      //     SONT PAS BTTS — c'était la source des fake arbs 7.40/8.00 avec le
      //     mapping par regex.
      //   102, 103, 317, 320, 321, 322, 394, 395, 408, 409, 406, 407
      // Autres non pertinents ici :
      //   327 (10min 1X2), 330, 331 (highest half par équipe),
      //   5, 125, 390, 404 (first/last team to score),
      //   21, 22 (buts exacts par équipe 0/1/2/3+),
      //   751 (2 buts d'avance), 85, 73, 83 (cartons), 410, 411 (odd/even par équipe),
      //   115 (Premier Corner)
      default: break;
    }
  }
  return odds;
}
