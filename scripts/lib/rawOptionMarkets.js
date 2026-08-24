// ═══════════════════════════════════════════════════════════════════
// Récupération BRUTE des marchés d'un match, book par book.
//
// Objectif : voir les marchés "à options" que nos parseurs canoniques
// jettent (Moment du 2e but, Gagner au moins une mi-temps, But dans
// l'intervalle, Résultat + Total…). Ce sont eux qui vont créer de
// nouvelles opportunités : les scores exacts ne donnent rien.
//
// Module partagé par les scripts dump-option-markets.js (étape 1) et
// option-market-cartography.js (étape 2).
// ═══════════════════════════════════════════════════════════════════
import { bpFetchEvent } from '../../src/bookmakers/betpawa/api.js';
import { congoJson, CONGO_API } from '../../src/bookmakers/congobet/api.js';
import { fetchJson } from '../../src/net/fetcher.js';
import { fetchOddsWS } from '../../src/bookmakers/onewin/ws.js';

export const OPTION_BOOKS = ['1xbet', 'congobet', 'betpawa', '1win'];

// ─── Extracteurs : { market, selection, odds, line } ───────────────────────
function xbet(raw) {
  const out = [];
  const root = raw?.Value;
  if (!root) return out;
  const groups = [{ N: 'Principaux', E: root.E }, ...(root.GE || [])];
  for (const g of groups) {
    const marketName = g.N || `bet-type-${g.G ?? g.T ?? '?'}`;
    for (const sub of g.E || []) {
      for (const it of Array.isArray(sub) ? sub : [sub]) {
        const cote = parseFloat(it?.C);
        if (!isFinite(cote) || cote <= 1) continue;
        out.push({
          market: String(marketName),
          selection: String(it.N || `T${it.T}${it.P != null ? `_P${it.P}` : ''}`),
          odds: cote,
          line: it.P ?? null,
          ids: { T: it.T ?? null, P: it.P ?? null, G: g.G ?? null },
        });
      }
    }
  }
  return out;
}

function congobet(raw) {
  const out = [];
  for (const bt of raw?.eventBetTypes || []) {
    for (const it of bt.eventBetTypeItems || []) {
      const cote = parseFloat(it.odds);
      if (!isFinite(cote) || cote <= 1) continue;
      out.push({
        market: String(bt.name || '?'),
        selection: String(it.shortName || it.name || '?'),
        odds: cote,
        line: it.context?.total ?? null,
        ids: { bet_type_id: bt.betTypeId ?? null, item_id: it.id ?? null },
      });
    }
  }
  return out;
}

function betpawa(raw) {
  const out = [];
  for (const m of raw?.markets || []) {
    const marketName = m.marketType?.name || m.name || `market-${m.id}`;
    for (const row of Array.isArray(m.row) ? m.row : []) {
      const suffix = row.name && row.name !== marketName ? ` — ${row.name}` : '';
      for (const p of row.prices || []) {
        const cote = parseFloat(p.price);
        if (!isFinite(cote) || cote <= 1) continue;
        out.push({
          market: String(marketName) + suffix,
          selection: String(p.name || p.selectionName || '?'),
          odds: cote,
          line: m.handicap ?? null,
          ids: { market_id: m.id ?? null, price_id: p.id ?? null },
        });
      }
    }
  }
  return out;
}

function onewin(groups) {
  const out = [];
  for (const [marketName, list] of Object.entries(groups || {})) {
    for (const o of Array.isArray(list) ? list : []) {
      const cote = parseFloat(o?.cf);
      if (!isFinite(cote) || cote <= 1) continue;
      out.push({
        market: String(marketName),
        selection: String(o.name ?? o.outcome ?? '?'),
        odds: cote,
        line: o.param ?? null,
        ids: { oddId: o.id != null ? String(o.id) : null },
      });
    }
  }
  return out;
}

const EXTRACTORS = { '1xbet': xbet, congobet, betpawa, '1win': onewin };

/** Tous les marchés bruts d'un match chez un book (jamais d'exception). */
export async function rawMarkets(bookKey, matchId) {
  try {
    let raw = null;
    if (bookKey === 'betpawa') {
      raw = await bpFetchEvent(matchId, 20000, { fresh: false });
    } else if (bookKey === 'congobet') {
      raw = await congoJson(`${CONGO_API}events/${matchId}`);
    } else if (bookKey === '1xbet') {
      raw = await fetchJson(
        `https://1xbet.cg/service-api/LineFeed/GetGameZip?id=${matchId}&lng=fr&isSubGames=true&GroupEvents=true&countevents=3000&partner=192&grMode=4&marketType=1&country=93`,
        { timeoutMs: 25000, headers: { accept: 'application/json' } },
      );
    } else if (bookKey === '1win') {
      const map = await fetchOddsWS([matchId]);
      raw = map.get(matchId) || map.get(String(matchId)) || map.get(Number(matchId)) || null;
    } else {
      return { ok: false, error: 'book non géré', rows: [] };
    }
    if (!raw) return { ok: false, error: 'aucune donnée renvoyée', rows: [] };
    return { ok: true, rows: EXTRACTORS[bookKey](raw) };
  } catch (e) {
    return { ok: false, error: e.message, rows: [] };
  }
}
