// Traduction des marchés BetKing vers le vocabulaire standard du scanner.
// On ne mappe QUE ce que le flux publie réellement (relevé du 14/11/2026) :
// 1X2 (110), Double Chance (146), Total Goals N.5 (160), GG/NG (302),
// Draw No Bet (147). Aucun marché deviné : c'est ce qui évite les faux
// appariements (handicap, mi-temps, totaux d'équipe ne sont pas servis ici).
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function betkingOdds(match) {
  const odds = {};
  const ids = {};
  const put = (key, odd, collection, marketId) => {
    const price = num(odd);
    if (!key || !(price > 1) || odds[key] != null) return;
    odds[key] = price;
    ids[key] = {
      match_id: match.id,
      market_id: marketId,
      market_type_id: num(collection?.OddsType?.OddsTypeID),
      market_name: String(collection?.OddsType?.OddsTypeName || ''),
      line: num(collection?.SpecialBetValue) || null,
    };
  };

  for (const c of match.collections || []) {
    const typeId = num(c?.OddsType?.OddsTypeID);
    const typeName = String(c?.OddsType?.OddsTypeName || '').toLowerCase();
    const line = num(c?.SpecialBetValue);
    const rows = c.MatchOdds || [];
    const marketId = num(rows[0]?.OddCollectionID) || null;

    for (const m of rows) {
      const sel = String(m?.OddAttribute?.OddName || '').trim().toUpperCase();
      const price = m?.Outcome?.OddOutcome;
      const keySel = m?.MatchOddsID;
      const selType = m?.OddAttribute?.OddTypeID;
      const smart = m?.SmartBetCode;
      const putSel = (key) => {
        put(key, price, c, marketId);
        if (odds[key] === num(price) && key) {
          ids[key] = { ...ids[key], selection_id: num(keySel), selection_type: num(selType), smart: num(smart), selection_name: String(m?.OddAttribute?.OddName || '') };
        }
      };

      if (typeId === 110) putSel(sel === '1' ? 'match_1' : sel === 'X' ? 'match_X' : sel === '2' ? 'match_2' : '');
      else if (typeId === 146) putSel(sel === '1X' ? 'dc_1X' : sel === '12' ? 'dc_12' : sel === 'X2' ? 'dc_X2' : '');
      else if (typeId === 302) putSel(/^(GG|YES|Y)$/.test(sel) ? 'btts_yes' : /^(NG|NO|N)$/.test(sel) ? 'btts_no' : '');
      else if (typeId === 147) putSel(/^1/.test(sel) ? 'dnb_1' : /^2/.test(sel) ? 'dnb_2' : '');
      else if (typeId === 160 && line > 0) {
        const l = String(line);
        putSel(/^(OVER|O)$/.test(sel) ? `match_over_${l}` : /^(UNDER|U)$/.test(sel) ? `match_under_${l}` : '');
      }
    }
  }
  return { odds, ids };
}
