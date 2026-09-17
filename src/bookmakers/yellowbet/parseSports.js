// ═══════════════════════════════════════════════════════════════════
// YELLOWBET — HOCKEY SUR GLACE (sid 34) et TENNIS DE TABLE (sid 320).
//
// Noms de marchés relevés en direct sur le flux YellowBet le 2026-09-17 :
//   Hockey  : "1x2", "Total", "Double chance", "Both teams to score",
//             "Draw no bet", "Odd/even", "Handicap", "<Équipe> total".
//             Les variantes "(incl. overtime and penalties)" sont IGNORÉES :
//             les autres bookmakers cotent le temps réglementaire, comparer
//             les deux fabriquerait de faux arbitrages.
//             Périodes P1/P2/P3 : non couvertes (aucune convention commune).
//   Tennis de table : "Winner" (2 issues), "Total" points, "Handicap".
//
// Convention de clés : identique au reste du système (match_1/X/2, dc_*,
// btts_*, dnb_*, match_over/under_L, hcp_home/away_L, tt_home/away_*, odd/even).
// ═══════════════════════════════════════════════════════════════════
import { isHalfLine } from '../../core/markets.js';
import { priceOf, lbl, lineOf } from './parse.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Fabrique le collecteur de cotes + les identifiants natifs de placement.
function collector(odds) {
  let mkt = null;
  const put = (k, c, o) => {
    if (!c || (odds[k] && c <= odds[k])) return;
    odds[k] = c;
    if (!mkt || !o) return;
    odds._ids[k] = {
      betTypeId: mkt?.id,
      betTypeName: String(mkt?.n || ''),
      // Clé de l'issue = o.id (jamais le libellé : "o" ≠ "over").
      oddKey: String(o?.id ?? o?.n ?? ''),
      oddName: String(o?.n ?? ''),
      oddDisplayName: String(o?.dn ?? o?.n ?? ''),
      // Ligne du marché : une même clé se répète sur chaque ligne.
      oddLine: Number.isFinite(lineOf(o)) ? lineOf(o) : null,
      oddPrice: c,
      market_name_native: String(mkt?.n || ''),
      selection_name_native: String(o?.n ?? ''),
      market_path_native: null,
    };
  };
  return { put, bind: (m) => { mkt = m; } };
}

// ─── HOCKEY SUR GLACE ────────────────────────────────────────────────
export function yellowbetHockeyFlatOdds(bts, { home = '', away = '' } = {}) {
  const odds = { _ids: {} };
  if (!Array.isArray(bts)) return odds;
  const { put, bind } = collector(odds);
  const homeN = norm(home), awayN = norm(away);

  for (const b of bts) {
    const name = String(b?.n || '').trim();
    const nameLc = name.toLowerCase();
    // Tout marché prolongations/tirs au but incluses : hors comparaison.
    if (/incl\.? overtime|overtime and penalties/i.test(nameLc)) continue;
    bind(b);

    if (nameLc === '1x2') {
      for (const o of b.odds || []) {
        const n = lbl(o), c = priceOf(o);
        if (n === '1') put('match_1', c, o);
        else if (n === 'x') put('match_X', c, o);
        else if (n === '2') put('match_2', c, o);
      }
      continue;
    }
    if (nameLc === 'double chance') {
      for (const o of b.odds || []) {
        const n = lbl(o).replace(/\s/g, ''), c = priceOf(o);
        if (n === '1x') put('dc_1X', c, o);
        else if (n === '12') put('dc_12', c, o);
        else if (n === 'x2') put('dc_X2', c, o);
      }
      continue;
    }
    if (nameLc === 'both teams to score') {
      for (const o of b.odds || []) {
        const n = lbl(o), c = priceOf(o);
        if (n === 'yes') put('btts_yes', c, o);
        else if (n === 'no') put('btts_no', c, o);
      }
      continue;
    }
    if (nameLc === 'draw no bet') {
      for (const o of b.odds || []) {
        const n = lbl(o), c = priceOf(o);
        if (n === '1') put('dnb_1', c, o);
        else if (n === '2') put('dnb_2', c, o);
      }
      continue;
    }
    if (nameLc === 'odd/even') {
      for (const o of b.odds || []) {
        const n = lbl(o), c = priceOf(o);
        if (n === 'odd') put('odd', c, o);
        else if (n === 'even') put('even', c, o);
      }
      continue;
    }
    if (nameLc === 'total') {
      for (const o of b.odds || []) {
        const l = lineOf(o); if (!isHalfLine(l)) continue;
        const n = lbl(o), c = priceOf(o);
        if (n === 'over') put(`match_over_${l}`, c, o);
        else if (n === 'under') put(`match_under_${l}`, c, o);
      }
      continue;
    }
    if (nameLc === 'handicap') {
      for (const o of b.odds || []) {
        const l = lineOf(o); if (!isHalfLine(Math.abs(l))) continue;
        const n = lbl(o), c = priceOf(o);
        if (n === '1') put(`hcp_home_${l}`, c, o);
        else if (n === '2') put(`hcp_away_${-l}`, c, o);
      }
      continue;
    }
    // Total individuel : le marché porte le nom de l'équipe ("Lukko Rauma total").
    // Attribution UNIQUEMENT sur égalité stricte du nom : au moindre doute, le
    // marché est ignoré (jamais de pari posé du mauvais côté).
    const tt = nameLc.match(/^(.+?)\s+total$/);
    if (tt) {
      const who = norm(tt[1]);
      const isHome = !!homeN && who === homeN, isAway = !!awayN && who === awayN;
      if (isHome === isAway) continue;
      const side = isHome ? 'home' : 'away';
      for (const o of b.odds || []) {
        const l = lineOf(o); if (!isHalfLine(l)) continue;
        const n = lbl(o), c = priceOf(o);
        if (n === 'over') put(`tt_${side}_over_${l}`, c, o);
        else if (n === 'under') put(`tt_${side}_under_${l}`, c, o);
      }
    }
  }

  // Garde-fou : paire de totaux à marge aberrante (< 0.9) = lecture douteuse.
  for (const k of Object.keys(odds)) {
    const m = k.match(/^match_over_(\d+(?:\.\d+)?)$/);
    if (!m) continue;
    const uk = `match_under_${m[1]}`;
    if (odds[k] && odds[uk] && (1 / odds[k] + 1 / odds[uk]) < 0.9) { delete odds[k]; delete odds[uk]; }
  }
  return odds;
}

