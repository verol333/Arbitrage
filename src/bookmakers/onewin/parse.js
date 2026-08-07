// Parseur football + tennis 1win (groupes REST → cotes plates standard).
// Port fidèle de matchCore.ts winFlatOdds().
import { isHalfLine } from '../../core/markets.js';
import { tokenOverlap } from '../../core/text.js';

// Convertit les groupes tennis 1win → cotes plates canoniques.
// Prefixes set : "1st set."/"2nd set."/"3rd set." → sN_.
// Marches : Winner, Handicap, Total, <Player> total, Total. Odd/Even.
export function winTennisFlatOdds(groups, names) {
  const odds = {};
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
        if (oc === '1') odds[`${pfx}match_1`] = Number(o.cf);
        else if (oc === '2') odds[`${pfx}match_2`] = Number(o.cf);
        else if (isHome(n) && !isAway(n)) odds[`${pfx}match_1`] = Number(o.cf);
        else if (isAway(n) && !isHome(n)) odds[`${pfx}match_2`] = Number(o.cf);
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
        odds[`${pfx}hcp_${side}_${line}`] = Number(o.cf);
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
          if (isOver) odds[`${pfx}over_${line}`] = Number(o.cf);
          else odds[`${pfx}under_${line}`] = Number(o.cf);
        } else {
          // Match : match_over_X / match_under_X
          if (isOver) odds[`match_over_${line}`] = Number(o.cf);
          else odds[`match_under_${line}`] = Number(o.cf);
        }
      }
    }
    // Total. Odd/Even
    else if (base === 'total. odd/even' || base === 'odd/even') {
      for (const o of list) {
        const oc = String(o.outcome || '').toLowerCase().trim();
        const n = String(o.name || '').toLowerCase();
        if (oc === 'odd' || /odd/i.test(n)) odds[`${pfx}odd`] = Number(o.cf);
        else if (oc === 'even' || /even/i.test(n)) odds[`${pfx}even`] = Number(o.cf);
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
        if (isOver) odds[`tt_${side}_over_${line}`] = Number(o.cf);
        else if (isUnder) odds[`tt_${side}_under_${line}`] = Number(o.cf);
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
  const odds = {};
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
        if (oc === '1' || oc === 'w1' || oc === 'home') odds[`${pfx}match_1`] = num(o);
        else if (oc === '2' || oc === 'w2' || oc === 'away') odds[`${pfx}match_2`] = num(o);
        else if (oc === 'x' || oc === 'draw') odds[`${pfx}match_X`] = num(o);
        else if (isHome(n) && !isAway(n)) odds[`${pfx}match_1`] = num(o);
        else if (isAway(n) && !isHome(n)) odds[`${pfx}match_2`] = num(o);
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
          if (isOver) odds[`${pfx}over_${line}`] = num(o);
          else if (isUnder) odds[`${pfx}under_${line}`] = num(o);
        } else {
          if (isOver) odds[`match_over_${line}`] = num(o);
          else if (isUnder) odds[`match_under_${line}`] = num(o);
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
        if (sH >= sA) odds[`${pfx}hcp_home_${line}`] = num(o);
        else odds[`${pfx}hcp_away_${line}`] = num(o);
      }
      continue;
    }

    // Odd/Even (incl. OT) ou "Nth quarter. Odd/Even"
    if (/^odd\/even\s*(?:\(incl\.\s*ot\))?$/.test(base)) {
      for (const o of list) {
        const oc = String(o.outcome || '').toLowerCase().trim();
        const n = String(o.name || '').toLowerCase();
        if (oc === 'odd' || /odd/.test(n)) odds[`${pfx}odd`] = num(o);
        else if (oc === 'even' || /even/.test(n)) odds[`${pfx}even`] = num(o);
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
        if (isOver) odds[`tt_${side}_over_${line}`] = num(o);
        else if (isUnder) odds[`tt_${side}_under_${line}`] = num(o);
      }
      continue;
    }
  }
  return odds;
}

