// Sonde vague 1 : libelles natifs + identifiants de coupon des familles ciblees
// (clean sheet, pair/impair par equipe, total corners par equipe).
import betpawa from '../src/bookmakers/betpawa/index.js';
import sportybet from '../src/bookmakers/sportybet/index.js';
import betmomo from '../src/bookmakers/betmomo/index.js';
import congobet from '../src/bookmakers/congobet/index.js';
import apollo from '../src/bookmakers/apollo/index.js';
import onewin from '../src/bookmakers/onewin/index.js';
import { bpFetchEvent } from '../src/bookmakers/betpawa/api.js';
import { sbFetchEvent } from '../src/bookmakers/sportybet/api.js';
import { fetchMatchOdds as betmomoOdds } from '../src/bookmakers/betmomo/api.js';
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { fetchOffers as apolloOffers } from '../src/bookmakers/apollo/list.js';
import { fetchOddsWS as winOddsWS } from '../src/bookmakers/onewin/ws.js';

const TARGET = /clean sheet|odd\/even|odd or even|pair|impair|corner/i;
const NAME_KEYS = ['name','Name','Description','marketName','market_name','desc','title','label','groupName','caption','typeName'];

function hits(payload, limit = 6) {
  const out = []; const seen = new Set();
  const walk = (n, d) => {
    if (!n || typeof n !== 'object' || d > 8 || out.length >= limit || seen.has(n)) return;
    seen.add(n);
    if (!Array.isArray(n)) {
      for (const k of NAME_KEYS) {
        const v = n[k];
        if (typeof v === 'string' && TARGET.test(v)) { out.push(JSON.stringify(n).slice(0, 900)); break; }
      }
    }
    for (const v of Array.isArray(n) ? n : Object.values(n)) if (v && typeof v === 'object') walk(v, d + 1);
  };
  walk(payload, 0);
  return out;
}

const RAW = {
  betpawa: (m) => bpFetchEvent(m.id, { fresh: true }),
  sportybet: (m) => sbFetchEvent(m.id, { live: false }),
  betmomo: (m) => betmomoOdds(m.id),
  congobet: (m) => congoJson(`${CONGO_API}events/${m.id}`, { noCache: true }),
  apollo: async (m) => { const map = await apolloOffers([m.id]); return map.get(m.id) || map.get(String(m.id)) || []; },
  '1win': async (m) => { const g = await winOddsWS([Number(m.id)]); return g.get(Number(m.id)) || g.get(String(m.id)) || {}; },
};

const main = async () => {
  for (const book of [betpawa, sportybet, betmomo, congobet, apollo, onewin]) {
    let list = [];
    try { list = await book.listMatches({ live: false, sport: 'football' }) || []; } catch (e) { console.log(`[${book.key}] list KO ${e.message}`); continue; }
    console.log(`\n########## ${book.key} ##########`);
    for (const m of list.slice(0, 2)) {
      let raw;
      try { raw = await RAW[book.key](m); } catch (e) { console.log(`  ${m.id} KO ${e.message}`); continue; }
      const found = hits(raw);
      console.log(`  match ${m.id} ${m.home}-${m.away} : ${found.length} marches cibles`);
      for (const f of found) console.log('    ' + f);
      if (found.length) break;
    }
  }
};
main().catch((e) => { console.error(e); process.exit(1); });
