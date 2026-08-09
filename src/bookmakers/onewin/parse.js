// Parseur football + tennis 1win (groupes REST → cotes plates standard).
// Port fidèle de matchCore.ts winFlatOdds().
import { isHalfLine } from '../../core/markets.js';
import { tokenOverlap } from '../../core/text.js';


// Helper : ecrit odds[key] = v ET odds._ids[key] = { oddId } pour permettre au
// backend de generer un code coupon (endpoint 1win /shared-bets/create, format
// { coupons: [{ oddId: String }] }). L'oddId natif est odd.id, format
// "<groupId>:<uniqueId>:<outcome>" (ex "10:21612258419570790:1"). matchId est
// ajoute par collect.js depuis match.id.
function putWin(odds, key, o) {
  putWin(odds, key, o);
  if (!odds._ids) odds._ids = {};
  odds._ids[key] = { oddId: o.id != null ? String(o.id) : null };
}

// Convertit les groupes tennis 1win → cotes plates canoniques.
// Prefixes set : "1st set."/"2nd set."/"3rd set." → sN_.
// Marches : Winner, Handicap, Total, <Player> total, Total. Odd/Even.
export function winTennisFlatOdds(groups, names) {
  const odds = { _ids: {} };
  if (!groups) return odds;
  const isHome = (n) => tokenOverlap(n, names.home) >= 0.5;
  const isAway = (n) => tokenOverlap(n, names.away) >= 0.5;
  const active = (list) => (list || []).filter((o) => o?.status === 1 && Number(o.cf) > 1);

  for (const [rawName, rawList] of Object.entries(groups)) {
    const low = rawName.toLowerCase().trim();
    const list = active(rawList);
    if (!list.length) continue;

    // Prefixe set : "1st set. Winner" → s1_ + "Winner"
    let pfx = '';
    let base = low;
    const setMatch = low.match(/^(1st|2nd|3rd|4th|5th)\s+set\.\s+(.+)$/);
    if (setMatch) {
      const n = setMatch[1] === '1st' ? '1' : setMatch[1] === '2nd' ? '2' : setMatch[1] === '3rd' ? '3' : setMatch[1] === '4th' ? '4' : '5';
      pfx = `s${n}_`;
      base = setMatch[2];
    }

    // Winner : outcome 1/2 → home/away
    if (base === 'winner') {
      for (const o of list) {
        const oc = String(o.outcome || '').toLowerCase().trim();
        const n = String(o.name || '').toLowerCase();
        // sN_ prefix : cle sN_match_1 / sN_match_2. Base : match_1 / match_2.
        if (oc === '1') putWin(odds, `${pfx}match_1`, o);
        else if (oc === '2') putWin(odds, `${pfx}match_2`, o);
        else if (isHome(n) && !isAway(n)) putWin(odds, `${pfx}match_1`, o);
        else if (isAway(n) && !isHome(n)) putWin(odds, `${pfx}match_2`, o);
      }
    }
    // Handicap : "Matteo Berrettini 1.5" ou "Mariano Navone -1.5"
    // Le signe est conserve. hcp_home_X pour joueur home, hcp_away_X pour away.
    else if (base === 'handicap') {
      for (const o of list) {
        const n = String(o.name || '');
        const oc = String(o.outcome || '').toLowerCase().trim();
        const mLine = n.match(/(-?\d+(?:\.\d+)?)/);
        if (!mLine) continue;
        const line = parseFloat(mLine[1]);
        if (!isHalfLine(line)) continue;
        const teamPart = n.replace(/-?\d+(?:\.\d+)?/g, '').trim();
        // Priorite : outcome 1/2 si dispo, sinon token match
        let side = null;
        if (oc === '1') side = 'home';
        else if (oc === '2') side = 'away';
        else {
          const sH = tokenOverlap(teamPart, names.home), sA = tokenOverlap(teamPart, names.away);
          side = sH > sA ? 'home' : sA > sH ? 'away' : null;
        }
        if (side === null) continue;
        putWin(odds, `${pfx}hcp_${side}_${line}`, o);
      }
    }
    // Total : "Over 26.5" / "Under 26.5" → match_over_26.5 / match_under_26.5
    // sN_ prefix : sN_over_X / sN_under_X.
    else if (base === 'total') {
      for (const o of list) {
        const n = String(o.name || '');
        const oc = String(o.outcome || '').toLowerCase().trim();
        const m = n.match(/(-?\d+(?:\.\d+)?)/);
        if (!m || !isHalfLine(m[1])) continue;
        const line = parseFloat(m[1]);
        const isOver = oc === 'over' || /over/i.test(n);
        const isUnder = oc === 'under' || /under/i.test(n);
        if (!isOver && !isUnder) continue;
        if (pfx) {
          // Par set : sN_over_X / sN_under_X
          if (isOver) putWin(odds, `${pfx}over_${line}`, o);
          else putWin(odds, `${pfx}under_${line}`, o);
        } else {
          // Match : match_over_X / match_under_X
          if (isOver) putWin(odds, `match_over_${line}`, o);
          else putWin(odds, `match_under_${line}`, o);
        }
      }
    }
    // Total. Odd/Even
    else if (base === 'total. odd/even' || base === 'odd/even') {
      for (const o of list) {
        const oc = String(o.outcome || '').toLowerCase().trim();
        const n = String(o.name || '').toLowerCase();
        if (oc === 'odd' || /odd/i.test(n)) putWin(odds, `${pfx}odd`, o);
        else if (oc === 'even' || /even/i.test(n)) putWin(odds, `${pfx}even`, o);
      }
    }
    // "<Player name> total" → tt_home_over/under_X ou tt_away_over/under_X
    else if (!pfx && /^.+\s+total$/i.test(low) && low !== 'total') {
      const teamPart = rawName.replace(/\s+total$/i, '').trim();
      const sH = tokenOverlap(teamPart, names.home), sA = tokenOverlap(teamPart, names.away);
      const side = sH > sA ? 'home' : sA > sH ? 'away' : null;
      if (side === null) continue;
      for (const o of list) {
        const n = String(o.name || '');
        const oc = String(o.outcome || '').toLowerCase().trim();
        const m = n.match(/(-?\d+(?:\.\d+)?)/);
        if (!m || !isHalfLine(m[1])) continue;
        const line = parseFloat(m[1]);
        const isOver = oc === 'over' || /over/i.test(n);
        const isUnder = oc === 'under' || /under/i.test(n);
        if (isOver) putWin(odds, `tt_${side}_over_${line}`, o);
        else if (isUnder) putWin(odds, `tt_${side}_under_${line}`, o);
      }
    }
  }
  return odds;
}

