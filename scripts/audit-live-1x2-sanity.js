#!/usr/bin/env node
// Sanity 1X2 LIVE — croise YB × BM par nom d'equipe pour utiliser BM score
// comme source de verite. Flag les cas ou match_1 YB (ou BM) est incoherent
// avec le score+minute reel.

import { evapi } from '../src/bookmakers/yellowbet/api.js';
import { yellowbetFlatOdds } from '../src/bookmakers/yellowbet/parse.js';
import { swarmSession, BETMOMO_SID } from '../src/bookmakers/betmomo/api.js';
import { betmomoFlatOdds } from '../src/bookmakers/betmomo/parse.js';

function norm(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(fc|sc|cf|ac|afc|club|clube|united|de|do|da|of|the|1|2)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenSet(s) { return new Set(norm(s).split(/\s+/).filter((t) => t.length >= 3)); }
function similarity(a, b) {
  const A = tokenSet(a), B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.max(A.size, B.size);
}

function sanity(matchN, hs, as, minute, side /* '1'|'2' */) {
  if (matchN == null) return null;
  const lead = hs - as;
  const timeLeft = 90 - (minute || 0);
  const problems = [];
  // Team leading strongly late : cote should be low
  if (timeLeft <= 40) {
    if (side === '1' && lead >= 2 && matchN > 1.6) problems.push(`STALE (home +${lead} @${minute}' cote=${matchN})`);
    if (side === '2' && lead <= -2 && matchN > 1.6) problems.push(`STALE (away +${-lead} @${minute}' cote=${matchN})`);
    if (side === '1' && lead >= 1 && matchN > 2.2) problems.push(`STALE (home +${lead} @${minute}' cote=${matchN})`);
    if (side === '2' && lead <= -1 && matchN > 2.2) problems.push(`STALE (away +${-lead} @${minute}' cote=${matchN})`);
    // Team losing but cote < 1.6 = wrong
    if (side === '1' && lead <= -1 && matchN < 1.8) problems.push(`IMPOSSIBLE (home -${-lead} @${minute}' cote=${matchN})`);
    if (side === '2' && lead >= 1 && matchN < 1.8) problems.push(`IMPOSSIBLE (away -${lead} @${minute}' cote=${matchN})`);
  }
  // Very late (>80') with any lead
  if (timeLeft <= 10) {
    if (side === '1' && lead >= 1 && matchN > 1.4) problems.push(`STALE-END (home +${lead} @${minute}' cote=${matchN})`);
    if (side === '2' && lead <= -1 && matchN > 1.4) problems.push(`STALE-END (away +${-lead} @${minute}' cote=${matchN})`);
  }
  return problems.length ? problems.join(' ; ') : null;
}

// ═══ Fetch BM LIVE with markets ═══════════════════════════════════════════
console.log('=== Fetching BM LIVE ...');
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
  if (!games.length) return [];
  const ids = games.map((g) => g.id);
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
console.log(`BM live: ${bmMatches.length} matchs`);

// ═══ Fetch YB LIVE ════════════════════════════════════════════════════════
console.log('=== Fetching YB LIVE ...');
const ybData = await evapi('https://yellowbet.cg/services/evapi/event/GetEvents?isLive=true&count=500&take=500');
const ybAll = (ybData?.data || []).filter((e) => e.sid === 31 && e.bts?.length);
// PRODUCTION filter : n'accepte que ev.lv truthy (vrai live)
const ybEvents = ybAll.filter((e) => e.lv);
console.log(`YB total (sid=31,bts>0): ${ybAll.length}, dont TRULY live (ev.lv=true): ${ybEvents.length}`);

// Dump 3 events truly-live pour reperer score/minute
for (let i = 0; i < Math.min(3, ybEvents.length); i++) {
  const ev = ybEvents[i];
  console.log(`\n=== YB TRULY-LIVE EV[${i}] fields === (${ev.h} vs ${ev.a})`);
  const kv = {};
  for (const [k, v] of Object.entries(ev)) {
    if (k === 'bts') continue;
    const t = typeof v;
    kv[k] = t === 'object' ? (Array.isArray(v) ? `[${v.length}]` : JSON.stringify(v).slice(0, 120)) : v;
  }
  console.log(JSON.stringify(kv, null, 2));
}

// ═══ Cross-match + sanity check ═══════════════════════════════════════════
console.log(`\n════════════ CROSS-CHECK YB×BM (BM score = truth) ════════════`);
let suspect = 0;
for (const bm of bmMatches) {
  const info = bm.info || {};
  const hs = Number(info.score1), as = Number(info.score2);
  const mm = Number(info.current_game_time);
  if (!Number.isFinite(hs) || !Number.isFinite(as) || !Number.isFinite(mm)) continue;
  // Chercher un YB event similaire (>= 0.5 similarity)
  const yb = ybEvents.map((e) => ({ e, s: (similarity(e.h, bm.team1_name) + similarity(e.a, bm.team2_name)) / 2 }))
    .sort((a, b) => b.s - a.s)[0];
  const ybMatched = yb && yb.s >= 0.5 ? yb.e : null;

  const bmMarkets = Object.values(bm.market || {});
  const bmParsed = betmomoFlatOdds(bmMarkets);
  const ybParsed = ybMatched ? yellowbetFlatOdds(ybMatched.bts, { home: ybMatched.h, away: ybMatched.a }) : null;

  const problems = [];
  const bmS1 = sanity(bmParsed.match_1, hs, as, mm, '1');
  const bmS2 = sanity(bmParsed.match_2, hs, as, mm, '2');
  if (bmS1) problems.push(`BM home: ${bmS1}`);
  if (bmS2) problems.push(`BM away: ${bmS2}`);
  if (ybParsed) {
    const ybS1 = sanity(ybParsed.match_1, hs, as, mm, '1');
    const ybS2 = sanity(ybParsed.match_2, hs, as, mm, '2');
    if (ybS1) problems.push(`YB home: ${ybS1}`);
    if (ybS2) problems.push(`YB away: ${ybS2}`);
  }
  if (!problems.length) continue;
  suspect++;
  console.log(`\n╔══ ${bm.team1_name} vs ${bm.team2_name} | score=${hs}-${as} min=${mm}' ══╗`);
  console.log(`  BM: match_1=${bmParsed.match_1} X=${bmParsed.match_X} 2=${bmParsed.match_2}`);
  if (ybParsed) console.log(`  YB (${ybMatched.h} vs ${ybMatched.a} sim=${yb.s.toFixed(2)}): match_1=${ybParsed.match_1} X=${ybParsed.match_X} 2=${ybParsed.match_2}`);
  else console.log(`  YB: no cross-match`);
  console.log(`  ${problems.join(' | ')}`);
  console.log(`  === BM 3-way markets ===`);
  for (const m of bmMarkets) {
    const evs = Array.isArray(m.event) ? m.event : Object.values(m.event || {});
    if (evs.length !== 3) continue;
    const sample = evs.map((e) => `${e.type_1 || e.type || e.name}=${e.price}${e.base != null ? ` b=${e.base}` : ''}`);
    console.log(`    type="${m.type}" name="${m.name || ''}": ${sample.join(' | ')}`);
  }
  if (ybMatched) {
    console.log(`  === YB 3-way markets (name-based) ===`);
    for (const bt of ybMatched.bts) {
      const odds = bt.odds || [];
      if (odds.length !== 3) continue;
      const sample = odds.map((o) => `${o.n || o.id}=${o.p}${o.l != null ? ` l=${o.l}` : ''}`);
      console.log(`    "${bt.n}": ${sample.join(' | ')}`);
    }
  }
  if (suspect >= 10) break;
}
console.log(`\n=> ${suspect} events suspects.`);
process.exit(0);
