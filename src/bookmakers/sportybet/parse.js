// Parseur football SportyBet — mapping par MARKET ID (déterministe).
// Structure : match.markets[].{id, name, specifier, outcomes[].desc/odds/id}
// IDs vérifiés via F12 sur /api/ng/factsCenter/event?eventId=...&productId=3.
//
// COUPON CODES : chaque cle emise dans `odds` a un pendant dans `odds._ids`
// avec { eventId, marketId, outcomeId, specifier? } — permet au backend
// d'appeler POST /api/ng/orders/share pour generer un shareCode.
// eventId doit venir de l'appelant (match.id) ; on l'injecte via optsMatchId.
import { isHalfLine } from '../../core/markets.js';

export function sportybetFlatOdds(markets, { live = false, sport = 'football', matchId = null } = {}) {
  if (sport === 'tennis') return sportybetTennisFlatOdds(markets, matchId);
  const odds = {};
  odds._ids = {};
  const eventId = matchId ? (String(matchId).startsWith('sr:match:') ? String(matchId) : `sr:match:${matchId}`) : null;
  if (!Array.isArray(markets)) return odds;

  const emit = (key, value, marketId, outcomeId, specifier) => {
    odds[key] = value;
    if (eventId) odds._ids[key] = { eventId, marketId: String(marketId), outcomeId: String(outcomeId), ...(specifier ? { specifier: String(specifier) } : {}) };
  };

  for (const m of markets) {
    const id = String(m?.id ?? '');
    const outcomes = Array.isArray(m?.outcomes) ? m.outcomes : [];
    if (!outcomes.length) continue;
    const specifier = m.specifier || undefined;

    switch (id) {
      case '1': {  // 1X2 fulltime
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          const ocId = String(o?.id || '');
          if (d === 'home' || d === '1') emit('match_1', v, id, ocId, specifier);
          else if (d === 'draw' || d === 'x') emit('match_X', v, id, ocId, specifier);
          else if (d === 'away' || d === '2') emit('match_2', v, id, ocId, specifier);
        }
        break;
      }
      case '18': putTotal(odds, m, 'match_', emit); break;
      case '10': {  // Double Chance
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          const ocId = String(o?.id || '');
          if (d === 'home or draw' || d === '1x') emit('dc_1X', v, id, ocId, specifier);
          else if (d === 'home or away' || d === '12') emit('dc_12', v, id, ocId, specifier);
          else if (d === 'away or draw' || d === 'x2') emit('dc_X2', v, id, ocId, specifier);
        }
        break;
      }
      case '29': {  // BTTS
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          const ocId = String(o?.id || '');
          if (d === 'yes' || d === 'oui') emit('btts_yes', v, id, ocId, specifier);
          else if (d === 'no' || d === 'non') emit('btts_no', v, id, ocId, specifier);
        }
        break;
      }
      case '11': {  // DNB
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          const ocId = String(o?.id || '');
          if (d === 'home' || d === '1') emit('dnb_1', v, id, ocId, specifier);
          else if (d === 'away' || d === '2') emit('dnb_2', v, id, ocId, specifier);
        }
        break;
      }
      case '26': {  // Odd/Even
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          const ocId = String(o?.id || '');
          if (d === 'odd' || d === 'impair') emit('odd', v, id, ocId, specifier);
          else if (d === 'even' || d === 'pair') emit('even', v, id, ocId, specifier);
        }
        break;
      }
      case '16': putAsianHcp(odds, m, '', emit); break;
      case '60': {  // 1MT 1X2
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          const ocId = String(o?.id || '');
          if (d === 'home' || d === '1') emit('ht_match_1', v, id, ocId, specifier);
          else if (d === 'draw' || d === 'x') emit('ht_match_X', v, id, ocId, specifier);
          else if (d === 'away' || d === '2') emit('ht_match_2', v, id, ocId, specifier);
        }
        break;
      }
      case '68': putTotal(odds, m, 'ht_', emit); break;
      default: break;
    }
  }
  return odds;
}

function putTotal(odds, m, pfx, emit) {
  const line = extractLine(m.specifier, 'total');
  if (!isHalfLine(line)) return;
  const specifier = m.specifier;
  const id = String(m.id);
  for (const o of m.outcomes || []) {
    const v = Number(o?.odds);
    if (!Number.isFinite(v) || v <= 1) continue;
    const d = String(o?.desc || '').toLowerCase();
    const ocId = String(o?.id || '');
    if (/^over/.test(d) || /plus/.test(d)) emit(`${pfx}over_${line}`, v, id, ocId, specifier);
    else if (/^under/.test(d) || /moins/.test(d)) emit(`${pfx}under_${line}`, v, id, ocId, specifier);
  }
}