// ─── TENNIS DE TABLE ─────────────────────────────────────────────────
// Pas de nul : vainqueur strictement 2 issues. Les totaux sont en POINTS
// (aucun jeu en tennis de table) — tous les bookmakers cotent les points,
// la comparaison reste donc homogène.
export function yellowbetTableTennisFlatOdds(bts) {
  const odds = { _ids: {} };
  if (!Array.isArray(bts)) return odds;
  const { put, bind } = collector(odds);

  for (const b of bts) {
    const nameLc = String(b?.n || '').trim().toLowerCase();
    bind(b);

    if (nameLc === 'winner' || /^2\s*way$/.test(nameLc) || nameLc === 'match winner') {
      for (const o of b.odds || []) {
        const n = lbl(o), c = priceOf(o);
        if (n === '1') put('match_1', c, o);
        else if (n === '2') put('match_2', c, o);
      }
      continue;
    }
    if (nameLc === 'total' || nameLc === 'total points') {
      for (const o of b.odds || []) {
        const l = lineOf(o); if (!isHalfLine(l)) continue;
        const n = lbl(o), c = priceOf(o);
        if (n === 'over') put(`match_over_${l}`, c, o);
        else if (n === 'under') put(`match_under_${l}`, c, o);
      }
      continue;
    }
    if (nameLc === 'handicap' || nameLc === 'points handicap') {
      for (const o of b.odds || []) {
        const l = lineOf(o); if (!isHalfLine(Math.abs(l))) continue;
        const n = lbl(o), c = priceOf(o);
        if (n === '1') put(`hcp_home_${l}`, c, o);
        else if (n === '2') put(`hcp_away_${-l}`, c, o);
      }
      continue;
    }
    if (nameLc === 'set handicap') {
      for (const o of b.odds || []) {
        const l = lineOf(o); if (!isHalfLine(Math.abs(l))) continue;
        const n = lbl(o), c = priceOf(o);
        if (n === '1') put(`hcp_sets_home_${l}`, c, o);
        else if (n === '2') put(`hcp_sets_away_${-l}`, c, o);
      }
      continue;
    }
    if (nameLc === '1st set winner' || nameLc === 'winner 1st set') {
      for (const o of b.odds || []) {
        const n = lbl(o), c = priceOf(o);
        if (n === '1') put('s1_match_1', c, o);
        else if (n === '2') put('s1_match_2', c, o);
      }
    }
  }
  return odds;
}
