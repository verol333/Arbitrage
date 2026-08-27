// Lecture BRUTE des marches football, book par book : on interroge l'endpoint
// natif de l'evenement et on aplatit tout en outcomes { market, selection, odds }.
// Aucun filtre metier : on veut voir absolument tout ce que le book propose,
// y compris les marches que le moteur d'arbitrage n'exploite pas encore.
import { bpFetchEvent } from '../bookmakers/betpawa/api.js';
import { fetchMatchBts as ybFetchBts } from '../bookmakers/yellowbet/api.js';
import { sbFetchEvent } from '../bookmakers/sportybet/api.js';
import { apolloGet } from '../bookmakers/apollo/api.js';
import { congoJson, CONGO_API } from '../bookmakers/congobet/api.js';
import { fetchJson } from '../net/fetcher.js';

export const RAW_BOOKS = ['1xbet', 'congobet', 'betpawa', 'yellowbet', 'sportybet', 'apollo'];

const odd = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 1 && n < 1000 ? n : null; };

function extract_xbet(raw) {
  const out = [];
  for (const g of raw?.Value?.GE || []) {
    const marketName = g.N || ('bet-type-' + (g.G || g.T || '?'));
    for (const sub of g.E || []) {
      for (const it of Array.isArray(sub) ? sub : [sub]) {
        const c = odd(it.C);
        if (!c) continue;
        const sel = it.N || ('T' + it.T + (it.P != null ? '_P' + it.P : ''));
        out.push({ market: String(marketName), selection: String(sel), odds: c, line: it.P ?? null });
      }
    }
  }
  return out;
}

function extract_congobet(raw) {
  const out = [];
  for (const bt of raw?.eventBetTypes || []) {
    for (const it of bt.eventBetTypeItems || []) {
      const c = odd(it.odds);
      if (!c) continue;
      out.push({ market: String(bt.name || '?'), selection: String(it.shortName || it.name || '?'), odds: c, line: null });
    }
  }
  return out;
}

function extract_sportybet(raw) {
  const out = [];
  for (const m of raw?.data?.markets || raw?.markets || []) {
    const spec = m.specifier ? ' [' + m.specifier + ']' : '';
    for (const o of m.outcomes || []) {
      const c = odd(o.odds);
      if (!c) continue;
      out.push({ market: String(m.name || ('market-' + m.id)), selection: String(o.desc || o.name || '?') + spec, odds: c, line: m.specifier ?? null });
    }
  }
  return out;
}

function extract_apollo(raw) {
  const out = [];
  for (const o of raw?.Offers || []) {
    const sbv = o.Sbv ? ' [' + o.Sbv + ']' : '';
    for (const od of o.Odds || []) {
      const c = odd(od.Odd);
      if (!c) continue;
      out.push({ market: String(o.Description || ('bettype-' + o.BetTypeKey)), selection: String(od.Name || od.Type || '?') + sbv, odds: c, line: o.Sbv ?? null });
    }
  }
  return out;
}

function extract_yellowbet(raw) {
  const out = [];
  const bts = Array.isArray(raw) ? raw : (raw?.data?.bts || raw?.bts || []);
  for (const bt of bts) {
    for (const o of bt.odds || bt.o || []) {
      const c = odd(o.p);
      if (!c) continue;
      const line = o.l != null ? ' [' + o.l + ']' : '';
      out.push({ market: String(bt.n || ('bet-' + (bt.id || '?'))), selection: String(o.n || o.id || '?') + line, odds: c, line: o.l ?? null });
    }
  }
  return out;
}

function extract_betpawa(raw) {
  const out = [];
  for (const m of raw?.markets || []) {
    const marketName = m.marketType?.name || m.name || ('market-' + m.id);
    for (const row of Array.isArray(m.row) ? m.row : []) {
      const suffix = row.name && row.name !== marketName ? ' - ' + row.name : '';
      for (const p of row.prices || []) {
        const c = odd(p.price);
        if (!c) continue;
        out.push({ market: String(marketName) + suffix, selection: String(p.name || p.selectionName || '?'), odds: c, line: row.name ?? null });
      }
    }
  }
  return out;
}

const EXTRACTORS = {
  '1xbet': extract_xbet,
  congobet: extract_congobet,
  sportybet: extract_sportybet,
  apollo: extract_apollo,
  yellowbet: extract_yellowbet,
  betpawa: extract_betpawa,
};

const XBET_URL = 'https://1xbet.cg/service-api/LineFeed/GetGameZip?lng=fr&isSubGames=true&GroupEvents=true&countevents=250&partner=192&grMode=4&topGroups=&marketType=1&country=93&id=';

async function fetchRaw(bookKey, matchId) {
  if (bookKey === 'betpawa') return bpFetchEvent(matchId, 15000, { fresh: false });
  if (bookKey === 'yellowbet') return ybFetchBts(matchId);
  if (bookKey === 'sportybet') return sbFetchEvent(matchId, { live: false });
  if (bookKey === 'apollo') return apolloGet('/sport/offer/v3/match/offers?MatchId=' + matchId);
  if (bookKey === 'congobet') return congoJson(CONGO_API + 'events/' + matchId);
  if (bookKey === '1xbet') return fetchJson(XBET_URL + matchId, { timeoutMs: 20000, headers: { accept: 'application/json' } });
  throw new Error('book non gere : ' + bookKey);
}

// Retourne { outcomes, error } — jamais de throw, pour ne pas casser un scan.
export async function rawOutcomes(bookKey, matchId) {
  try {
    const raw = await fetchRaw(bookKey, matchId);
    const fn = EXTRACTORS[bookKey];
    if (!fn) return { outcomes: [], error: 'pas d extracteur' };
    return { outcomes: fn(raw) || [], error: null };
  } catch (e) {
    return { outcomes: [], error: e.message };
  }
}
