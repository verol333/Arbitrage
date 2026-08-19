// Extraction BRUTE des marchés d'un match, book par book : on lit la réponse
// native (avant tout parsing métier) et on en sort la liste complète
// { market_name, selections:[{ name, odds }] } — y compris les marchés que le
// moteur n'exploite pas encore. Objectif : cartographier ce qui existe.

import { bpFetchEvent } from '../bookmakers/betpawa/api.js';
import { sbFetchEvent } from '../bookmakers/sportybet/api.js';
import { fetchMatchOdds as betmomoOdds } from '../bookmakers/betmomo/api.js';
import { fetchMatchBts } from '../bookmakers/yellowbet/api.js';
import { congoJson, CONGO_API } from '../bookmakers/congobet/api.js';
import { fetchOffers as apolloOffers } from '../bookmakers/apollo/list.js';
import { fetchOddsWS as winOddsWS } from '../bookmakers/onewin/ws.js';

const numOdd = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 1.001 && n < 1000 ? n : null;
};

// ── Extracteur générique ──────────────────────────────────────────────
// Parcourt récursivement n'importe quel payload et repère les "marchés" :
// un objet portant un libellé et une collection de sélections cotées.
const NAME_KEYS = ['name', 'marketName', 'market_name', 'desc', 'title', 'label', 'groupName', 'group_name', 'n', 'mn', 'caption', 'typeName'];
const SEL_NAME_KEYS = [...NAME_KEYS, 'outcomeName', 'selectionName', 'sn', 'shortName'];
const ODD_KEYS = ['odds', 'odd', 'price', 'coefficient', 'coef', 'value', 'v', 'c', 'rate', 'k', 'oc'];

const pick = (o, keys) => {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && keys === NAME_KEYS) return String(v);
  }
  return '';
};

function asSelection(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  let odd = null;
  for (const k of ODD_KEYS) { const n = numOdd(o[k]); if (n) { odd = n; break; } }
  if (!odd) return null;
  const name = pick(o, SEL_NAME_KEYS);
  const param = o.base ?? o.param ?? o.handicap ?? o.line ?? o.specifier ?? o.P ?? null;
  return { name: name || (param != null ? String(param) : ''), odds: odd, param };
}

function collectSelections(node) {
  const out = [];
  const walk = (n, depth) => {
    if (!n || typeof n !== 'object' || depth > 3) return;
    const values = Array.isArray(n) ? n : Object.values(n);
    for (const v of values) {
      const s = asSelection(v);
      if (s) out.push(s);
      else if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };
  walk(node, 0);
  return out;
}

export function extractMarkets(payload, { maxDepth = 8 } = {}) {
  const markets = [];
  const seen = new Set();
  const walk = (node, depth, inheritedName) => {
    if (!node || typeof node !== 'object' || depth > maxDepth) return;
    if (seen.has(node)) return;
    seen.add(node);
    if (!Array.isArray(node)) {
      const name = pick(node, NAME_KEYS) || inheritedName || '';
      const sels = collectSelections(node);
      if (name && sels.length >= 2) {
        markets.push({ market_name: name, selections: sels });
      }
    }
    for (const v of Array.isArray(node) ? node : Object.values(node)) {
      if (v && typeof v === 'object') {
        walk(v, depth + 1, Array.isArray(node) ? inheritedName : (pick(node, NAME_KEYS) || inheritedName));
      }
    }
  };
  walk(payload, 0, '');
  // Dédoublonnage : un même marché peut être vu à deux profondeurs.
  const byKey = new Map();
  for (const m of markets) {
    const key = \`\${m.market_name}::\${m.selections.map((s) => s.name + s.odds).sort().join('|')}\`;
    if (!byKey.has(key)) byKey.set(key, m);
  }
  return [...byKey.values()];
}

// ── Accès brut par bookmaker ──────────────────────────────────────────
const DUMPERS = {
  betpawa: (m) => bpFetchEvent(m.id, 20000, { fresh: true }),
  sportybet: (m, { live }) => sbFetchEvent(m.id, { live }),
  betmomo: (m) => betmomoOdds(m.id),
  yellowbet: (m) => fetchMatchBts(m.id),
  congobet: (m) => congoJson(\`\${CONGO_API}events/\${m.id}\`, { noCache: true }),
  apollo: async (m) => { const map = await apolloOffers([m.id]); return map.get(m.id) || []; },
  '1win': async (m) => { const map = await winOddsWS([m.id]); return map.get(m.id) || map.get(String(m.id)) || []; },
};

export const DUMPABLE_BOOKS = Object.keys(DUMPERS);

export async function dumpRawMarkets(bookKey, match, { live = false } = {}) {
  const fn = DUMPERS[bookKey];
  if (!fn) return { ok: false, reason: 'no_raw_dumper', markets: [] };
  try {
    const raw = await fn(match, { live });
    if (!raw) return { ok: false, reason: 'empty_payload', markets: [] };
    const markets = extractMarkets(raw);
    return { ok: true, markets, raw_size: JSON.stringify(raw).length };
  } catch (e) {
    return { ok: false, reason: String(e && e.message || e).slice(0, 120), markets: [] };
  }
}
