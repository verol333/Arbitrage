// Lecture cotes Congobet football (events/{id}). Port fidèle de matchCore.ts congobetOdds().
import { CONGO_API, congoJson } from './api.js';
import { isHalfLine } from '../../core/markets.js';
import { tokenOverlap } from '../../core/text.js';

export async function getOdds(matchId) {
  const json = await congoJson(`${CONGO_API}events/${matchId}`);
  if (!json?.eventBetTypes) return null;
  const home = json.homeTeamName || ''; const away = json.awayTeamName || '';
  const odds = {};
  const ctxNum = (bt, key) => {
    try { const c = JSON.parse(bt.betTypeContext || '{}'); if (c[key] != null) return parseFloat(String(c[key])); } catch { /* ignore */ }
    return null;
  };
  const read1x2 = (items, pfx) => {
    for (const it of items) {
      const s = (it.shortName || '').trim().toLowerCase();
      if (s === '1') odds[`${pfx}match_1`] = Number(it.odds);
      else if (s === 'x') odds[`${pfx}match_X`] = Number(it.odds);
      else if (s === '2') odds[`${pfx}match_2`] = Number(it.odds);
    }
  };
  const readDC = (items, pfx) => {
    for (const it of items) {
      const s = (it.shortName || '').replace(/\s/g, '').toLowerCase();
      if (s === '1x') odds[`${pfx}dc_1X`] = Number(it.odds);
      else if (s === '12') odds[`${pfx}dc_12`] = Number(it.odds);
      else if (s === 'x2') odds[`${pfx}dc_X2`] = Number(it.odds);
    }
  };
  const readTotal = (items, line, overKey, underKey) => {
    if (line == null || !isHalfLine(line)) return;
    for (const it of items) {
      if (/>|\+|plus|over/.test(it.shortName)) odds[overKey] = Number(it.odds);
      else if (/<|moins|under/.test(it.shortName)) odds[underKey] = Number(it.odds);
    }
  };
  const readIndivTotal = (bt, items, line, pfx) => {
    if (line == null || !isHalfLine(line)) return;
    const teamPart = (bt.name || '').replace(/total (de |des )?buts (de |du |des )?/i, '').trim();
    const sH = tokenOverlap(teamPart, home), sA = tokenOverlap(teamPart, away);
    const side = sH > sA ? 'home' : sA > sH ? 'away' : null;
    if (side === null) return;
    for (const it of items) {
      if (/>|\+|plus|over/.test(it.shortName)) odds[`${pfx}tt_${side}_over_${line}`] = Number(it.odds);
      else if (/<|moins|under/.test(it.shortName)) odds[`${pfx}tt_${side}_under_${line}`] = Number(it.odds);
    }
  };
  const readOddEven = (items, pfx) => {
    for (const it of items) {
      const s = (it.shortName || '').toLowerCase();
      if (/impair|odd/.test(s)) odds[`${pfx}odd`] = Number(it.odds);
      else if (/pair|even/.test(s)) odds[`${pfx}even`] = Number(it.odds);
    }
  };
  const readHcpEcart = (bt, items, homeKey, awayKey) => {
    for (const it of items) {
      const s = it.shortName || '';
      const mLine = s.match(/\(([+-]?\d+(?:\.\d+)?)\)/);
      if (!mLine) continue;
      const line = parseFloat(mLine[1]);
      if (!isHalfLine(line)) continue;
      if (/^1\b/.test(s.trim())) odds[homeKey(line)] = Number(it.odds);
      else if (/^2\b/.test(s.trim())) odds[awayKey(line)] = Number(it.odds);
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
    else if (id === 10010) { for (const it of items) { const s = (it.shortName || '').toLowerCase(); if (/oui|yes/.test(s)) odds.btts_yes = Number(it.odds); else if (/non|no/.test(s)) odds.btts_no = Number(it.odds); } }
    else if (id === 10003) readTotal(items, total, `match_over_${total}`, `match_under_${total}`);
    else if (id === 10055 || id === 10056) readIndivTotal(bt, items, total, '');
    else if (id === 10015) { for (const it of items) { const s = (it.shortName || '').trim(); if (s === '1') odds.dnb_1 = Number(it.odds); else if (s === '2') odds.dnb_2 = Number(it.odds); } }
    else if (id === 10016) readHcpEcart(bt, items, (l) => `hcp_home_${l}`, (l) => `hcp_away_${l}`);
    else if (id === 10031) readOddEven(items, '');
    else if (id === 10007) read1x2(items, 'ht_');
    else if (id === 10104) readDC(items, 'ht_');
    else if (id === 10028) { for (const it of items) { const s = (it.shortName || '').toLowerCase(); if (/oui|yes/.test(s)) odds.ht_btts_yes = Number(it.odds); else if (/non|no/.test(s)) odds.ht_btts_no = Number(it.odds); } }
    else if (id === 10011) readTotal(items, total, `ht_over_${total}`, `ht_under_${total}`);
    else if (id === 10108 || id === 10109) readIndivTotal(bt, items, total, 'ht_');
    else if (id === 10107) readHcpEcart(bt, items, (l) => `ht_hcp_home_${l}`, (l) => `ht_hcp_away_${l}`);
    else if (id === 10113) readOddEven(items, 'ht_');
    else if (id === 10024) read1x2(items, 'h2_');
    else if (id === 10120) readDC(items, 'h2_');
    else if (id === 10029) { for (const it of items) { const s = (it.shortName || '').toLowerCase(); if (/oui|yes/.test(s)) odds.h2_btts_yes = Number(it.odds); else if (/non|no/.test(s)) odds.h2_btts_no = Number(it.odds); } }
    else if (id === 10030) readTotal(items, total, `h2_over_${total}`, `h2_under_${total}`);
    else if (id === 10124 || id === 10125) readIndivTotal(bt, items, total, 'h2_');
    else if (id === 10123) readHcpEcart(bt, items, (l) => `h2_hcp_home_${l}`, (l) => `h2_hcp_away_${l}`);
    else if (id === 10127) readOddEven(items, 'h2_');
    else if (id === 10147) { const t = ctxNum(bt, 'total'); readTotal(items, t, `cor_over_${t}`, `cor_under_${t}`); }
    else if (id === 10504) { const t = ctxNum(bt, 'total'); readTotal(items, t, `cor_ht_over_${t}`, `cor_ht_under_${t}`); }
    else if (id === 10153) readOddEven(items, 'cor_');
    else if (id === 10146) readHcpEcart(bt, items, (l) => `cor_hcp_home_${l}`, (l) => `cor_hcp_away_${l}`);
    // DNB by half.
    else if (id === 10106) { for (const it of items) { const s = (it.shortName || '').trim(); if (s === '1') odds.ht_dnb_1 = Number(it.odds); else if (s === '2') odds.ht_dnb_2 = Number(it.odds); } }
    else if (id === 10119) { for (const it of items) { const s = (it.shortName || '').trim(); if (s === '1') odds.h2_dnb_1 = Number(it.odds); else if (s === '2') odds.h2_dnb_2 = Number(it.odds); } }
    // Half with most goals — audit prouve id=10022 (pas 10036).
    // shortName: "1ère" | "2ème" | "X"
    else if (id === 10022) {
      for (const it of items) {
        const s = (it.shortName || '').toLowerCase();
        if (/1(st|ère|ere)?\s*(mi|half)?/i.test(s) || s === '1') odds.half_most_ht = Number(it.odds);
        else if (/2(nd|ème|eme)?\s*(mi|half)?/i.test(s) || s === '2') odds.half_most_h2 = Number(it.odds);
        else if (/egal|equal|draw|x/i.test(s)) odds.half_most_equal = Number(it.odds);
      }
    }
    // Combos explicitement ignorés (l'audit prouve que ces IDs sont des combos
    // multi-marchés non comparables) :
    // - 10009 : Résultat Mi-temps / Fin de match (9-way)
    // - 10021 : Handicap Européen (3-way, cs=8 sportcash équivalent)
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
  }
  return odds;
}
