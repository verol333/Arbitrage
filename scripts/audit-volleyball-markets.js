// Probes ciblés :
// 1. PremierBet : chercher sportId volleyball (candidats 6-27)
// 2. YellowBet LIVE : compter matchs live foot/tennis/basket dispos
import { mget } from '../src/bookmakers/premierbet/api.js';
import yellowbet from '../src/bookmakers/yellowbet/index.js';
import { listLive as yellowListLive } from '../src/bookmakers/yellowbet/list.js';

async function probePBVolleyball() {
  console.log('\n=== PremierBet : chercher sportId volleyball ===');
  // Test tous les IDs entre 6 et 30 (1-5 déjà connus foot/basket/baseball/hockey/tennis)
  for (const sid of ['6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30']) {
    try {
      const j = await mget('/events/highlights', { sportId: sid });
      const cats = j?.data?.categories || [];
      const evs = cats.reduce((s, c) => s + (c?.competitions || []).reduce((ss, cc) => ss + (cc?.events?.length || 0), 0), 0);
      if (evs > 0) {
        const firstCat = cats[0]?.name || cats[0]?.eventNames?.en || cats[0]?.eventNames?.fr;
        const firstComp = cats[0]?.competitions?.[0]?.name || cats[0]?.competitions?.[0]?.eventNames?.en;
        const firstEvent = cats[0]?.competitions?.[0]?.events?.[0]?.eventNames?.en
                        || cats[0]?.competitions?.[0]?.events?.[0]?.eventNames?.fr;
        console.log(`  sportId=${sid} events=${evs} first="${firstCat} / ${firstComp} / ${firstEvent}"`);
      }
    } catch (e) {
      console.log(`  sportId=${sid} ERR ${e.message}`);
    }
  }
}

async function probeYellowLive() {
  console.log('\n=== YellowBet LIVE : compter matchs live par sport ===');
  for (const sport of ['football', 'tennis', 'basket', 'volleyball']) {
    try {
      const t0 = Date.now();
      const matches = await yellowListLive(sport);
      console.log(`  ${sport}: ${matches.length} matchs LIVE (${Date.now()-t0}ms)`);
      matches.slice(0, 2).forEach((m) => {
        console.log(`    · [${m.league}] ${m.home} vs ${m.away} — score=${m.live?.score} min=${m.live?.minute}`);
      });
    } catch (e) {
      console.log(`  ${sport} ERR ${e.message}`);
    }
  }
}

(async () => {
  await probePBVolleyball();
  await probeYellowLive();
  console.log('\n=== Fin ===');
  process.exit(0);
})();