function putAsianHcp(odds, m, pfx, emit) {
  const line = extractLine(m.specifier, 'hcp');
  if (line == null || !isHalfLine(Math.abs(line))) return;
  const specifier = m.specifier;
  const id = String(m.id);
  for (const o of m.outcomes || []) {
    const v = Number(o?.odds);
    if (!Number.isFinite(v) || v <= 1) continue;
    const d = String(o?.desc || '').toLowerCase();
    const ocId = String(o?.id || '');
    const teamKey = d.split(/[\s(]/)[0].trim();
    if (teamKey === 'home' || teamKey === '1') emit(`${pfx}hcp_home_${line}`, v, id, ocId, specifier);
    else if (teamKey === 'away' || teamKey === '2') emit(`${pfx}hcp_away_${-line}`, v, id, ocId, specifier);
  }
}

function extractLine(specifier, key) {
  if (!specifier) return null;
  const m = String(specifier).match(new RegExp(`${key}=(-?\\d+(?:\\.\\d+)?)`));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// ═══════════════════════════════════════════════════════════════
// PARSEUR TENNIS SportyBet — meme convention _ids.
// ═══════════════════════════════════════════════════════════════
function sportybetTennisFlatOdds(markets, matchId) {
  const odds = {};
  odds._ids = {};
  const eventId = matchId ? (String(matchId).startsWith('sr:match:') ? String(matchId) : `sr:match:${matchId}`) : null;
  if (!Array.isArray(markets)) return odds;
  const emit = (key, value, marketId, outcomeId, specifier) => {
    odds[key] = value;
    if (eventId) odds._ids[key] = { eventId, marketId: String(marketId), outcomeId: String(outcomeId), ...(specifier ? { specifier: String(specifier) } : {}) };
  };
  for (const mk of markets) {
    const id = String(mk?.id || '');
    const outcomes = Array.isArray(mk?.outcomes) ? mk.outcomes : [];
    if (!outcomes.length) continue;
    const spec = String(mk.specifier || '');
    const hcp = extractLine(spec, 'hcp');
    const total = extractLine(spec, 'total');
    const setnr = extractLine(spec, 'setnr');
    const setPfx = setnr ? `s${setnr}_` : '';
    for (const oc of outcomes) {
      const v = Number(oc?.odds);
      if (!Number.isFinite(v) || v <= 1) continue;
      const ocId = String(oc?.id || '');
      switch (id) {
        case '186':
          if (ocId === '4') emit('match_1', v, id, ocId, spec);
          else if (ocId === '5') emit('match_2', v, id, ocId, spec);
          break;
        case '187':
          if (hcp != null && isHalfLine(Math.abs(hcp))) {
            if (ocId === '1714') emit(`hcp_home_${hcp}`, v, id, ocId, spec);
            else if (ocId === '1715') emit(`hcp_away_${-hcp}`, v, id, ocId, spec);
          }
          break;
        case '188':
          if (hcp != null) {
            if (ocId === '1714') emit(`hcp_sets_home_${hcp}`, v, id, ocId, spec);
            else if (ocId === '1715') emit(`hcp_sets_away_${-hcp}`, v, id, ocId, spec);
          }
          break;
        case '189':
          if (total != null && isHalfLine(total)) {
            if (ocId === '12') emit(`match_over_${total}`, v, id, ocId, spec);
            else if (ocId === '13') emit(`match_under_${total}`, v, id, ocId, spec);
          }
          break;
        case '190':
          if (total != null && isHalfLine(total)) {
            if (ocId === '12') emit(`tt_home_over_${total}`, v, id, ocId, spec);
            else if (ocId === '13') emit(`tt_home_under_${total}`, v, id, ocId, spec);
          }
          break;
        case '191':
          if (total != null && isHalfLine(total)) {
            if (ocId === '12') emit(`tt_away_over_${total}`, v, id, ocId, spec);
            else if (ocId === '13') emit(`tt_away_under_${total}`, v, id, ocId, spec);
          }
          break;
        case '198':
          if (ocId === '70') emit('odd', v, id, ocId, spec);
          else if (ocId === '72') emit('even', v, id, ocId, spec);
          break;
        case '202':
          if (setnr) {
            if (ocId === '4') emit(`${setPfx}match_1`, v, id, ocId, spec);
            else if (ocId === '5') emit(`${setPfx}match_2`, v, id, ocId, spec);
          }
          break;
        case '203':
          if (setnr && hcp != null && isHalfLine(Math.abs(hcp))) {
            if (ocId === '1714') emit(`${setPfx}hcp_home_${hcp}`, v, id, ocId, spec);
            else if (ocId === '1715') emit(`${setPfx}hcp_away_${-hcp}`, v, id, ocId, spec);
          }
          break;
        case '204':
          if (setnr && total != null && isHalfLine(total)) {
            if (ocId === '12') emit(`${setPfx}over_${total}`, v, id, ocId, spec);
            else if (ocId === '13') emit(`${setPfx}under_${total}`, v, id, ocId, spec);
          }
          break;
        case '314':
          if (total != null) {
            if (ocId === '12') emit(`total_sets_over_${total}`, v, id, ocId, spec);
            else if (ocId === '13') emit(`total_sets_under_${total}`, v, id, ocId, spec);
          }
          break;
        default: break;
      }
    }
  }
  return odds;
}
