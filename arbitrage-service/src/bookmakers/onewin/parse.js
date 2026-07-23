// Parseur football 1win (groupes REST → cotes plates standard).
// Port fidèle de matchCore.ts winFlatOdds().
import { isHalfLine } from '../../core/markets.js';
import { tokenOverlap } from '../../core/text.js';

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
    if (low === 'odd/even') {
      for (const o of list) {
        const n = (o.name || '').toLowerCase();
        if (n === 'odd' || /odd|impair/.test(n)) odds.odd = Number(o.cf);
        if (n === 'even' || /even|pair/.test(n)) odds.even = Number(o.cf);
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
