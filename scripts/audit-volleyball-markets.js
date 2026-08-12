// Probe PremierBet + BetPawa volleyball : chercher un sportId qui matche.
import { mget } from '../src/bookmakers/premierbet/api.js';

async function probePB() {
  console.log('\n=== PremierBet : list all sports ===');
  // Endpoint principal expose la liste des sports actifs
  const r = await mget('/config/sports', {});
  const data = r?.data;
  if (Array.isArray(data)) {
    console.log(`Total sports: ${data.length}`);
    for (const s of data) {
      const name = s?.name || s?.eventNames?.en || s?.sportName || s?.title;
      const id = s?.id || s?.sportId;
      const events = s?.eventCount ?? s?.count ?? '?';
      console.log(`  sportId=${id} name="${name}" events=${events}`);
    }
  } else {
    console.log('data keys:', Object.keys(data || {}));
    console.log('preview:', JSON.stringify(data).slice(0, 500));
  }

  // Test IDs candidats pour volleyball
  console.log('\n=== PremierBet : test candidate sportIds for volleyball ===');
  for (const sid of ['6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27']) {
    const j = await mget('/events/highlights', { sportId: sid });
    const cats = j?.data?.categories || [];
    const evs = cats.reduce((s, c) => s + (c?.competitions || []).reduce((ss, cc) => ss + (cc?.events?.length || 0), 0), 0);
    if (evs > 0) {
      const firstCat = cats[0]?.name || cats[0]?.eventNames?.en;
      const firstComp = cats[0]?.competitions?.[0]?.name || cats[0]?.competitions?.[0]?.eventNames?.en;
      const firstEvent = cats[0]?.competitions?.[0]?.events?.[0]?.eventNames?.en;
      console.log(`  sportId=${sid} events=${evs} first="${firstCat} / ${firstComp} / ${firstEvent}"`);
    }
  }
}

async function probeBP() {
  console.log('\n=== BetPawa : list all sports ===');
  const url = 'https://www.betpawa.cg/api/sportsbook/v3/categories/list/mobile-menu';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'x-pawa-brand': 'betpawa-congo-brazzaville',
        'x-pawa-language': 'fr',
      },
      signal: AbortSignal.timeout(15_000),
    });
    console.log('BP status:', res.status);
    if (res.ok) {
      const j = await res.json();
      const cats = j?.categories || j?.data || j;
      if (Array.isArray(cats)) {
        for (const c of cats) {
          const name = c?.name || c?.label || c?.title;
          const id = c?.id || c?.sportId || c?.eventTypeId;
          console.log(`  sportId=${id} name="${name}"`);
        }
      } else {
        console.log('preview:', JSON.stringify(j).slice(0, 1000));
      }
    }
  } catch (e) {
    console.log('BP err:', e.message);
  }
}

(async () => {
  await probePB();
  await probeBP();
  process.exit(0);
})();
