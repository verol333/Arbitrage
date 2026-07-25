// Probe : diagnostiquer pourquoi Apollo/Congobet/Sportcash renvoient 0 cotes
// sur les matchs LIVE. On liste 1 match live puis on inspecte le retour brut
// de getOdds pour chacun.
import apollo from '../src/bookmakers/apollo/index.js';
import congobet from '../src/bookmakers/congobet/index.js';
import sportcash from '../src/bookmakers/sportcash/index.js';
import { fetchOffers } from '../src/bookmakers/apollo/list.js';
import { congoJson } from '../src/bookmakers/congobet/api.js';
import { xget } from '../src/bookmakers/sportcash/api.js';

const out = {};

// ── Apollo LIVE
try {
  const matches = await apollo.listMatches({ live: true, sport: 'football' });
  out.apollo = { catalog_size: matches.length };
  if (matches.length) {
    const m = matches[0];
    out.apollo.sample_match = `${m.home} vs ${m.away} (id=${m.id})`;
    // Raw endpoint call
    const map = await fetchOffers([m.id]);
    const offers = map.get(m.id) || [];
    out.apollo.raw = {
      offer_count: offers.length,
      bet_type_keys: [...new Set(offers.slice(0, 20).map((o) => o.BetTypeKey))],
      first_offer_sample: offers[0] ? {
        BetTypeKey: offers[0].BetTypeKey,
        BetTypeName: offers[0].BetTypeName,
        Odds_count: (offers[0].Odds || []).length,
        first_odd: (offers[0].Odds || [])[0] || null,
      } : null,
    };
    // Test aussi le parser
    const odds = await apollo.getOdds(m);
    out.apollo.parsed_keys_count = Object.keys(odds).length;
    out.apollo.parsed_sample = Object.entries(odds).slice(0, 5);
  }
} catch (e) { out.apollo = { error: e.message }; }

// ── Congobet LIVE
try {
  const matches = await congobet.listMatches({ live: true, sport: 'football' });
  out.congobet = { catalog_size: matches.length };
  if (matches.length) {
    const m = matches[0];
    out.congobet.sample_match = `${m.home} vs ${m.away} (id=${m.id})`;
    // Raw endpoint
    const raw = await congoJson(`https://hg-event-api-prod.sporty-tech.net/api/events/${m.id}`);
    out.congobet.raw = {
      has_data: !!raw,
      keys: raw ? Object.keys(raw).slice(0, 15) : null,
      eventBetTypes_count: (raw?.eventBetTypes || []).length,
      first_bettype: (raw?.eventBetTypes || [])[0] ? {
        betTypeId: raw.eventBetTypes[0].betTypeId,
        name: raw.eventBetTypes[0].name,
        items_count: (raw.eventBetTypes[0].eventBetTypeItems || []).length,
      } : null,
    };
    // Essayons d'autres endpoints live
    const liveDetail = await congoJson(`https://hg-event-api-prod.sporty-tech.net/api/events/live/${m.id}`);
    out.congobet.live_endpoint = {
      has_data: !!liveDetail,
      keys: liveDetail ? Object.keys(liveDetail).slice(0, 15) : null,
      eventBetTypes_count: (liveDetail?.eventBetTypes || []).length,
    };
    const odds = await congobet.getOdds(m);
    out.congobet.parsed_keys_count = odds ? Object.keys(odds).length : 0;
  }
} catch (e) { out.congobet = { error: e.message }; }

// ── Sportcash LIVE
try {
  const matches = await sportcash.listMatches({ live: true, sport: 'football' });
  out.sportcash = { catalog_size: matches.length };
  if (matches.length) {
    const m = matches[0];
    out.sportcash.sample_match = `${m.home} vs ${m.away} (id=${m.id})`;
    // The match already has __raw.markets from list, check
    out.sportcash.list_markets_count = (m.__raw?.markets || []).length;
    // Test with isLive:false variant
    const parts = String(m.id).split('_');
    if (parts.length === 2) {
      const [p, a] = parts;
      const detailFalse = await xget('getEvento', { pal: p, avv: a, idAggregata: '-1', isLive: 'false' }, 10_000);
      const detailTrue = await xget('getEvento', { pal: p, avv: a, idAggregata: '-1', isLive: 'true' }, 10_000);
      out.sportcash.raw = {
        isLive_false: { markets_count: (detailFalse?.scs || []).length, keys: detailFalse ? Object.keys(detailFalse).slice(0, 10) : null },
        isLive_true: { markets_count: (detailTrue?.scs || []).length, keys: detailTrue ? Object.keys(detailTrue).slice(0, 10) : null },
      };
    }
  }
} catch (e) { out.sportcash = { error: e.message }; }

console.log('=== LIVE ODDS DIAG ===');
console.log(JSON.stringify(out, null, 2));
console.log('=== END ===');
process.exit(0);
