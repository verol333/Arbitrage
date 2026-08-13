// Lecture cotes Congobet football (events/{id}). Port fidèle de matchCore.ts congobetOdds().
import { CONGO_API, congoJson } from './api.js';
import { isHalfLine } from '../../core/markets.js';
import { tokenOverlap } from '../../core/text.js';

export async function getOdds(matchId, { live = false, noCache = false, sport = 'football' } = {}) {
  const json = await congoJson(`${CONGO_API}events/${matchId}`, { noCache: live || noCache });
  if (!json?.eventBetTypes) return null;
  if (sport === 'basket') return congobetBasket(json);
  if (sport === 'table_tennis') return congobetTableTennis(json);
  const home = json.homeTeamName || ''; const away = json.awayTeamName || '';
  const odds = { _ids: {} };
  // Helper : ecrit odds[key] = value ET odds._ids[key] = { eventBetTypeItemId,
  // totalOdds } pour permettre au backend de generer un code coupon (endpoint
  // /api/betting/get-my-code, format attendu par Congobet SaveCoupon).
  const put = (key, it) => { odds[key] = Number(it.odds); odds._ids[key] = { eventBetTypeItemId: it.id, totalOdds: Number(it.odds) }; };
  const ctxNum = (bt, key) => {
    try { const c = JSON.parse(bt.betTypeContext || '{}'); if (c[key] != null) return parseFloat(String(c[key])); } catch { /* ignore */ }
    return null;
  };
  const read1x2 = (items, pfx) => {
    for (const it of items) {
      const s = (it.shortName || '').trim().toLowerCase();
      if (s === '1') put(`${pfx}match_1`, it);
      else if (s === 'x') put(`${pfx}match_X`, it);
      else if (s === '2') put(`${pfx}match_2`, it);
    }
  };
  const readDC = (items, pfx) => {
    for (const it of items) {
      const s = (it.shortName || '').replace(/\s/g, '').toLowerCase();
      if (s === '1x') put(`${pfx}dc_1X`, it);
      else if (s === '12') put(`${pfx}dc_12`, it);
      else if (s === 'x2') put(`${pfx}dc_X2`, it);
    }
  };
  const readTotal = (items, line, overKey, underKey) => {
    if (line == null || !isHalfLine(line)) return;
    for (const it of items) {
      if (/>|\+|plus|over/.test(it.shortName)) put(overKey, it);
      else if (/<|moins|under/.test(it.shortName)) put(underKey, it);
    }
  };
  const readIndivTotal = (bt, items, line, pfx) => {
    if (line == null || !isHalfLine(line)) return;
    const teamPart = (bt.name || '').replace(/total (de |des )?buts (de |du |des )?/i, '').trim();
    const sH = tokenOverlap(teamPart, home), sA = tokenOverlap(teamPart, away);
    const side = sH > sA ? 'home' : sA > sH ? 'away' : null;
    if (side === null) return;
    for (const it of items) {
      if (/>|\+|plus|over/.test(it.shortName)) put(`${pfx}tt_${side}_over_${line}`, it);
      else if (/<|moins|under/.test(it.shortName)) put(`${pfx}tt_${side}_under_${line}`, it);
    }
  };
  const readOddEven = (items, pfx) => {
    for (const it of items) {
      const s = (it.shortName || '').toLowerCase();
      if (/impair|odd/.test(s)) put(`${pfx}odd`, it);
      else if (/pair|even/.test(s)) put(`${pfx}even`, it);
    }
  };
  const readHcpEcart = (bt, items, homeKey, awayKey) => {
    for (const it of items) {
      const s = it.shortName || '';
      const mLine = s.match(/\(([+-]?\d+(?:\.\d+)?)\)/);
      if (!mLine) continue;
      const line = parseFloat(mLine[1]);
      if (!isHalfLine(line)) continue;
      if (/^1\b/.test(s.trim())) put(homeKey(line), it);
      else if (/^2\b/.test(s.trim())) put(awayKey(line), it);
    }
  };

  for (const bt of json.eventBetTypes) {
    const items = (bt.eventBetTypeItems || []).filter((it) => it.active && it.bettingAllowed && Number(it.odds) > 1);
    if (!items.length) continue;
    // Congobet préfixe les betTypeIds en LIVE avec 2xxxx (au lieu de 1xxxx en
    // prématch). Ex : 20001 (live) === 10001 (prématch) = Résultat du match.
    // Sans normalisation, 0 marché parsé sur tous les matchs live.
    const rawId = Number(bt.betTypeId);
    const id = rawId >= 20000 && rawId < 30000 ? rawId - 10000 : rawId;
    const total = ctxNum(bt, 'total');
    if (id === 10001) read1x2(items, '');
    else if (id === 10008) readDC(items, '');
    else if (id === 10010) { for (const it of items) { const s = (it.shortName || '').toLowerCase(); if (/oui|yes/.test(s)) put('btts_yes', it); else if (/non|no/.test(s)) put('btts_no', it); } }
    else if (id === 10003) readTotal(items, total, `match_over_${total}`, `match_under_${total}`);
    else if (id === 10055 || id === 10056) readIndivTotal(bt, items, total, '');
    else if (id === 10015) { for (const it of items) { const s = (it.shortName || '').trim(); if (s === '1') put('dnb_1', it); else if (s === '2') put('dnb_2', it); } }
    else if (id === 10016) readHcpEcart(bt, items, (l) => `hcp_home_${l}`, (l) => `hcp_away_${l}`);
    else if (id === 10031) readOddEven(items, '');
    else if (id === 10007) read1x2(items, 'ht_');
    else if (id === 10104) readDC(items, 'ht_');
    else if (id === 10028) { for (const it of items) { const s = (it.shortName || '').toLowerCase(); if (/oui|yes/.test(s)) put('ht_btts_yes', it); else if (/non|no/.test(s)) put('ht_btts_no', it); } }
    else if (id === 10011) readTotal(items, total, `ht_over_${total}`, `ht_under_${total}`);
    else if (id === 10108 || id === 10109) readIndivTotal(bt, items, total, 'ht_');
    else if (id === 10107) readHcpEcart(bt, items, (l) => `ht_hcp_home_${l}`, (l) => `ht_hcp_away_${l}`);
    else if (id === 10113) readOddEven(items, 'ht_');
    else if (id === 10024) read1x2(items, 'h2_');
    else if (id === 10120) readDC(items, 'h2_');
    else if (id === 10029) { for (const it of items) { const s = (it.shortName || '').toLowerCase(); if (/oui|yes/.test(s)) put('h2_btts_yes', it); else if (/non|no/.test(s)) put('h2_btts_no', it); } }
    else if (id === 10030) readTotal(items, total, `h2_over_${total}`, `h2_under_${total}`);
    else if (id === 10124 || id === 10125) readIndivTotal(bt, items, total, 'h2_');
    else if (id === 10123) readHcpEcart(bt, items, (l) => `h2_hcp_home_${l}`, (l) => `h2_hcp_away_${l}`);
    else if (id === 10127) readOddEven(items, 'h2_');
    else if (id === 10147) { const t = ctxNum(bt, 'total'); readTotal(items, t, `cor_over_${t}`, `cor_under_${t}`); }
    else if (id === 10504) { const t = ctxNum(bt, 'total'); readTotal(items, t, `cor_ht_over_${t}`, `cor_ht_under_${t}`); }
    else if (id === 10153) readOddEven(items, 'cor_');
    else if (id === 10146) readHcpEcart(bt, items, (l) => `cor_hcp_home_${l}`, (l) => `cor_hcp_away_${l}`);
    // DNB by half.
    else if (id === 10106) { for (const it of items) { const s = (it.shortName || '').trim(); if (s === '1') put('ht_dnb_1', it); else if (s === '2') put('ht_dnb_2', it); } }
    else if (id === 10119) { for (const it of items) { const s = (it.shortName || '').trim(); if (s === '1') put('h2_dnb_1', it); else if (s === '2') put('h2_dnb_2', it); } }
    // Half with most goals — audit prouve id=10022 (pas 10036).
    // shortName: "1ère" | "2ème" | "X"
    else if (id === 10022) {
      for (const it of items) {
        const s = (it.shortName || '').toLowerCase();
        if (/1(st|ère|ere)?\s*(mi|half)?/i.test(s) || s === '1') put('half_most_ht', it);
        else if (/2(nd|ème|eme)?\s*(mi|half)?/i.test(s) || s === '2') put('half_most_h2', it);
        else if (/egal|equal|draw|x/i.test(s)) put('half_most_equal', it);
      }
    }
    // ═══ Nouveaux marchés foot (audit exhaustif 2026-08-13) ══════════
    // Team Clean Sheet home/away (2-way Yes/No). Team name dans bt.name.
    else if (id === 10013 || id === 10014) {
      const teamPart = (bt.name || '').replace(/n[’']?encaisse pas de but/i, '').trim();
      const sH = tokenOverlap(teamPart, home), sA = tokenOverlap(teamPart, away);
      const side = sH > sA ? 'home' : sA > sH ? 'away' : null;
      if (side !== null) for (const it of items) {
        const s = (it.shortName || '').toLowerCase();
        if (/oui|yes/.test(s)) put(`cs_${side}_yes`, it);
        else if (/non|no/.test(s)) put(`cs_${side}_no`, it);
      }
    }
    // Team scores each half (2-way Y/N) - 10032/10033
    else if (id === 10032 || id === 10033) {
      const teamPart = (bt.name || '').replace(/marque à chaque mi-temps/i, '').trim();
      const sH = tokenOverlap(teamPart, home), sA = tokenOverlap(teamPart, away);
      const side = sH > sA ? 'home' : sA > sH ? 'away' : null;
      if (side !== null) for (const it of items) {
        const s = (it.shortName || '').toLowerCase();
        if (/oui|yes/.test(s)) put(`tt_${side}_score_each_half_yes`, it);
        else if (/non|no/.test(s)) put(`tt_${side}_score_each_half_no`, it);
      }
    }
    // Team wins both halves (2-way Y/N) - 10037/10038
    else if (id === 10037 || id === 10038) {
      const teamPart = (bt.name || '').replace(/gagne les deux mi-temps/i, '').trim();
      const sH = tokenOverlap(teamPart, home), sA = tokenOverlap(teamPart, away);
      const side = sH > sA ? 'home' : sA > sH ? 'away' : null;
      if (side !== null) for (const it of items) {
        const s = (it.shortName || '').toLowerCase();
        if (/oui|yes/.test(s)) put(`tt_${side}_wins_both_halves_yes`, it);
        else if (/non|no/.test(s)) put(`tt_${side}_wins_both_halves_no`, it);
      }
    }
    // Team wins to nil (2-way Y/N) - 10066/10067
    else if (id === 10066 || id === 10067) {
      const teamPart = (bt.name || '').replace(/gagne sans encaisser de buts/i, '').trim();
      const sH = tokenOverlap(teamPart, home), sA = tokenOverlap(teamPart, away);
      const side = sH > sA ? 'home' : sA > sH ? 'away' : null;
      if (side !== null) for (const it of items) {
        const s = (it.shortName || '').toLowerCase();
        if (/oui|yes/.test(s)) put(`tt_${side}_wins_to_nil_yes`, it);
        else if (/non|no/.test(s)) put(`tt_${side}_wins_to_nil_no`, it);
      }
    }
    // Team wins at least one half (2-way Y/N) - 10070/10071
    else if (id === 10070 || id === 10071) {
      const teamPart = (bt.name || '').replace(/gagne au moins une mi-temps/i, '').trim();
      const sH = tokenOverlap(teamPart, home), sA = tokenOverlap(teamPart, away);
      const side = sH > sA ? 'home' : sA > sH ? 'away' : null;
      if (side !== null) for (const it of items) {
        const s = (it.shortName || '').toLowerCase();
        if (/oui|yes/.test(s)) put(`tt_${side}_wins_atleast_one_half_yes`, it);
        else if (/non|no/.test(s)) put(`tt_${side}_wins_atleast_one_half_no`, it);
      }
    }
    // First goal scorer team (3-way 1/X/2) - 10082
    else if (id === 10082) {
      for (const it of items) {
        const s = (it.shortName || '').toLowerCase();
        if (/1er.*but.*:\s*1/.test(s)) put('first_goal_1', it);
        else if (/1er.*but.*:\s*x/.test(s) || /pas de but/.test(s)) put('first_goal_X', it);
        else if (/1er.*but.*:\s*2/.test(s)) put('first_goal_2', it);
      }
    }
    // Last goal scorer team (3-way 1/X/2) - 10083
    else if (id === 10083) {
      for (const it of items) {
        const s = (it.shortName || '').trim().toLowerCase();
        if (s === '1') put('last_goal_1', it);
        else if (s === 'x' || /pas de but/.test(s)) put('last_goal_X', it);
        else if (s === '2') put('last_goal_2', it);
      }
    }
    // Team goals odd/even - 10089/10090
    else if (id === 10089 || id === 10090) {
      const teamPart = (bt.name || '').replace(/nombre de buts de/i, '').trim();
      const sH = tokenOverlap(teamPart, home), sA = tokenOverlap(teamPart, away);
      const side = sH > sA ? 'home' : sA > sH ? 'away' : null;
      if (side !== null) for (const it of items) {
        const s = (it.shortName || '').toLowerCase();
        if (/impair|odd/.test(s)) put(`tt_${side}_odd`, it);
        else if (/pair|even/.test(s)) put(`tt_${side}_even`, it);
      }
    }
    // BTTS each half (2-way Y/N) - 10099
    else if (id === 10099) {
      for (const it of items) {
        const s = (it.shortName || '').toLowerCase();
        if (/oui\s*\/\s*oui|yes\s*\/\s*yes/.test(s)) put('btts_each_half_yes', it);
        else if (/non\s*\/\s*non|no\s*\/\s*no/.test(s)) put('btts_each_half_no', it);
      }
    }
    // Over 1.5 each half (2-way Y/N) - 10100
    else if (id === 10100) {
      for (const it of items) {
        const s = (it.shortName || '').toLowerCase();
        if (/oui|yes/.test(s)) put('over_1.5_each_half_yes', it);
        else if (/non|no/.test(s)) put('over_1.5_each_half_no', it);
      }
    }
    // Under 1.5 each half (2-way Y/N) - 10101
    else if (id === 10101) {
      for (const it of items) {
        const s = (it.shortName || '').toLowerCase();
        if (/oui|yes/.test(s)) put('under_1.5_each_half_yes', it);
        else if (/non|no/.test(s)) put('under_1.5_each_half_no', it);
      }
    }
    // 1MT Team Clean Sheet - 10114/10115
    else if (id === 10114 || id === 10115) {
      const teamPart = (bt.name || '').replace(/1ère mi-temps\s*-\s*/i, '').replace(/n[’']?encaisse pas de but/i, '').trim();
      const sH = tokenOverlap(teamPart, home), sA = tokenOverlap(teamPart, away);
      const side = sH > sA ? 'home' : sA > sH ? 'away' : null;
      if (side !== null) for (const it of items) {
        const s = (it.shortName || '').toLowerCase();
        if (/oui|yes/.test(s)) put(`ht_cs_${side}_yes`, it);
        else if (/non|no/.test(s)) put(`ht_cs_${side}_no`, it);
      }
    }
    // 2MT Team Clean Sheet - 10128/10129
    else if (id === 10128 || id === 10129) {
      const teamPart = (bt.name || '').replace(/2ème mi-temps\s*-\s*/i, '').replace(/n[’']?encaisse pas de but/i, '').trim();
      const sH = tokenOverlap(teamPart, home), sA = tokenOverlap(teamPart, away);
      const side = sH > sA ? 'home' : sA > sH ? 'away' : null;
      if (side !== null) for (const it of items) {
        const s = (it.shortName || '').toLowerCase();
        if (/oui|yes/.test(s)) put(`h2_cs_${side}_yes`, it);
        else if (/non|no/.test(s)) put(`h2_cs_${side}_no`, it);
      }
    }
    // Combos explicitement ignorés (l'audit prouve que ces IDs sont des combos
    // multi-marchés non comparables) :
    // - 10009 : Résultat Mi-temps / Fin de match (9-way)
    // - 10021 : Handicap Européen (3-way, jamais lisible directement)
    // - 10025 : Les deux équipes marquent et nombre de buts
    // - 10026 : Résultat du match et les deux équipes marquent
    // - 10027 : Résultat du match et nombre de buts
    // - 10039 : Double chance et nombre de buts (PAS "First team to score" !
    //           l'ancien mapping fts_* était SILENCIEUSEMENT vide car les
    //           shortName ne matchaient jamais "1"/"2" — accidentellement safe)
    // - 10040 : Double chance et les deux équipes marquent
    // - 10116/10117 : 1ère mi-temps - Résultat & (BTTS|nb buts)
    // - 10309/10310/10312/10489 : DC & BTTS période
    else if ([10009, 10021, 10025, 10026, 10027, 10039, 10040, 10116, 10117, 10309, 10310, 10312, 10489].includes(id)) {
      // no-op
    }
    // ─── TENNIS bettype IDs (probe v3 : Lehecka vs Wong dump) ────────────────
    // Match Winner 2-way (pas de X).
    else if (id === 10002) {
      for (const it of items) {
        const s = (it.shortName || '').trim();
        if (s === '1') put('match_1', it);
        else if (s === '2') put('match_2', it);
      }
    }
    // Total Games (match). ctx.total = 20.5/21.5/22.5
    else if (id === 10155) readTotal(items, total, `match_over_${total}`, `match_under_${total}`);
    // Sets Handicap (Ecart de sets). shortName "1 (-1.5)" / "2 (+1.5)"
    else if (id === 10044) readHcpEcart(bt, items, (l) => `set_hcp_home_${l}`, (l) => `set_hcp_away_${l}`);
    // Games Handicap (Ecart de jeux)
    else if (id === 10045) readHcpEcart(bt, items, (l) => `hcp_home_${l}`, (l) => `hcp_away_${l}`);
    // Player 1 Total Games (tt_home)
    else if (id === 10048) {
      if (total != null && isHalfLine(total)) for (const it of items) {
        if (/>|\+|plus|over/.test(it.shortName)) put(`tt_home_over_${total}`, it);
        else if (/<|moins|under/.test(it.shortName)) put(`tt_home_under_${total}`, it);
      }
    }
    // Player 2 Total Games (tt_away)
    else if (id === 10157) {
      if (total != null && isHalfLine(total)) for (const it of items) {
        if (/>|\+|plus|over/.test(it.shortName)) put(`tt_away_over_${total}`, it);
        else if (/<|moins|under/.test(it.shortName)) put(`tt_away_under_${total}`, it);
      }
    }
    // Total exact de sets (2 ou 3 en best-of-3) → set_under/over_2.5
    else if (id === 10158) {
      for (const it of items) {
        const s = (it.shortName || '').trim();
        if (s === '2') put('set_under_2.5', it);
        else if (s === '3') put('set_over_2.5', it);
      }
    }
    // Vainqueur du set (per-set winner). ctx.setnr = "1"/"2"/"3"
    // shortName format "1er - 1" / "2ème - 2" etc.
    else if (id === 10161) {
      const setnr = ctxNum(bt, 'setnr');
      if (setnr >= 1 && setnr <= 3) {
        const pfx = `s${setnr}_`;
        for (const it of items) {
          const s = (it.shortName || '');
          if (/-\s*1\s*$/.test(s)) put(`${pfx}match_1`, it);
          else if (/-\s*2\s*$/.test(s)) put(`${pfx}match_2`, it);
        }
      }
    }
    // Per-set games handicap (Ecart de jeux dans le set)
    else if (id === 10162) {
      const setnr = ctxNum(bt, 'setnr');
      if (setnr >= 1 && setnr <= 3) {
        const pfx = `s${setnr}_`;
        readHcpEcart(bt, items, (l) => `${pfx}hcp_home_${l}`, (l) => `${pfx}hcp_away_${l}`);
      }
    }
    // Per-set total games (Nombre de jeux du set)
    else if (id === 10163) {
      const setnr = ctxNum(bt, 'setnr');
      if (setnr >= 1 && setnr <= 3 && total != null && isHalfLine(total)) {
        const pfx = `s${setnr}_`;
        readTotal(items, total, `${pfx}over_${total}`, `${pfx}under_${total}`);
      }
    }
    // ═══ Nouveaux marchés tennis (audit 2026-08-13) ══════════════════
    // 10049 "Y aura-t-il un 6-0 ?" (Y/N)
    else if (id === 10049) {
      for (const it of items) {
        const s = (it.shortName || '').toLowerCase();
        if (/oui|yes/.test(s)) put('set_60_yes', it);
        else if (/non|no/.test(s)) put('set_60_no', it);
      }
    }
    // 10050/10053 Team wins a set (2-way Y/N)
    else if (id === 10050 || id === 10053) {
      const teamPart = (bt.name || '').replace(/gagnera un set/i, '').replace(/[?]/g, '').trim();
      const sH = tokenOverlap(teamPart, home), sA = tokenOverlap(teamPart, away);
      const side = sH > sA ? 'home' : sA > sH ? 'away' : null;
      if (side !== null) for (const it of items) {
        const s = (it.shortName || '').toLowerCase();
        if (/oui|yes/.test(s)) put(`tt_${side}_wins_a_set_yes`, it);
        else if (/non|no/.test(s)) put(`tt_${side}_wins_a_set_no`, it);
      }
    }
    // 10159 Nombre de jeux Pair/Impair (match)
    else if (id === 10159) readOddEven(items, '');
  }
  return odds;
}

// ═══════════════════════════════════════════════════════════════
// PARSEUR TABLE TENNIS Congobet — betTypeIds identifies via F12 user 2026-08-13
// (Czech Liga Pro, Stolfa vs Janata, Kasnik vs Sychra) :
//   10002  "Résultat du match" (Winner 2-way : 1/2)
//   10183  "Ecart entre équipes" (Handicap : "1 (+4.5)" / "2 (-4.5)") ctx.hcp
//   10184  "Nombre de points" (Total : "> 74.5" / "< 74.5") ctx.total
//   10185  "Nombre exact de sets" (bestof:5 → 3/4/5)
//   10186  "Vainqueur du jeu" (par jeu, ctx.gamenr — non exploite cross-book)
//   10492  "Score exact" (bestof:5 3:0/3:1/3:2/0:3/1:3/2:3 — 6-way non exploite)
// IGNORE : 10186 (game-level trop specifique), 10492 (6-way score exact).
function congobetTableTennis(json) {
  const odds = { _ids: {} };
  const put = (key, it) => { odds[key] = Number(it.odds); odds._ids[key] = { eventBetTypeItemId: it.id, totalOdds: Number(it.odds) }; };
  const ctxNum = (bt, key) => {
    try { const c = JSON.parse(bt.betTypeContext || '{}'); if (c[key] != null) return parseFloat(String(c[key])); } catch { /* ignore */ }
    return null;
  };
  const readHcpEcart = (items, homeKey, awayKey) => {
    for (const it of items) {
      const s = it.shortName || '';
      const mLine = s.match(/\(([+-]?\d+(?:\.\d+)?)\)/);
      if (!mLine) continue;
      const line = parseFloat(mLine[1]);
      if (!isHalfLine(line)) continue;
      if (/^1\b/.test(s.trim())) put(homeKey(line), it);
      else if (/^2\b/.test(s.trim())) put(awayKey(line), it);
    }
  };
  const readTotal = (items, line, overKey, underKey) => {
    if (line == null || !isHalfLine(line)) return;
    for (const it of items) {
      if (/>|\+|plus|over/.test(it.shortName)) put(overKey, it);
      else if (/<|moins|under/.test(it.shortName)) put(underKey, it);
    }
  };
  for (const bt of json.eventBetTypes) {
    const items = (bt.eventBetTypeItems || []).filter((it) => it.active && it.bettingAllowed && Number(it.odds) > 1);
    if (!items.length) continue;
    const rawId = Number(bt.betTypeId);
    const id = rawId >= 20000 && rawId < 30000 ? rawId - 10000 : rawId;
    // Winner 2-way (TT est 2-way, pas de nul).
    if (id === 10002) {
      for (const it of items) {
        const s = (it.shortName || '').trim();
        if (s === '1') put('match_1', it);
        else if (s === '2') put('match_2', it);
      }
    }
    // Handicap points (TT-specifique id=10183, ctx.hcp au lieu de shortName).
    else if (id === 10183) {
      readHcpEcart(items, (l) => `hcp_home_${l}`, (l) => `hcp_away_${l}`);
    }
    // Total points (TT-specifique id=10184).
    else if (id === 10184) {
      const total = ctxNum(bt, 'total');
      readTotal(items, total, `match_over_${total}`, `match_under_${total}`);
    }
    // Nombre exact de sets (bestof:5). shortName "3"/"4"/"5" → total sets under/over 3.5/4.5
    else if (id === 10185) {
      for (const it of items) {
        const s = (it.shortName || '').trim();
        if (s === '3') put('total_sets_3', it);
        else if (s === '4') put('total_sets_4', it);
        else if (s === '5') put('total_sets_5', it);
      }
    }
    // 10186 (par jeu) / 10492 (score exact 6-way) : ignore, non exploitables cross-book
  }
  return odds;
}

// ═══════════════════════════════════════════════════════════════
// PARSEUR BASKET Congobet — betTypeIds identifies via probe basket-discovery
// (WNBA Los Angeles Sparks vs Golden State Valkyries 09/08/2026, 22 IDs
// distincts observes) :
//   10001  "Resultat du match" (3-way, X eleve — reglementaire seulement)
//   10007  "1MT Resultat" (h1_ 1X2)
//   10011  "1MT Nombre de points" (h1_ total)
//   10024  "2MT Resultat du match" (h2_ 1X2)
//   10105  "1MT Vainqueur remb. si egalite" (h1_ DNB)
//   10107  "1MT Ecart entre equipes" (h1_ handicap)
//   10113  "1MT Nombre de points Pair/Impair" (h1_ odd/even)
//   10121  "2MT Vainqueur remb. si egalite" (h2_ DNB)
//   10123  "2MT Ecart entre equipes" (h2_ handicap)
//   10127  "2MT Nombre de points Pair/Impair" (h2_ odd/even)
//   10170  "Vainqueur (prol. incluses)" (match_1/2 — VRAI winner basket 2-way)
//   10172  "Ecart entre equipes (prol. incluses)" (hcp)
//   10174  "Nombre de points (prol. incluses)" (match_over/under)
//   10176  "Nombre de points de {Home} (prol. incluses)" (tt_home)
//   10177  "Nombre de points de {Away} (prol. incluses)" (tt_away)
//   10182  "Nombre de points" (par quart-temps — ctx.qnr) → qN_over/under
//   10491  "Resultat du quart-temps" (par quart-temps) → qN_match_1/X/2
// IGNORE combos : 10009 (MT/FT), 10021 (Hcp Europeen 3-way), 10059 (OT y/n),
//                 10209 (marge), 10211 (result+total).
function congobetBasket(json) {
  const odds = { _ids: {} };
  const put = (key, it) => { odds[key] = Number(it.odds); odds._ids[key] = { eventBetTypeItemId: it.id, totalOdds: Number(it.odds) }; };
  const ctxNum = (bt, key) => {
    try { const c = JSON.parse(bt.betTypeContext || '{}'); if (c[key] != null) return parseFloat(String(c[key])); } catch { /* ignore */ }
    return null;
  };
  const read1x2 = (items, pfx) => {
    for (const it of items) {
      const s = (it.shortName || '').trim().toLowerCase();
      if (s === '1') put(`${pfx}match_1`, it);
      else if (s === 'x') put(`${pfx}match_X`, it);
      else if (s === '2') put(`${pfx}match_2`, it);
    }
  };
  const readWinner2 = (items, pfx = '') => {
    for (const it of items) {
      const s = (it.shortName || '').trim();
      if (s === '1') put(`${pfx}match_1`, it);
      else if (s === '2') put(`${pfx}match_2`, it);
    }
  };
  const readDnb = (items, pfx) => {
    for (const it of items) {
      const s = (it.shortName || '').trim();
      if (s === '1') put(`${pfx}dnb_1`, it);
      else if (s === '2') put(`${pfx}dnb_2`, it);
    }
  };
  const readTotal = (items, line, pfx) => {
    if (line == null || !isHalfLine(line)) return;
    for (const it of items) {
      if (/>|\+|plus|over/.test(it.shortName)) put(`${pfx}over_${line}`, it);
      else if (/<|moins|under/.test(it.shortName)) put(`${pfx}under_${line}`, it);
    }
  };
  const readOddEven = (items, pfx) => {
    for (const it of items) {
      const s = (it.shortName || '').toLowerCase();
      if (/impair|odd/.test(s)) put(`${pfx}odd`, it);
      else if (/pair|even/.test(s)) put(`${pfx}even`, it);
    }
  };
  // Hcp Ecart : shortName "1 (+6.5)" | "2 (-6.5)". Ligne dans (). Convention
  // basket meme que foot : home prend +/-, away prend l'oppose (deja stocke
  // avec son propre signe via convention Congobet).
  const readHcp = (items, pfx) => {
    for (const it of items) {
      const s = it.shortName || '';
      const mLine = s.match(/\(([+-]?\d+(?:\.\d+)?)\)/);
      if (!mLine) continue;
      const line = parseFloat(mLine[1]);
      if (!isHalfLine(line)) continue;
      if (/^1\b/.test(s.trim())) put(`${pfx}hcp_home_${line}`, it);
      else if (/^2\b/.test(s.trim())) put(`${pfx}hcp_away_${line}`, it);
    }
  };
  // Quart-temps 10491 shortName "1er quarter : 1" — extraire qnr + issue
  const readQuarterWinner = (items) => {
    for (const it of items) {
      const s = String(it.shortName || '').trim();
      const m = s.match(/^(\d+)(?:er|ème|eme)?\s+quarter?\s*:\s*(1|X|2)$/i);
      if (!m) continue;
      const qn = Number(m[1]);
      if (qn < 1 || qn > 4) continue;
      const outcome = m[2].toUpperCase();
      const key = outcome === '1' ? `q${qn}_match_1` : outcome === 'X' ? `q${qn}_match_X` : `q${qn}_match_2`;
      put(key, it);
    }
  };
  // Quart-temps 10182 shortName "1er quart temps : > 41.5" — extraire qnr + total
  const readQuarterTotal = (items) => {
    for (const it of items) {
      const s = String(it.shortName || '').trim();
      const m = s.match(/^(\d+)(?:er|ème|eme)?\s+quart\s*temps\s*:\s*([<>+-]|plus|moins)\s*(?:de\s+)?(\d+(?:\.\d+)?)$/i);
      if (!m) continue;
      const qn = Number(m[1]);
      if (qn < 1 || qn > 4) continue;
      const line = parseFloat(m[3]);
      if (!isHalfLine(line)) continue;
      const isOver = /[+>]/.test(m[2]) || /plus/i.test(m[2]);
      const key = isOver ? `q${qn}_over_${line}` : `q${qn}_under_${line}`;
      put(key, it);
    }
  };

  for (const bt of json.eventBetTypes) {
    const items = (bt.eventBetTypeItems || []).filter((it) => it.active && it.bettingAllowed && Number(it.odds) > 1);
    if (!items.length) continue;
    const rawId = Number(bt.betTypeId);
    const id = rawId >= 20000 && rawId < 30000 ? rawId - 10000 : rawId;
    const total = ctxNum(bt, 'total');
    // Reglementaire (avec X possible) — evite le fake winner : on utilise 10170
    // pour le vrai match_1/2 basket. 10001 sert seulement pour "reste des paris"
    // periode et n'est PAS mappe en match_ (conflit avec 10170).
    if (id === 10007) read1x2(items, 'h1_');
    else if (id === 10011) readTotal(items, total, 'h1_');
    else if (id === 10024) read1x2(items, 'h2_');
    else if (id === 10105) readDnb(items, 'h1_');
    else if (id === 10107) readHcp(items, 'h1_');
    else if (id === 10113) readOddEven(items, 'h1_');
    else if (id === 10121) readDnb(items, 'h2_');
    else if (id === 10123) readHcp(items, 'h2_');
    else if (id === 10127) readOddEven(items, 'h2_');
    // Incl OT — le VRAI marche cross-book pour arbitrage basket
    else if (id === 10170) readWinner2(items, '');
    else if (id === 10172) readHcp(items, '');
    else if (id === 10174) readTotal(items, total, 'match_');
    else if (id === 10176) readTotal(items, total, 'tt_home_'); // legerement abusif : tt_home_over/under_ prefixe attendu
    else if (id === 10177) readTotal(items, total, 'tt_away_');
    else if (id === 10182) readQuarterTotal(items);
    else if (id === 10491) readQuarterWinner(items);
    // Ignore combos et marches non-cross-book comparables
    else if ([10001, 10009, 10021, 10059, 10209, 10211].includes(id)) { /* skip */ }
  }
  // Fix tt_home/away : les cles sont over/under mais on veut tt_home_over/under_X
  // Correction post-lecture (readTotal ecrit sur pfx+over_L et pfx+under_L, donc
  // pour tt_home_ le pfx est "tt_home_" → cles finales "tt_home_over_L" / "tt_home_under_L"
  // C'est correct par construction. Rien a corriger.
  return odds;
}