// ═══════════════════════════════════════════════════════════════
// PARSEUR BASKET 1win (WebSocket oddsGroups, incl. OT).
// Group names validés via probe-basket-dump v2 (sportId=23) :
//   "Winner (incl. OT)"                       → match_1 / match_2
//   "Total (incl. OT)"                        → match_over/under (name "Over X" / "Under X")
//   "Handicap (incl. OT)"                     → hcp_home/away (name "<team> ±X")
//   "Odd/Even (incl. OT)"                     → odd / even
//   "<home team> total (incl. OT)"            → tt_home_over/under
//   "<away team> total (incl. OT)"            → tt_away_over/under
//   "Nth quarter. Result"                     → q{n}_match_1/X/2 (3-way parfois)
//   "Nth quarter. Handicap"                   → q{n}_hcp_home/away
//   "Nth quarter. Total"                      → q{n}_over/under
//   "Nth quarter. Odd/Even"                   → q{n}_odd/even
// ATTENTION : "Result (reg. time)" est un 3-way SANS OT — on skip pour ne pas
// mélanger avec Winner (incl. OT) qui est le marché principal cross-book.
// ═══════════════════════════════════════════════════════════════
export function winBasketFlatOdds(groups, names) {
  const odds = { _ids: {} };
  if (!groups) return odds;
  const isHome = (n) => tokenOverlap(n, names.home) >= 0.5;
  const isAway = (n) => tokenOverlap(n, names.away) >= 0.5;
  const active = (list) => (list || []).filter((o) => o?.status === 1 && Number(o.cf) > 1);
  const num = (o) => Number(o.cf);

  // Extraction du prefix période depuis le nom du groupe.
  // "3rd quarter. Total" → { pfx: "q3_", base: "total" }
  // "Winner (incl. OT)"  → { pfx: "",    base: "winner (incl. ot)" }
  function stripPeriod(rawName) {
    const s = String(rawName || '').trim();
    const low = s.toLowerCase();
    const qm = low.match(/^(1st|2nd|3rd|4th)\s+quarter\.\s+(.+)$/);
    if (qm) {
      const n = qm[1] === '1st' ? '1' : qm[1] === '2nd' ? '2' : qm[1] === '3rd' ? '3' : '4';
      return { pfx: `q${n}_`, base: qm[2], rawBase: s.slice(s.indexOf('.') + 1).trim() };
    }
    const hm = low.match(/^(1st|2nd)\s+half\.\s+(.+)$/);
    if (hm) {
      const n = hm[1] === '1st' ? '1' : '2';
      return { pfx: `h${n}_`, base: hm[2], rawBase: s.slice(s.indexOf('.') + 1).trim() };
    }
    return { pfx: '', base: low, rawBase: s };
  }

  for (const [rawName, rawList] of Object.entries(groups)) {
    const list = active(rawList);
    if (!list.length) continue;
    const { pfx, base, rawBase } = stripPeriod(rawName);

    // Winner (incl. OT) : 2-way
    if (/^winner\s*\(incl\.\s*ot\)$/.test(base) || (pfx && base === 'result')) {
      for (const o of list) {
        const oc = String(o.outcome || '').toLowerCase().trim();
        const n = String(o.name || '').toLowerCase();
        // Result (Nth quarter) peut être 3-way avec draw. Skip draw pour basket.
        if (oc === '1' || oc === 'w1' || oc === 'home') putWin(odds, `${pfx}match_1`, o);
        else if (oc === '2' || oc === 'w2' || oc === 'away') putWin(odds, `${pfx}match_2`, o);
        else if (oc === 'x' || oc === 'draw') putWin(odds, `${pfx}match_X`, o);
        else if (isHome(n) && !isAway(n)) putWin(odds, `${pfx}match_1`, o);
        else if (isAway(n) && !isHome(n)) putWin(odds, `${pfx}match_2`, o);
      }
      continue;
    }

    // Total (incl. OT) ou "Nth quarter. Total"
    if (/^total\s*(?:\(incl\.\s*ot\))?$/.test(base)) {
      for (const o of list) {
        const n = String(o.name || '');
        const oc = String(o.outcome || '').toLowerCase().trim();
        const m = n.match(/(-?\d+(?:\.\d+)?)/);
        if (!m || !isHalfLine(m[1])) continue;
        const line = parseFloat(m[1]);
        const isOver = oc === 'over' || /over/i.test(n);
        const isUnder = oc === 'under' || /under/i.test(n);
        if (pfx) {
          if (isOver) putWin(odds, `${pfx}over_${line}`, o);
          else if (isUnder) putWin(odds, `${pfx}under_${line}`, o);
        } else {
          if (isOver) putWin(odds, `match_over_${line}`, o);
          else if (isUnder) putWin(odds, `match_under_${line}`, o);
        }
      }
      continue;
    }

    // Handicap (incl. OT) ou "Nth quarter. Handicap"
    if (/^handicap\s*(?:\(incl\.\s*ot\))?$/.test(base)) {
      for (const o of list) {
        const n = String(o.name || '');
        const mLine = n.match(/(-?\d+(?:\.\d+)?)/);
        if (!mLine) continue;
        const line = parseFloat(mLine[1]);
        if (!isHalfLine(line)) continue;
        const teamPart = n.replace(/-?\d+(?:\.\d+)?/g, '').trim();
        const sH = tokenOverlap(teamPart, names.home);
        const sA = tokenOverlap(teamPart, names.away);
        if (sH === 0 && sA === 0) continue;
        if (sH >= sA) putWin(odds, `${pfx}hcp_home_${line}`, o);
        else putWin(odds, `${pfx}hcp_away_${line}`, o);
      }
      continue;
    }

    // Odd/Even (incl. OT) ou "Nth quarter. Odd/Even"
    if (/^odd\/even\s*(?:\(incl\.\s*ot\))?$/.test(base)) {
      for (const o of list) {
        const oc = String(o.outcome || '').toLowerCase().trim();
        const n = String(o.name || '').toLowerCase();
        if (oc === 'odd' || /odd/.test(n)) putWin(odds, `${pfx}odd`, o);
        else if (oc === 'even' || /even/.test(n)) putWin(odds, `${pfx}even`, o);
      }
      continue;
    }

    // "<home team> total (incl. OT)" ou "<away team> total (incl. OT)"
    // Match seulement en absence de préfixe période (match_TT).
    if (!pfx && /\btotal\s*(?:\(incl\.\s*ot\))?$/i.test(rawBase)) {
      const teamPart = rawBase.replace(/\btotal\s*(?:\(incl\.\s*ot\))?$/i, '').trim();
      if (!teamPart) continue;
      const sH = tokenOverlap(teamPart, names.home);
      const sA = tokenOverlap(teamPart, names.away);
      if (sH === 0 && sA === 0) continue;
      const side = sH > sA ? 'home' : sA > sH ? 'away' : null;
      if (side === null) continue;
      for (const o of list) {
        const n = String(o.name || '');
        const oc = String(o.outcome || '').toLowerCase();
        const m = n.match(/(-?\d+(?:\.\d+)?)/);
        if (!m || !isHalfLine(m[1])) continue;
        const line = parseFloat(m[1]);
        const isOver = oc === 'over' || /over/i.test(n);
        const isUnder = oc === 'under' || /under/i.test(n);
        if (isOver) putWin(odds, `tt_${side}_over_${line}`, o);
        else if (isUnder) putWin(odds, `tt_${side}_under_${line}`, o);
      }
      continue;
    }
  }
  return odds;
}

