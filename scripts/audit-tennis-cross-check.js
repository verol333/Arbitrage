#!/usr/bin/env node
// Cross-check tennis : pour un match precis, dump TOUS les marches raw
// sur BM + YB + Apollo pour comparer avec ce que voit l'user sur le site.
// Cible : identifier pourquoi une cote parsee != cote reelle sur le site.

import { swarmSession, BETMOMO_SID } from '../src/bookmakers/betmomo/api.js';
import { betmomoFlatOdds } from '../src/bookmakers/betmomo/parse.js';
import { apolloGet, APOLLO_SID } from '../src/bookmakers/apollo/api.js';
import { fetchOffers } from '../src/bookmakers/apollo/list.js';
import { apolloFlatOdds } from '../src/bookmakers/apollo/parse.js';
import { evapi } from '../src/bookmakers/yellowbet/api.js';
import { yellowbetFlatOdds } from '../src/bookmakers/yellowbet/parse.js';

const TARGET_TOKENS = ['roncadelli', 'nicod'];  // Franco Roncadelli vs Jakub Nicod

function matches(a, b) {
  const s = `${a} ${b}`.toLowerCase();
  return TARGET_TOKENS.every((t) => s.includes(t));
}

// ═══ BETMOMO ════════════════════════════════════════════════════════════════
console.log('\n════════ BETMOMO tennis Roncadelli vs Nicod ════════');
try {
  const bmResult = await swarmSession(async (send) => {
    const now = Math.floor(Date.now() / 1000);
    const to = now + 48 * 3600;
    // Fetch prematch tennis list
    const listData = await send(
      { sport: ['id'], region: ['name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'start_ts'] },
      { sport: { id: BETMOMO_SID.tennis }, game: { start_ts: { '@gt': now, '@lt': to }, is_live: 0 } },
    );
    const all = [];
    for (const s of Object.values(listData?.sport || {})) {
      for (const g of Object.values(s.game || {})) all.push(g);
      for (const r of Object.values(s.region || {})) {
        for (const c of Object.values(r.competition || {})) {
          for (const g of Object.values(c.game || {})) all.push(g);
        }
      }
    }
    const target = all.find((g) => matches(g.team1_name, g.team2_name));
    if (!target) { console.log('  ⚠️ Match not found in BM prematch'); return null; }
    console.log(`  ✅ Found BM: ${target.team1_name} vs ${target.team2_name} | id=${target.id}`);
    const od = await send(
      { game: ['id', 'team1_name', 'team2_name'], market: ['name', 'type'], event: ['name', 'price', 'base', 'type_1', 'type'] },
      { game: { id: target.id } },
    );
    return Object.values(od?.game || {})[0];
  }, { timeoutMs: 20_000 });
  if (bmResult) {
    const markets = Object.values(bmResult.market || {});
    console.log(`  BM markets total: ${markets.length}`);
    console.log(`\n  === MARCHES CONTENANT "handicap" ou "set" ===`);
    for (const m of markets) {
      const nm = String(m.name || '').toLowerCase();
      const tp = String(m.type || '');
      if (!/handicap|set/i.test(nm + ' ' + tp)) continue;
      const evs = Array.isArray(m.event) ? m.event : Object.values(m.event || {});
      const sample = evs.map((e) => `${e.type_1 || e.type || e.name}=${e.price} b=${e.base}`);
      console.log(`    type="${m.type}" name="${m.name}" (${evs.length}): ${sample.join(' | ')}`);
    }
    const parsed = betmomoFlatOdds(markets);
    console.log(`\n  === CLES PARSEES set_hcp_* + s1_hcp_* + hcp_* ===`);
    for (const [k, v] of Object.entries(parsed).filter(([k]) => /^(set_hcp|s\d_hcp|hcp)_/.test(k))) {
      console.log(`    ${k} = ${v}`);
    }
  }
} catch (e) { console.log(`  ERR BM: ${e.message}`); }

// ═══ APOLLO ═════════════════════════════════════════════════════════════════
console.log('\n════════ APOLLO tennis Roncadelli vs Nicod ════════');
try {
  const now = new Date().toISOString();
  const dateTo = '2046-04-07T22:59:59.000Z';
  const j = await apolloGet(`/sport/offer/v3/sports/offer?Offset=0&Limit=200&DateFrom=${now}&DateTo=${dateTo}&SportIds=${APOLLO_SID.tennis}`);
  let target = null;
  for (const s of j?.Response || []) for (const c of s.Categories || []) for (const l of c.Leagues || []) for (const m of l.Matches || []) {
    if (matches(m.TeamHome, m.TeamAway)) { target = m; break; }
  }
  if (!target) console.log('  ⚠️ Match not found in Apollo');
  else {
    console.log(`  ✅ Found Apollo: ${target.TeamHome} vs ${target.TeamAway} | id=${target.Id}`);
    const map = await fetchOffers([target.Id]);
    const offers = map.get(target.Id) || [];
    console.log(`  ${offers.length} offers`);
    console.log(`\n  === BetTypeKeys 914/915/989 (set hcp/total/set-1 hcp) ===`);
    for (const o of offers) {
      if (![914, 915, 989, 20, 502, 558].includes(Number(o.BetTypeKey))) continue;
      const odds = (o.Odds || []).map((od) => `T=${od.Type} N="${od.Name}" O=${od.Odd}`);
      console.log(`    BetTypeKey=${o.BetTypeKey} Sbv=${o.Sbv || ''} (${(o.Odds || []).length}): ${odds.join(' | ')}`);
    }
    const parsed = apolloFlatOdds(offers);
    console.log(`\n  === CLES PARSEES set_hcp_* + s1_hcp_* + hcp_* + m1x2 ===`);
    for (const [k, v] of Object.entries(parsed).filter(([k]) => /^(match_[12]|set_hcp|s\d_hcp|hcp)_?/.test(k))) {
      console.log(`    ${k} = ${v}`);
    }
  }
} catch (e) { console.log(`  ERR Apollo: ${e.message}`); }

// ═══ YELLOWBET ══════════════════════════════════════════════════════════════
console.log('\n════════ YELLOWBET tennis Roncadelli vs Nicod ════════');
try {
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const nowD = new Date();
  const to = new Date(nowD.getTime() + 48 * 3600 * 1000);
  const j = await evapi(`https://yellowbet.cg/services/evapi/event/GetEvents?fromDate=${iso(nowD)}&toDate=${iso(to)}&skip=0&take=500&count=500&pageSize=500`);
  const evs = (j?.data || []).filter((e) => e.sid === 35 && e.bts?.length && !e.lv);
  const target = evs.find((e) => matches(e.h, e.a));
  if (!target) console.log('  ⚠️ Match not found in YB');
  else {
    console.log(`  ✅ Found YB: ${target.h} vs ${target.a} | ${target.bts.length} markets`);
    console.log(`\n  === MARCHES CONTENANT "handicap" ou "set" ===`);
    for (const bt of target.bts) {
      if (!/handicap|set/i.test(bt.n || '')) continue;
      const sample = (bt.odds || []).map((o) => `${o.n || o.id}=${o.p}${o.l != null ? ` l=${o.l}` : ''}`);
      console.log(`    "${bt.n}" (${(bt.odds || []).length}): ${sample.join(' | ')}`);
    }
    const parsed = yellowbetFlatOdds(target.bts, { home: target.h, away: target.a });
    console.log(`\n  === CLES PARSEES set_hcp_* + s1_hcp_* + hcp_* + m1x2 ===`);
    for (const [k, v] of Object.entries(parsed).filter(([k]) => /^(match_[12]|set_hcp|s\d_hcp|hcp)_?/.test(k))) {
      console.log(`    ${k} = ${v}`);
    }
  }
} catch (e) { console.log(`  ERR YB: ${e.message}`); }

process.exit(0);
