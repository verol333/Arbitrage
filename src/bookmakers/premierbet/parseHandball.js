// Parseur PremierBet HANDBALL — mapping par NOM de marche.
//
// Pourquoi pas par ID : sur le handball les identifiants PremierBet ne suivent
// pas ceux du football (mesure le 13/11/2026 sur Raekker Molle - Grindsted :
// « Resultat du Match » porte l'id 3, alors que la meme competition annonce
// l'id 1 pour « 1X2 »). Un mapping par id lirait donc un handicap comme un
// 1X2. Les libelles, eux, sont stables d'un match a l'autre.
//
// Cles produites = celles attendues par compareHandballTwoBooks (comparateur
// hockey) : match_1 / match_X / match_2, dc_1X / dc_12 / dc_X2,
// hcp_home_L / hcp_away_L, match_over_L / match_under_L.
import { isHalfLine } from '../../core/markets.js';

const low = (s) => String(s || '').trim().toLowerCase();
const num = (v) => Number(String(v ?? '').replace(',', '.'));

function put(odds, key, outcome) {
  const v = num(outcome?.value);
  if (!(v > 1)) return;
  odds[key] = v;
  if (!odds._ids) odds._ids = {};
  odds._ids[key] = {
    market_name_native: outcome?.__market ?? null,
    selection_name_native: String(outcome?.name ?? ''),
    market_path_native: null,
  };
}

export function premierbetHandballOdds(markets) {
  const odds = { _ids: {} };
  for (const m of markets || []) {
    const market = low(m?.name);
    const outs = (m?.outcomes || [])
      .filter((o) => o?.active !== false && num(o?.value) > 1)
      .map((o) => ({ ...o, __market: m?.name }));
    if (!outs.length) continue;

    // 1X2 : « Resultat du Match » / « Gagnant du Match » / « 1X2 ».
    if (/r[ée]sultat du match|gagnant du match|^1x2$|match winner|vainqueur du match/.test(market)) {
      for (const o of outs) {
        const n = low(o.name);
        if (n === '1' || n === 'domicile') put(odds, 'match_1', o);
        else if (n === 'x' || n === 'nul') put(odds, 'match_X', o);
        else if (n === '2' || n === 'exterieur' || n === 'ext\u00e9rieur') put(odds, 'match_2', o);
      }
      continue;
    }

    // Double Chance.
    if (/^double chance/.test(market)) {
      for (const o of outs) {
        const n = low(o.name).replace(/\s/g, '');
        if (n === '1x' || n === 'x1') put(odds, 'dc_1X', o);
        else if (n === '12' || n === '21') put(odds, 'dc_12', o);
        else if (n === 'x2' || n === '2x') put(odds, 'dc_X2', o);
      }
      continue;
    }

    // Handicap : « 1 (-3.5) » / « 2 (+3.5) ». Le signe porte la ligne du camp,
    // le comparateur lit hcp_home_L et hcp_away_-L.
    if (/handicap/.test(market)) {
      for (const o of outs) {
        const raw = String(o.name || '');
        const mLine = raw.match(/([+-]?\d+(?:[.,]\d+)?)/);
        if (!mLine) continue;
        const line = num(mLine[1]);
        if (!isHalfLine(line)) continue;
        const side = /(^|\D)1(\D|$)/.test(raw) ? 'home' : /(^|\D)2(\D|$)/.test(raw) ? 'away' : null;
        if (!side) continue;
        put(odds, `hcp_${side}_${line}`, o);
      }
      continue;
    }

    // Totaux buts : « Plus de/Moins de », « Total de buts ».
    if (/plus de\/moins de|plus de \/ moins de|^total|nombre de buts|total de buts/.test(market)) {
      for (const o of outs) {
        const raw = String(o.name || '');
        const mLine = raw.match(/(\d+(?:[.,]\d+)?)/);
        if (!mLine) continue;
        const line = num(mLine[1]);
        if (!isHalfLine(line)) continue;
        if (/plus|over|^\+/i.test(raw)) put(odds, `match_over_${line}`, o);
        else if (/moins|under|^-/i.test(raw)) put(odds, `match_under_${line}`, o);
      }
    }
  }
  if (!Object.keys(odds).length) return {};
  return odds;
}
