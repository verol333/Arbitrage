// Lecture cotes Congobet football (events/{id}). Port fidèle de matchCore.ts congobetOdds().
import { CONGO_API, congoJson } from './api.js';
import { isHalfLine } from '../../core/markets.js';
import { tokenOverlap } from '../../core/text.js';

export async function getOdds(matchId, { live = false, noCache = false, sport = 'football' } = {}) {
  const json = await congoJson(`${CONGO_API}events/${matchId}`, { noCache: live || noCache });
  if (!json?.eventBetTypes) return null;
  // Basket : betTypeIds Congobet basket non probes en prod. Sans mapping valide,
  // retourner odds vides plutot que mismapper des IDs foot/tennis sur du basket
  // (produirait des fake arbs). A activer apres probe basket depuis GH Actions.
  if (sport === 'basket') return { _ids: {} };
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
  }
  return odds;
}
