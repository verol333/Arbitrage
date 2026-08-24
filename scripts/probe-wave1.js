// Sonde vague 1 ter : identifiants natifs des marches cibles.
// SportyBet -> market id + specifier + outcomes ; Apollo -> BetTypeKey + Sbv + types.
import sportybet from '../src/bookmakers/sportybet/index.js';
import apollo from '../src/bookmakers/apollo/index.js';
import { sbFetchEvent } from '../src/bookmakers/sportybet/api.js';
import { fetchOffers as apolloOffers } from '../src/bookmakers/apollo/list.js';
import { teamSim } from '../src/core/text.js';

const T = /clean sheet|odd\/even|team total corners|total corners/i;

const main = async () => {
  const sbList = await sportybet.listMatches({ live: false, sport: 'football' });
  const apList = await apollo.listMatches({ live: false, sport: 'football' });
  let pair = null;
  for (const m of sbList.slice(0, 60)) {
    const a = apList.find((x) => teamSim(x.home, m.home) > 0.72 && teamSim(x.away, m.away) > 0.72);
    if (a) { pair = { sb: m, ap: a }; break; }
  }
  if (!pair) { console.log('pas de match commun sportybet/apollo'); return; }
  console.log(`MATCH : ${pair.sb.home} - ${pair.sb.away}  (sb=${pair.sb.id} apollo=${pair.ap.id})\n`);

  const ev = await sbFetchEvent(pair.sb.id, { live: false });
  const mks = (ev && (ev.markets || (ev.data && ev.data.markets))) || [];
  console.log('=== SPORTYBET ===');
  for (const m of mks) {
    const label = String(m.desc || m.name || '');
    if (!T.test(label)) continue;
    console.log(`  id=${m.id} spec="${m.specifier || ''}" desc="${label}" outcomes=${(m.outcomes || []).map((o) => `${o.id}:${o.desc}@${o.odds}`).join(' | ')}`);
  }

  const map = await apolloOffers([pair.ap.id]);
  const offers = map.get(pair.ap.id) || map.get(String(pair.ap.id)) || [];
  console.log('\n=== APOLLO ===');
  for (const o of offers) {
    const label = String(o.Description || o.Name || '');
    if (!T.test(label)) continue;
    console.log(`  BetTypeKey=${o.BetTypeKey} Sbv="${o.Sbv ?? ''}" desc="${label}" odds=${(o.Odds || []).map((x) => `${x.Type}/${x.Name}@${x.Odd}#${x.Id}`).join(' | ')}`);
  }
};
main().catch((e) => { console.error(e); process.exit(1); });
