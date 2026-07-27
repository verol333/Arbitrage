#!/usr/bin/env node
// Sanity check des cotes 1X2 en LIVE pour YB et BM.
// Objectif : trouver pourquoi une equipe qui mène 1-0 à 55' peut être cotée 3.15
// chez YB alors que sa cote reelle doit être ~1.5.
//
// Pour chaque match LIVE (avec score + minute connus) :
//  1) extrait match_1/X/2 via le parseur
//  2) compare a score+minute :
//       - equipe qui mene fortement mais cote > 2.5 → SUSPECT
//       - equipe qui perd mais cote < 1.5 → SUSPECT
//  3) dump TOUS les marches 3-way (odds.length===3) du match avec leurs cotes
//     pour identifier d'ou vient la cote extraite.

import { evapi } from '../src/bookmakers/yellowbet/api.js';
import { yellowbetFlatOdds } from '../src/bookmakers/yellowbet/parse.js';
import { swarmSession, BETMOMO_SID } from '../src/bookmakers/betmomo/api.js';
import { betmomoFlatOdds } from '../src/bookmakers/betmomo/parse.js';

// Heuristique : cote plausible pour 1X2 selon score+minute (foot).
// Renvoie 'ok' | 'stale-lead' | 'stale-behind' | 'unknown'
function sanity(matchN, homeGoals, awayGoals, minute, side /* '1'|'2' */) {
  if (matchN == null) return 'no-cote';
  const lead = homeGoals - awayGoals; // + = home ahead
  const timeLeft = 90 - (minute ?? 0);
  // Si peu de temps restant + gros avantage, cote doit tendre vers 1.0
  if (timeLeft <= 40) {
    if (side === '1' && lead >= 2 && matchN > 1.5) return `STALE (home +${lead} @ ${minute}' but cote=${matchN})`;
    if (side === '2' && lead <= -2 && matchN > 1.5) return `STALE (away +${-lead} @ ${minute}' but cote=${matchN})`;
    if (side === '1' && lead >= 1 && timeLeft <= 20 && matchN > 2) return `STALE (home +${lead} @ ${minute}' but cote=${matchN})`;
    if (side === '2' && lead <= -1 && timeLeft <= 20 && matchN > 2) return `STALE (away +${-lead} @ ${minute}' but cote=${matchN})`;
    // Equipe qui perd cotée <1.5 = impossible
    if (side === '1' && lead <= -1 && matchN < 1.5) return `IMPOSSIBLE (home -${-lead} @ ${minute}' but cote=${matchN})`;
    if (side === '2' && lead >= 1 && matchN < 1.5) return `IMPOSSIBLE (away -${lead} @ ${minute}' but cote=${matchN})`;
  }
  return 'ok';
}

// ═══ YELLOWBET LIVE ═══════════════════════════════════════════════════════
console.log('════════════════════ YELLOWBET LIVE 1X2 SANITY ════════════════════\n');
try {
  const ybData = await evapi('https://yellowbet.cg/services/evapi/event/GetEvents?isLive=true&count=500&take=500');
  const events = (ybData?.data || []).filter((e) => e.sid === 31 && e.bts?.length && e.hs != null && e.as != null);
  console.log(`Total events live YB avec score : ${events.length}\n`);

  let suspicious = 0;
  for (const ev of events) {
    const parsed = yellowbetFlatOdds(ev.bts, { home: ev.h, away: ev.a });
    const m1 = parsed.match_1, mx = parsed.match_X, m2 = parsed.match_2;
    const hs = ev.hs, as = ev.as, mm = ev.mm;
    const s1 = sanity(m1, hs, as, mm, '1');
    const s2 = sanity(m2, hs, as, mm, '2');
    if (s1 === 'ok' && s2 === 'ok') continue;
    if (s1 === 'no-cote' && s2 === 'no-cote') continue;
    suspicious++;
    console.log(`\n╔══ SUSPECT : ${ev.h} vs ${ev.a} | score=${hs}-${as} min=${mm}' ══╗`);
    console.log(`  match_1=${m1}  match_X=${mx}  match_2=${m2}`);
    console.log(`  home: ${s1}`);
    console.log(`  away: ${s2}`);
    // Dump tous les marchés 3-way pour trouver l'origine
    console.log('  === Tous les marchés 3-way sur cet event ===');
    for (const bt of ev.bts) {
      const odds = bt.odds || [];
      if (odds.length !== 3) continue;
      const sample = odds.map((o) => `${o.n || o.id}=${o.p}${o.l != null ? ` l=${o.l}` : ''}`);
      console.log(`    "${bt.n}": ${sample.join(' | ')}`);
    }
    if (suspicious >= 8) break;
  }
  console.log(`\n=> Suspects YB : ${suspicious}`);
} catch (e) {
  console.log(`ERR YB : ${e.message}`);
}

// ═══ BETMOMO LIVE ═════════════════════════════════════════════════════════
console.log('\n\n════════════════════ BETMOMO LIVE 1X2 SANITY ════════════════════\n');
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
    const ids = games.map((g) => g.id);
    // Fetch par lots de 30
    const out = [];
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      const od = await send(
        { game: ['id', 'team1_name', 'team2_name', 'info'], market: ['name', 'type'], event: ['name', 'price', 'base', 'type_1', 'type'] },
        { game: { id: { '@in': chunk } } },
      );
      for (const g of Object.values(od?.game || {})) out.push(g);
    }
    return out;
  }, { timeoutMs: 45_000 });

  let suspicious = 0;
  for (const g of bmMatches) {
    const info = g.info || {};
    const hs = Number(info.score1), as = Number(info.score2);
    const mm = Number(info.current_game_time);
    if (!Number.isFinite(hs) || !Number.isFinite(as) || !Number.isFinite(mm)) continue;
    const markets = Object.values(g.market || {});
    const parsed = betmomoFlatOdds(markets);
    const m1 = parsed.match_1, mx = parsed.match_X, m2 = parsed.match_2;
    const s1 = sanity(m1, hs, as, mm, '1');
    const s2 = sanity(m2, hs, as, mm, '2');
    if (s1 === 'ok' && s2 === 'ok') continue;
    if (s1 === 'no-cote' && s2 === 'no-cote') continue;
    suspicious++;
    console.log(`\n╔══ SUSPECT : ${g.team1_name} vs ${g.team2_name} | score=${hs}-${as} min=${mm}' ══╗`);
    console.log(`  match_1=${m1}  match_X=${mx}  match_2=${m2}`);
    console.log(`  home: ${s1}`);
    console.log(`  away: ${s2}`);
    console.log('  === Tous les marchés 3-way sur cet event ===');
    for (const m of markets) {
      const evs = Array.isArray(m.event) ? m.event : Object.values(m.event || {});
      if (evs.length !== 3) continue;
      const sample = evs.map((e) => `${e.type_1 || e.type || e.name}=${e.price}${e.base != null ? ` b=${e.base}` : ''}`);
      console.log(`    type="${m.type}" name="${m.name || ''}": ${sample.join(' | ')}`);
    }
    if (suspicious >= 8) break;
  }
  console.log(`\n=> Suspects BM : ${suspicious}`);
} catch (e) {
  console.log(`ERR BM : ${e.message}`);
}

process.exit(0);
