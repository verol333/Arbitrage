#!/usr/bin/env node
// Audit LIVE exhaustif YellowBet + BetMomo : dump TOUS les marches bruts
// et clés parsées pour identifier les marchés non mappés au parseur.

import { evapi } from '../src/bookmakers/yellowbet/api.js';
import { yellowbetFlatOdds } from '../src/bookmakers/yellowbet/parse.js';
import { swarmSession, BETMOMO_SID } from '../src/bookmakers/betmomo/api.js';
import { betmomoFlatOdds } from '../src/bookmakers/betmomo/parse.js';

const TOP_N = 2;

// ═══ YELLOWBET LIVE ═══════════════════════════════════════════════════════
console.log('════════════════════ YELLOWBET LIVE ════════════════════\n');
try {
  const ybData = await evapi('https://yellowbet.cg/services/evapi/event/GetEvents?isLive=true&count=500&take=500');
  const ybEvents = (ybData?.data || []).filter((e) => e.sid === 31 && e.bts?.length);
  console.log(`Total events live YB : ${ybEvents.length}\n`);

  ybEvents.sort((a, b) => (b.bts?.length || 0) - (a.bts?.length || 0));
  for (const ev of ybEvents.slice(0, TOP_N)) {
    console.log(`\n╔══ YB : ${ev.h} vs ${ev.a} | score=${ev.hs ?? '?'}-${ev.as ?? '?'} min=${ev.mm ?? '?'} | ${ev.bts.length} markets bruts ══╗`);
    const parsed = yellowbetFlatOdds(ev.bts, { home: ev.h, away: ev.a });
    console.log(`Cles parsees : ${Object.keys(parsed).length}\n`);

    // Marchés 2-way (2 outcomes) non mappés — les candidats les + utiles
    console.log('=== MARCHES 2-WAY NON MAPPES (candidats a ajouter) ===');
    for (const bt of ev.bts) {
      const n = bt.n || '';
      const nOdds = (bt.odds || []).length;
      if (nOdds !== 2 && nOdds !== 3) continue;
      // Filtres : marchés qu'on sait deja mapper ou skip volontairement
      if (/first goalscorer|anytime goalscorer|last goalscorer|first team booked/i.test(n)) continue;
      if (/multiscores|correct score|winning margins|halftime.fulltime|multigoals/i.test(n)) continue;
      if (/exact goals|exact bookings|total goals rangess|time of first goal|correct/i.test(n)) continue;
      // Marchés déjà mappés (skip)
      const mapped = ['FT 1X2', 'Double Chance', 'GG/NG', 'Under/Over', 'HT 1X2', 'HT U/O',
        '2nd Half : 1X2', '2nd Half : Totals', 'Draw No Bet', 'Odd/Even goals',
        '1st Half Double Chance', '1st Half : Goal Goal / No Goal', '1st Half Draw no bet',
        '1st Half : Odd/Even Goals', '2nd Half : Odd / Even',
        '2nd half : Double Chance', '2nd Half : Both Teams to score',
        'Highest Scoring Half', 'First Goal',
        'Total corners Under/Over', '1st Half : Corners Under/Over',
        'Corner handicap', '1st Half : Corner Handicap', 'Corner Odd/Even'];
      if (mapped.some((m) => n.toLowerCase() === m.toLowerCase())) continue;
      // Marchés team totals (déjà mappés via nom d'équipe)
      if (n.includes('total') && (n.includes(ev.h) || n.includes(ev.a))) continue;

      const sample = (bt.odds || []).map((o) => {
        const line = o.l != null ? ` l=${o.l}` : (o.sp != null ? ` sp=${o.sp}` : '');
        return `${o.n || o.id}=${o.p}${line}`;
      });
      console.log(`  - "${n}" (${nOdds}): ${sample.join(' | ')}`);
    }
  }
} catch (e) {
  console.log(`ERR YB : ${e.message}`);
}

// ═══ BETMOMO LIVE ═════════════════════════════════════════════════════════
console.log('\n\n════════════════════ BETMOMO LIVE ════════════════════\n');
try {
  const bmMatches = await swarmSession(async (send) => {
    const listData = await send(
      { sport: ['id'], region: ['name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'info'] },
      { sport: { id: BETMOMO_SID.football }, game: { is_live: 1 } },
    );
    const games = [];
    for (const s of Object.values(listData?.sport || {})) {
      for (const g of Object.values(s.game || {})) games.push(g);
      for (const r of Object.values(s.region || {})) {
        for (const c of Object.values(r.competition || {})) {
          for (const g of Object.values(c.game || {})) games.push(g);
        }
      }
    }
    console.log(`Total games live BM : ${games.length}`);
    if (!games.length) return [];
    // Fetch odds for first N matches
    const ids = games.slice(0, 5).map((g) => g.id);
    const oddsData = await send(
      { game: ['id', 'team1_name', 'team2_name', 'info'], market: ['name', 'type', 'col_count', 'group_name'], event: ['name', 'price', 'base', 'type_1', 'type'] },
      { game: { id: { '@in': ids } } },
    );
    return Object.values(oddsData?.game || {});
  }, { timeoutMs: 30_000 });

  if (!bmMatches.length) {
    console.log('Aucun match live BM disponible actuellement.');
  } else {
    // Sort by number of markets
    bmMatches.sort((a, b) => Object.keys(b.market || {}).length - Object.keys(a.market || {}).length);
    for (const g of bmMatches.slice(0, TOP_N)) {
      const markets = Object.values(g.market || {});
      const info = g.info || {};
      console.log(`\n╔══ BM : ${g.team1_name} vs ${g.team2_name} | score=${info.score1}-${info.score2} | ${markets.length} markets bruts ══╗`);
      const parsed = betmomoFlatOdds(markets);
      console.log(`Cles parsees : ${Object.keys(parsed).length}\n`);

      console.log('=== TOUS LES TYPES DE MARCHES ===');
      const seen = new Set();
      for (const m of markets) {
        const t = m.type || '';
        if (seen.has(t)) continue;
        seen.add(t);
        const events = Array.isArray(m.event) ? m.event : Object.values(m.event || {});
        const nEv = events.length;
        const sample = events.slice(0, 3).map((e) => `${e.type_1 || e.type || e.name}=${e.price}${e.base != null ? ' b=' + e.base : ''}`);
        console.log(`  type="${t}" name="${m.name || ''}" (${nEv}): ${sample.join(' | ')}${nEv > 3 ? ' …' : ''}`);
      }
    }
  }
} catch (e) {
  console.log(`ERR BM : ${e.message}`);
}

process.exit(0);
