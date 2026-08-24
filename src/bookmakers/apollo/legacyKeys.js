// ═══════════════════════════════════════════════════════════════════
// APOLLO — COMPATIBILITE DES CLES DE MARCHE (constate le 2026-08-19).
//
// Apollo a change le format de BetTypeKey : il envoyait des nombres (1 = 1x2,
// 5 = Total buts, 43 = BTTS...), il envoie desormais des cles composees
// ("2_-1", "5_-1", "8_30"...). Le parseur ne reconnaissait donc PLUS AUCUN
// marche : Apollo etait bien apparie sur les matchs, mais ressortait toujours
// sans cote — donc jamais retenu comme jambe d'arbitrage.
//
// Ce module retraduit les offres Apollo vers les cles historiques attendues par
// le parseur, et uniformise les libelles de selection ("u" -> "under",
// "goal" -> "1", "yes" -> "1"...). Aucun autre bookmaker n'est touche.
// ═══════════════════════════════════════════════════════════════════

// Cles composees observees en production (verifiees sur 8 matchs le 19/08/2026).
const KEY_MAP_FOOTBALL = {
  '2_-1': 1,      // 1x2
  '8_27': 3,      // Double chance (1X - 12 - X2)
  '7_16': 47,     // Draw No Bet
  '5_-1': 60,     // Total goals
  '8_142': 598,   // Total hometeam
  '8_143': 599,   // Total awayteam
  '8_30': 43,     // Both teams to score
  '8_31': 45,     // Odd / Even
  '8_1728': 9980, // Clean sheet equipe 1
  '8_1729': 9979, // Clean sheet equipe 2
};

// Sports a sets (tennis, volley, tennis de table) : meme catalogue, autres cles.
const KEY_MAP_SETS = {
  '2_-1': 20,   // vainqueur du match (2 issues)
  '8_83': 911,  // total de jeux
  '8_1712': 914,// total de sets
  '7_922': 910, // handicap de jeux
};

// Repli par libelle de marche : si Apollo change encore ses cles, le marche est
// retrouve par sa Description. Les regles les plus precises passent d'abord.
const DESC_MAP = [
  [/1(st|ere|\u00e8re).*half.*clean sheet.*(competitor1|home)/i, 958],
  [/1(st|ere|\u00e8re).*half.*clean sheet.*(competitor2|away)/i, 959],
  [/2(nd|eme|\u00e8me).*half.*clean sheet.*(competitor1|home)/i, 960],
  [/2(nd|eme|\u00e8me).*half.*clean sheet.*(competitor2|away)/i, 961],
  [/1(st|ere|\u00e8re).*half.*both teams to score/i, 952],
  [/2(nd|eme|\u00e8me).*half.*both teams to score/i, 953],
  [/1(st|ere|\u00e8re).*half.*total goals/i, 5000],
  [/2(nd|eme|\u00e8me).*half.*total goals/i, 5001],
  [/1(st|ere|\u00e8re).*half.*(1x2|double chance)/i, 42],
  [/2(nd|eme|\u00e8me).*half.*(1x2|double chance)/i, 546],
  [/(total|number).*corners?.*(odd|even)/i, 129],
  [/(total|number).*corners?/i, 127],
  [/clean sheet.*(competitor1|home)/i, 9980],
  [/clean sheet.*(competitor2|away)/i, 9979],
  [/^both teams to score$/i, 43],
  [/^double chance/i, 3],
  [/^draw no bet$/i, 47],
  [/^total goals$/i, 60],
  [/^total hometeam$/i, 598],
  [/^total awayteam$/i, 599],
  [/^odd\/even$/i, 45],
  [/^1x2$/i, 1],
];

// Uniformisation des libelles de selection.
const ALIAS = {
  x: 'X', u: 'under', o: 'over',
  goal: '1', nogoal: '2', yes: '1', no: '2',
  '1x': '1X', 'x2': 'X2', '12': '12',
};

function alias(v) {
  const k = String(v == null ? '' : v).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ALIAS, k) ? ALIAS[k] : String(v == null ? '' : v);
}

function legacyKey(offer, sport) {
  const raw = String(offer.BetTypeKey == null ? '' : offer.BetTypeKey);
  // Ancien format (nombre pur) : rien a traduire.
  if (/^\d+$/.test(raw)) return raw;
  const table = sport === 'football' ? KEY_MAP_FOOTBALL : KEY_MAP_SETS;
  if (table[raw] !== undefined) return String(table[raw]);
  const desc = String(offer.Description || offer.Name || '');
  for (const [re, key] of DESC_MAP) if (re.test(desc)) return String(key);
  return raw; // marche non exploite : ignore par le parseur, sans effet de bord
}

/** Retraduit les offres Apollo vers les cles/libelles attendus par le parseur. */
export function normalizeApolloOffers(offers, sport = 'football') {
  if (!Array.isArray(offers) || !offers.length) return offers || [];
  return offers.map((o) => ({
    ...o,
    BetTypeKey: legacyKey(o, sport),
    Odds: (o.Odds || []).map((od) => ({
      ...od,
      Type: alias(od.Type),
      Name: alias(od.Name),
    })),
  }));
}