export function winFlatOdds(groups, names) {
  const odds = { _ids: {} };
  if (!groups) return odds;
  const isHome = (n) => tokenOverlap(n, names.home) >= 0.5;
  const isAway = (n) => tokenOverlap(n, names.away) >= 0.5;
  const isDraw = (n) => /draw|nul/.test(n);
  const active = (list) => (list || []).filter((o) => o?.status === 1 && Number(o.cf) > 1);

  for (const [rawName, rawList] of Object.entries(groups)) {
    const low = rawName.toLowerCase().trim();
    const list = active(rawList);
    if (!list.length) continue;

    if (low === 'full time result (regular time)' || low === 'full time result' || low === 'result' || low === 'match winner') {
      for (const o of list) {
        const oc = (o.outcome || '').toString().toLowerCase().trim();
        const n = (o.name || '').toLowerCase();
        if (oc === '1' || oc === 'w1' || oc === 'home') putWin(odds, 'match_1', o);
        else if (oc === '2' || oc === 'w2' || oc === 'away') putWin(odds, 'match_2', o);
        else if (oc === 'x' || oc === 'draw') putWin(odds, 'match_X', o);
        else if (isDraw(n)) putWin(odds, 'match_X', o);
        else if (isHome(n) && !isAway(n)) putWin(odds, 'match_1', o);
        else if (isAway(n) && !isHome(n)) putWin(odds, 'match_2', o);
      }
    }
    if (low === 'double chance (regular time)' || low === 'double chance') {
      for (const o of list) {
        const oc = (o.outcome || '').toString().toLowerCase().replace(/\s/g, '');
        const n = (o.name || '').toLowerCase();
        if (oc === '1x' || oc === 'x1') putWin(odds, 'dc_1X', o);
        else if (oc === '12' || oc === '21') putWin(odds, 'dc_12', o);
        else if (oc === 'x2' || oc === '2x') putWin(odds, 'dc_X2', o);
        else if (isDraw(n) && isHome(n)) putWin(odds, 'dc_1X', o);
        else if (isDraw(n) && isAway(n)) putWin(odds, 'dc_X2', o);
        else if (isHome(n) && isAway(n)) putWin(odds, 'dc_12', o);
      }
    }
    if (low === 'both teams to score') {
      for (const o of list) {
        const n = (o.name || '').toLowerCase();
        if (n === 'yes' || n.includes('yes')) putWin(odds, 'btts_yes', o);
        if (n === 'no' || n.includes('no')) putWin(odds, 'btts_no', o);
      }
    }
    if (low.includes('draw no bet')) {
      for (const o of list) {
        const n = (o.name || '').toLowerCase();
        if (isHome(n)) putWin(odds, 'dnb_1', o);
        else if (isAway(n)) putWin(odds, 'dnb_2', o);
      }
    }
    if (low === 'total') {
      for (const o of list) {
        const mo = (o.name || '').match(/over\s*\(?([\d.]+)/i);
        const mu = (o.name || '').match(/under\s*\(?([\d.]+)/i);
        if (mo && isHalfLine(mo[1])) putWin(odds, `match_over_${parseFloat(mo[1])}`, o);
        if (mu && isHalfLine(mu[1])) putWin(odds, `match_under_${parseFloat(mu[1])}`, o);
      }
    }
    if (/\btotal$/.test(low) && low !== 'total'
        && !/shot|foul|yellow|red|card|save|offside|throw|goal kick|corner|substitut|video|post|crossbar|even|odd|and |result|both teams|minute|1st|2nd|half/.test(low)) {
      let side;
      if (/\bhome team\b/.test(low)) side = 'home';
      else if (/\baway team\b/.test(low)) side = 'away';
      else {
        const sH = tokenOverlap(rawName, names.home), sA = tokenOverlap(rawName, names.away);
        side = sH > sA ? 'home' : sA > sH ? 'away' : null;
      }
      if (side === null) continue;
      for (const o of list) {
        const m = (o.name || '').match(/([\d.]+)/);
        if (!m || !isHalfLine(m[1])) continue;
        const line = parseFloat(m[1]);
        const oc = (o.outcome || '').toLowerCase();
        if (oc === 'over' || /over|plus/i.test(o.name)) putWin(odds, `tt_${side}_over_${line}`, o);
        else if (oc === 'under' || /under|moins/i.test(o.name)) putWin(odds, `tt_${side}_under_${line}`, o);
      }
    }
    if (low === 'handicap' || low === 'handicap (regular time)' || low === 'asian handicap') {
      for (const o of list) {
        const n = (o.name || '');
        const mLine = n.match(/([+-]?\d+(?:\.\d+)?)/);
        if (!mLine) continue;
        const line = parseFloat(mLine[1]);
        if (!isHalfLine(line)) continue;
        const teamPart = n.replace(/[+-]?\d+(?:\.\d+)?/g, '').trim();
        const scoreHome = tokenOverlap(teamPart, names.home);
        const scoreAway = tokenOverlap(teamPart, names.away);
        if (scoreHome === 0 && scoreAway === 0) continue;
        if (scoreHome >= scoreAway) putWin(odds, `hcp_home_${line}`, o);
        else putWin(odds, `hcp_away_${line}`, o);
      }
    }
    const PFX = { '1st half.': 'ht_', '2nd half.': 'h2_', 'corners.': 'cor_', 'corners. 1st half.': 'cor_ht_' };
    let pfx = null, base = low;
    for (const [k, v] of Object.entries(PFX)) if (low.startsWith(k)) { pfx = v; base = low.slice(k.length).trim(); break; }
    if (pfx) {
      if (base === 'total') {
        for (const o of list) {
          const mo = (o.name || '').match(/over\s*\(?([\d.]+)/i);
          const mu = (o.name || '').match(/under\s*\(?([\d.]+)/i);
          if (mo && isHalfLine(mo[1])) putWin(odds, `${pfx}over_${parseFloat(mo[1])}`, o);
          if (mu && isHalfLine(mu[1])) putWin(odds, `${pfx}under_${parseFloat(mu[1])}`, o);
        }
      } else if (base === 'result') {
        for (const o of list) {
          const oc = (o.outcome || '').toString().toLowerCase().trim();
          const n = (o.name || '').toLowerCase();
          if (oc === '1' || oc === 'w1' || oc === 'home') putWin(odds, `${pfx}match_1`, o);
          else if (oc === '2' || oc === 'w2' || oc === 'away') putWin(odds, `${pfx}match_2`, o);
          else if (oc === 'x' || oc === 'draw') putWin(odds, `${pfx}match_X`, o);
          else if (isDraw(n)) putWin(odds, `${pfx}match_X`, o);
          else if (isHome(n) && !isAway(n)) putWin(odds, `${pfx}match_1`, o);
          else if (isAway(n) && !isHome(n)) putWin(odds, `${pfx}match_2`, o);
        }
      } else if (base === 'double chance') {
        for (const o of list) {
          const oc = (o.outcome || '').toString().toLowerCase().replace(/\s/g, '');
          if (oc === '1x' || oc === 'x1') putWin(odds, `${pfx}dc_1X`, o);
          else if (oc === '12' || oc === '21') putWin(odds, `${pfx}dc_12`, o);
          else if (oc === 'x2' || oc === '2x') putWin(odds, `${pfx}dc_X2`, o);
        }
      } else if (base === 'handicap') {
        for (const o of list) {
          const n = (o.name || '');
          const mLine = n.match(/([+-]?\d+(?:\.\d+)?)/);
          if (!mLine) continue;
          const line = parseFloat(mLine[1]);
          if (!isHalfLine(line)) continue;
          const teamPart = n.replace(/[+-]?\d+(?:\.\d+)?/g, '').trim();
          const scoreHome = tokenOverlap(teamPart, names.home);
          const scoreAway = tokenOverlap(teamPart, names.away);
          if (scoreHome === 0 && scoreAway === 0) continue;
          if (scoreHome >= scoreAway) putWin(odds, `${pfx}hcp_home_${line}`, o);
          else putWin(odds, `${pfx}hcp_away_${line}`, o);
        }
      } else if (base === 'total. even/odd' || base === 'odd/even' || base === 'even/odd') {
        for (const o of list) {
          const n = (o.name || '').toLowerCase();
          if (n === 'odd' || /odd|impair/.test(n)) putWin(odds, `${pfx}odd`, o);
          if (n === 'even' || /even|pair/.test(n)) putWin(odds, `${pfx}even`, o);
        }
      }
    }
    // Totaux individuels par mi-temps + corners par mi-temps.
    const mtTeamTotal = low.match(/^(corners\.\s+)?(1st half|2nd half)\.\s+(.*)\s+total$/);
    if (mtTeamTotal) {
      const isCor = !!mtTeamTotal[1];
      const halfBase = mtTeamTotal[2] === '1st half' ? 'ht_' : 'h2_';
      const half = isCor ? `cor_${halfBase}` : halfBase;
      const teamPart = mtTeamTotal[3];
      const sH = tokenOverlap(teamPart, names.home), sA = tokenOverlap(teamPart, names.away);
      const side = sH > sA ? 'home' : sA > sH ? 'away' : null;
      if (side !== null) {
        for (const o of list) {
          const m = (o.name || '').match(/([\d.]+)/);
          if (!m || !isHalfLine(m[1])) continue;
          const line = parseFloat(m[1]);
          const oc = (o.outcome || '').toLowerCase();
          if (oc === 'over' || /over|plus/i.test(o.name)) putWin(odds, `${half}tt_${side}_over_${line}`, o);
          else if (oc === 'under' || /under|moins/i.test(o.name)) putWin(odds, `${half}tt_${side}_under_${line}`, o);
        }
      }
    }
    if (low.includes('draw no bet') && low.includes('1st half')) {
      for (const o of list) {
        const n = (o.name || '').toLowerCase();
        if (isHome(n)) putWin(odds, 'ht_dnb_1', o);
        else if (isAway(n)) putWin(odds, 'ht_dnb_2', o);
      }
    }
    if (low.includes('draw no bet') && low.includes('2nd half')) {
      for (const o of list) {
        const n = (o.name || '').toLowerCase();
        if (isHome(n)) putWin(odds, 'h2_dnb_1', o);
        else if (isAway(n)) putWin(odds, 'h2_dnb_2', o);
      }
    }
    if (low === 'odd/even' || low === 'total. even/odd') {
      for (const o of list) {
        const n = (o.name || '').toLowerCase();
        if (n === 'odd' || /odd|impair/.test(n)) putWin(odds, 'odd', o);
        if (n === 'even' || /even|pair/.test(n)) putWin(odds, 'even', o);
      }
    }
    // Helper strict yes/no : n'accepte QUE outcome_type explicite (yes/no/w1/w2)
    // ou nom exactement "yes"/"no". Retourne null si ambigu (evite les
    // inversions yes/no observees le 27/07 sur ht_btts_no=3.75 fantome).
    const yesNo = (o) => {
      const oc = String(o.outcome || '').toLowerCase().trim();
      const n = String(o.name || '').toLowerCase().trim();
      if (oc === 'yes' || oc === 'w1' || n === 'yes') return 'yes';
      if (oc === 'no' || oc === 'w2' || n === 'no') return 'no';
      return null;
    };
    // 1st half BTTS (avait ete oublie — 2nd half seul present).
    if (/1st half.*both teams|both teams.*1st half/i.test(low)) {
      for (const o of list) {
        const yn = yesNo(o);
        if (yn === 'yes') putWin(odds, 'ht_btts_yes', o);
        else if (yn === 'no') putWin(odds, 'ht_btts_no', o);
      }
    }
    // 2nd half BTTS.
    if (/2nd half.*both teams|both teams.*2nd half/i.test(low)) {
      for (const o of list) {
        const yn = yesNo(o);
        if (yn === 'yes') putWin(odds, 'h2_btts_yes', o);
        else if (yn === 'no') putWin(odds, 'h2_btts_no', o);
      }
    }
    // 2nd half double chance.
    if (/2nd half.*double chance/i.test(low)) {
      for (const o of list) {
        const oc = (o.outcome || '').toString().toLowerCase().replace(/\s/g, '');
        if (oc === '1x' || oc === 'x1') putWin(odds, 'h2_dc_1X', o);
        else if (oc === '12' || oc === '21') putWin(odds, 'h2_dc_12', o);
        else if (oc === 'x2' || oc === '2x') putWin(odds, 'h2_dc_X2', o);
      }
    }
    // Corners total.
    if (/^corners\.?\s+total$/i.test(low) || low === 'corners. total') {
      // Already handled by PFX mapping
    }
    // Corners odd/even.
    if (/corners.*odd.*even|corners.*even.*odd/i.test(low)) {
      for (const o of list) {
        const n = (o.name || '').toLowerCase();
        if (/odd|impair/.test(n)) putWin(odds, 'cor_odd', o);
        if (/even|pair/.test(n)) putWin(odds, 'cor_even', o);
      }
    }
    if (/first (team to score|goal)|which team scores first|team to score first/.test(low)) {
      for (const o of list) {
        const n = (o.name || '').toLowerCase();
        const oc = (o.outcome || '').toString().toLowerCase().trim();
        if (/no goal|neither|none|nobody/.test(n) || oc === 'no goal') { putWin(odds, 'fts_none', o); continue; }
        if (isHome(n) && !isAway(n)) putWin(odds, 'fts_home', o);
        else if (isAway(n) && !isHome(n)) putWin(odds, 'fts_away', o);
      }
    }
  }
  return odds;
}