export function winFlatOdds(groups, names) {
  const odds = {};
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
        if (oc === '1' || oc === 'w1' || oc === 'home') odds.match_1 = Number(o.cf);
        else if (oc === '2' || oc === 'w2' || oc === 'away') odds.match_2 = Number(o.cf);
        else if (oc === 'x' || oc === 'draw') odds.match_X = Number(o.cf);
        else if (isDraw(n)) odds.match_X = Number(o.cf);
        else if (isHome(n) && !isAway(n)) odds.match_1 = Number(o.cf);
        else if (isAway(n) && !isHome(n)) odds.match_2 = Number(o.cf);
      }
    }
    if (low === 'double chance (regular time)' || low === 'double chance') {
      for (const o of list) {
        const oc = (o.outcome || '').toString().toLowerCase().replace(/\s/g, '');
        const n = (o.name || '').toLowerCase();
        if (oc === '1x' || oc === 'x1') odds.dc_1X = Number(o.cf);
        else if (oc === '12' || oc === '21') odds.dc_12 = Number(o.cf);
        else if (oc === 'x2' || oc === '2x') odds.dc_X2 = Number(o.cf);
        else if (isDraw(n) && isHome(n)) odds.dc_1X = Number(o.cf);
        else if (isDraw(n) && isAway(n)) odds.dc_X2 = Number(o.cf);
        else if (isHome(n) && isAway(n)) odds.dc_12 = Number(o.cf);
      }
    }
    if (low === 'both teams to score') {
      for (const o of list) {
        const n = (o.name || '').toLowerCase();
        if (n === 'yes' || n.includes('yes')) odds.btts_yes = Number(o.cf);
        if (n === 'no' || n.includes('no')) odds.btts_no = Number(o.cf);
      }
    }
    if (low.includes('draw no bet')) {
      for (const o of list) {
        const n = (o.name || '').toLowerCase();
        if (isHome(n)) odds.dnb_1 = Number(o.cf);
        else if (isAway(n)) odds.dnb_2 = Number(o.cf);
      }
    }
    if (low === 'total') {
      for (const o of list) {
        const mo = (o.name || '').match(/over\s*\(?([\d.]+)/i);
        const mu = (o.name || '').match(/under\s*\(?([\d.]+)/i);
        if (mo && isHalfLine(mo[1])) odds[`match_over_${parseFloat(mo[1])}`] = Number(o.cf);
        if (mu && isHalfLine(mu[1])) odds[`match_under_${parseFloat(mu[1])}`] = Number(o.cf);
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
        if (oc === 'over' || /over|plus/i.test(o.name)) odds[`tt_${side}_over_${line}`] = Number(o.cf);
        else if (oc === 'under' || /under|moins/i.test(o.name)) odds[`tt_${side}_under_${line}`] = Number(o.cf);
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
        if (scoreHome >= scoreAway) odds[`hcp_home_${line}`] = Number(o.cf);
        else odds[`hcp_away_${line}`] = Number(o.cf);
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
          if (mo && isHalfLine(mo[1])) odds[`${pfx}over_${parseFloat(mo[1])}`] = Number(o.cf);
          if (mu && isHalfLine(mu[1])) odds[`${pfx}under_${parseFloat(mu[1])}`] = Number(o.cf);
        }
      } else if (base === 'result') {
        for (const o of list) {
          const oc = (o.outcome || '').toString().toLowerCase().trim();
          const n = (o.name || '').toLowerCase();
          if (oc === '1' || oc === 'w1' || oc === 'home') odds[`${pfx}match_1`] = Number(o.cf);
          else if (oc === '2' || oc === 'w2' || oc === 'away') odds[`${pfx}match_2`] = Number(o.cf);
          else if (oc === 'x' || oc === 'draw') odds[`${pfx}match_X`] = Number(o.cf);
          else if (isDraw(n)) odds[`${pfx}match_X`] = Number(o.cf);
          else if (isHome(n) && !isAway(n)) odds[`${pfx}match_1`] = Number(o.cf);
          else if (isAway(n) && !isHome(n)) odds[`${pfx}match_2`] = Number(o.cf);
        }
      } else if (base === 'double chance') {
        for (const o of list) {
          const oc = (o.outcome || '').toString().toLowerCase().replace(/\s/g, '');
          if (oc === '1x' || oc === 'x1') odds[`${pfx}dc_1X`] = Number(o.cf);
          else if (oc === '12' || oc === '21') odds[`${pfx}dc_12`] = Number(o.cf);
          else if (oc === 'x2' || oc === '2x') odds[`${pfx}dc_X2`] = Number(o.cf);
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
          if (scoreHome >= scoreAway) odds[`${pfx}hcp_home_${line}`] = Number(o.cf);
          else odds[`${pfx}hcp_away_${line}`] = Number(o.cf);
        }
      } else if (base === 'total. even/odd' || base === 'odd/even' || base === 'even/odd') {
        for (const o of list) {
          const n = (o.name || '').toLowerCase();
          if (n === 'odd' || /odd|impair/.test(n)) odds[`${pfx}odd`] = Number(o.cf);
          if (n === 'even' || /even|pair/.test(n)) odds[`${pfx}even`] = Number(o.cf);
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
          if (oc === 'over' || /over|plus/i.test(o.name)) odds[`${half}tt_${side}_over_${line}`] = Number(o.cf);
          else if (oc === 'under' || /under|moins/i.test(o.name)) odds[`${half}tt_${side}_under_${line}`] = Number(o.cf);
        }
      }
    }
    if (low.includes('draw no bet') && low.includes('1st half')) {
      for (const o of list) {
        const n = (o.name || '').toLowerCase();
        if (isHome(n)) odds.ht_dnb_1 = Number(o.cf);
        else if (isAway(n)) odds.ht_dnb_2 = Number(o.cf);
      }
    }
    if (low.includes('draw no bet') && low.includes('2nd half')) {
      for (const o of list) {
        const n = (o.name || '').toLowerCase();
        if (isHome(n)) odds.h2_dnb_1 = Number(o.cf);
        else if (isAway(n)) odds.h2_dnb_2 = Number(o.cf);
      }
    }
    if (low === 'odd/even' || low === 'total. even/odd') {
      for (const o of list) {
        const n = (o.name || '').toLowerCase();
        if (n === 'odd' || /odd|impair/.test(n)) odds.odd = Number(o.cf);
        if (n === 'even' || /even|pair/.test(n)) odds.even = Number(o.cf);
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
        if (yn === 'yes') odds.ht_btts_yes = Number(o.cf);
        else if (yn === 'no') odds.ht_btts_no = Number(o.cf);
      }
    }
    // 2nd half BTTS.
    if (/2nd half.*both teams|both teams.*2nd half/i.test(low)) {
      for (const o of list) {
        const yn = yesNo(o);
        if (yn === 'yes') odds.h2_btts_yes = Number(o.cf);
        else if (yn === 'no') odds.h2_btts_no = Number(o.cf);
      }
    }
    // 2nd half double chance.
    if (/2nd half.*double chance/i.test(low)) {
      for (const o of list) {
        const oc = (o.outcome || '').toString().toLowerCase().replace(/\s/g, '');
        if (oc === '1x' || oc === 'x1') odds.h2_dc_1X = Number(o.cf);
        else if (oc === '12' || oc === '21') odds.h2_dc_12 = Number(o.cf);
        else if (oc === 'x2' || oc === '2x') odds.h2_dc_X2 = Number(o.cf);
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
        if (/odd|impair/.test(n)) odds.cor_odd = Number(o.cf);
        if (/even|pair/.test(n)) odds.cor_even = Number(o.cf);
      }
    }
    if (/first (team to score|goal)|which team scores first|team to score first/.test(low)) {
      for (const o of list) {
        const n = (o.name || '').toLowerCase();
        const oc = (o.outcome || '').toString().toLowerCase().trim();
        if (/no goal|neither|none|nobody/.test(n) || oc === 'no goal') { odds.fts_none = Number(o.cf); continue; }
        if (isHome(n) && !isAway(n)) odds.fts_home = Number(o.cf);
        else if (isAway(n) && !isHome(n)) odds.fts_away = Number(o.cf);
      }
    }
  }
  return odds;
}
