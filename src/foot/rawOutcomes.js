// Lecture BRUTE des marches football pour les 4 books de travail :
// 1xbet, betpawa, 1win, congobet. On aplatit tout en { market, selection, odds }.
//
// Regle de fer : aucun libelle invente. Chaque book est lu par son propre
// endpoint natif et, quand le book ne nomme pas ses marches (cas de 1xbet),
// on n'utilise que les identifiants deja valides en production.
import { congoJson, CONGO_API } from '../bookmakers/congobet/api.js';
import { BASE as BP_BASE, HDR_EVENT as BP_HDR } from '../bookmakers/betpawa/api.js';
import { fetchOddsWS } from '../bookmakers/onewin/ws.js';
import { viaWorker, FEED, COUNTRY } from '../bookmakers/xbet/api.js';
import { xbetMarketName, xbetSelectionName } from './xbetGroups.js';

export const RAW_BOOKS = ['1xbet', 'congobet', 'betpawa', '1win'];

const odd = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 1 && n < 1000 ? n : null; };

// ---- 1xbet : GetGameZip, groupes/issues numeriques uniquement ----
async function raw_xbet(matchId) {
  const url = FEED + '/service-api/LineFeed/GetGameZip?id=' + matchId +
    '&lng=fr&isSubGames=true&GroupEvents=true&countevents=250&partner=192&grMode=4&marketType=1&country=' + COUNTRY;
  const json = await viaWorker(url);
  const out = [];
  for (const g of json?.Value?.GE || []) {
    const market = xbetMarketName(g.G);
    for (const sub of g.E || []) {
      for (const it of Array.isArray(sub) ? sub : [sub]) {
        const c = odd(it.C);
        if (!c) continue;
        out.push({ market, selection: xbetSelectionName(g.G, it.T, it.P ?? null), odds: c, line: it.P ?? null });
      }
    }
  }
  return out;
}

// ---- betpawa : GET /events/{id}, markets[].row[].prices[] ----
// Verifie le 2026-08-27 : marketType.id + marketType.name (ex '3743' / '1X2 - FT'),
// price.name + price.odds. On leve une erreur explicite si la reponse n'est pas
// l'evenement JSON attendu (le site renvoie du HTML quand l'id n'existe pas).
async function raw_betpawa(matchId) {
  const res = await fetch(BP_BASE + '/api/sportsbook/v4/events/' + matchId, { headers: BP_HDR, signal: AbortSignal.timeout(20000) });
  const txt = await res.text();
  if (!res.ok) throw new Error('betpawa HTTP ' + res.status);
  let j;
  try { j = JSON.parse(txt); } catch { throw new Error('betpawa reponse non JSON (' + txt.slice(0, 40) + ')'); }
  if (!Array.isArray(j.markets)) throw new Error('betpawa sans markets');
  const out = [];
  for (const m of j.markets) {
    const market = m.marketType?.name || ('betpawa-market-' + (m.marketType?.id ?? '?'));
    for (const row of m.row || []) {
      const spec = row.specifier || {};
      const line = spec.total ?? spec.hcp ?? null;
      for (const p of row.prices || []) {
        const c = odd(p.odds);
        if (!c) continue;
        const sel = String(p.name || p.displayName || '?') + (line != null ? ' ' + line : '');
        out.push({ market: String(market), selection: sel, odds: c, line });
      }
    }
  }
  return out;
}

// ---- 1win : cotes via WebSocket, groupes deja nommes par le book ----
async function raw_1win(matchId) {
  const map = await fetchOddsWS([matchId]);
  const groups = map.get(matchId) || map.get(String(matchId)) || map.get(Number(matchId));
  if (!groups) throw new Error('1win aucun groupe recu');
  const out = [];
  for (const [marketName, list] of Object.entries(groups)) {
    for (const o of Array.isArray(list) ? list : []) {
      const c = odd(o.cf);
      if (!c) continue;
      out.push({ market: String(marketName), selection: String(o.name ?? o.outcome ?? o.id ?? '?'), odds: c, line: o.param ?? null });
    }
  }
  return out;
}

// ---- congobet : eventBetTypes[].eventBetTypeItems[] ----
async function raw_congobet(matchId) {
  const j = await congoJson(CONGO_API + 'events/' + matchId);
  const out = [];
  for (const bt of j?.eventBetTypes || []) {
    for (const it of bt.eventBetTypeItems || []) {
      const c = odd(it.odds);
      if (!c) continue;
      out.push({ market: String(bt.name || 'congobet-bettype-' + (bt.id ?? '?')), selection: String(it.shortName || it.name || '?'), odds: c, line: null });
    }
  }
  return out;
}

const READERS = { '1xbet': raw_xbet, betpawa: raw_betpawa, '1win': raw_1win, congobet: raw_congobet };

// Retourne { outcomes, error } — jamais de throw, pour ne pas casser un scan.
export async function rawOutcomes(bookKey, matchId) {
  const fn = READERS[bookKey];
  if (!fn) return { outcomes: [], error: 'book non gere : ' + bookKey };
  try {
    return { outcomes: (await fn(matchId)) || [], error: null };
  } catch (e) {
    return { outcomes: [], error: e.message };
  }
}
