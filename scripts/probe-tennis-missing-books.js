#!/usr/bin/env node
// Probe 1win / sportcash / congobet pour verifier ce qu'ils exposent en tennis.
// But : decider si on peut activer tennis proprement pour chacun.

import { WIN_SID, API_BASE, ORIGIN, UA, PLATFORM } from '../src/bookmakers/onewin/api.js';
import { CONGO_API, congoJson } from '../src/bookmakers/congobet/api.js';
import { xget } from '../src/bookmakers/sportcash/api.js';

async function probeOnewinTennis() {
  console.log('\n═══ 1win TENNIS — scan sportIds 1..60 ═══');
  const now = Math.floor(Date.now() / 1000);
  const found = [];
  for (let sid = 1; sid <= 60; sid++) {
    const body = { sportId: sid, startAtFrom: now - 3600, startAtTo: now + 3 * 86400, limit: 5, offset: 0, l: 'en-001', p: PLATFORM };
    try {
      const res = await fetch(`${API_BASE}/matches/get-many`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Referer: `${ORIGIN}/`, 'User-Agent': UA },
        body: JSON.stringify(body),
      });
      if (!res.ok) continue;
      const j = await res.json();
      const items = j?.result?.items || [];
      if (!items.length) continue;
      const sample = items[0];
      const home = sample.homeTeam?.name || sample.competitors?.[0]?.name || '?';
      const away = sample.awayTeam?.name || sample.competitors?.[1]?.name || '?';
      const league = sample.tournament?.name || sample.category?.slug || '';
      console.log(`  sid=${sid} : ${items.length} matchs | sample: ${home} vs ${away} | ${league}`);
      // Detect tennis via league name or player format
      const nam = `${home} ${away} ${league}`.toLowerCase();
      const isTennis = /tennis|atp|wta|itf|challenger|open|clay|hard court/.test(nam) || / vs /.test(`${home} vs ${away}`);
      if (isTennis) found.push({ sid, sample: `${home} vs ${away}`, league });
    } catch { /* ignore */ }
  }
  console.log(`\n  → candidats tennis: ${found.length}`);
  for (const f of found) console.log(`    sid=${f.sid} : ${f.sample} | ${f.league}`);
}

async function probeCongobetTennis() {
  console.log('\n═══ Congobet TENNIS (sportId=103) — deep probe ═══');
  try {
    const cats = await congoJson(`${CONGO_API}eventCategories/103?l=fr`);
    if (!Array.isArray(cats) || !cats.length) { console.log('  no categories'); return; }
    console.log(`  top categories: ${cats.length}`);
    // Explorer les leaves de facon plus complete + essayer plusieurs endpoints
    const leaves = [];
    const collect = (node) => {
      const subs = node.subCategories || [];
      if (!subs.length && (node.eventsCount || 0) > 0) leaves.push(node);
      else subs.forEach(collect);
    };
    cats.forEach(collect);
    console.log(`  leaves declarant events: ${leaves.length}`);
    // Tester 3 leaves differents avec plusieurs variantes de params
    const testLeaves = leaves.slice(0, 3);
    for (const lf of testLeaves) {
      console.log(`\n  leaf id=${lf.id} "${lf.name}" declare eventsCount=${lf.eventsCount}`);
      const variants = [
        `events?eventCategoryIds=${lf.id}&offset=0&length=50&fetchEventBetTypesMode=0&betTypeId=10001&l=fr`,
        `events?eventCategoryIds=${lf.id}&offset=0&length=50&l=fr`,
        `events?eventCategoryIds=${lf.id}&l=fr`,
        `events/${lf.id}?l=fr`,
        `events?categoryId=${lf.id}&l=fr`,
        `events?sportId=103&eventCategoryIds=${lf.id}&l=fr`,
      ];
      for (const v of variants) {
        try {
          const r = await congoJson(`${CONGO_API}${v}`);
          const items = Array.isArray(r) ? r : (r?.data || r?.events || null);
          const n = Array.isArray(items) ? items.length : (r ? 'obj' : 'null');
          console.log(`    ${v} → ${n}`);
          if (Array.isArray(items) && items.length) {
            const ev = items[0];
            console.log(`      sample: ${ev.homeTeamName || ev.name || '?'} vs ${ev.awayTeamName || '?'} id=${ev.id}`);
            const bt = await congoJson(`${CONGO_API}bettypes?eventId=${ev.id}&l=fr`);
            if (Array.isArray(bt)) {
              console.log(`      betTypes (${bt.length}) : ${bt.slice(0, 10).map((b) => `${b.id}=${b.name}`).join(' | ')}`);
            }
            break;
          }
        } catch (e) { console.log(`    ${v} → ERR ${e.message}`); }
      }
    }
    // Essayer aussi events global sans filtre categorie
    console.log(`\n  events/sports (sportId=103) :`);
    for (const v of [
      `events/sports?sportId=103&offset=0&length=20&l=fr`,
      `events?sportId=103&offset=0&length=20&l=fr`,
    ]) {
      try {
        const r = await congoJson(`${CONGO_API}${v}`);
        const items = Array.isArray(r) ? r : (r?.data || r?.events || null);
        console.log(`    ${v} → ${Array.isArray(items) ? items.length : (r ? 'obj' : 'null')}`);
      } catch (e) { console.log(`    ${v} → ERR ${e.message}`); }
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
}

async function probeSportcashTennis() {
  console.log('\n═══ Sportcash TENNIS — deep endpoints probe ═══');
  // Le widget centrali n'expose que Football. Essayer d'autres endpoints XSport
  // pour trouver un catalogue tennis.
  const tests = [
    ['getSportsList', {}],
    ['getSportsAndCategoriesList', {}],
    ['getSportEvents', { sportId: 'Tennis' }],
    ['getSportEvents', { sportId: 'tennis' }],
    ['getSportEvents', { sportId: '2' }],
    ['getSportEvents', { sportId: '3' }],
    ['getSportEvents', { sportId: '4' }],
    ['getGruppiPerSport', { sportId: 'Tennis' }],
    ['getSportEventsList', { sport: 'Tennis' }],
    ['getEventsByFilter', { sport: 'Tennis' }],
  ];
  for (const [endpoint, params] of tests) {
    try {
      const r = await xget(endpoint, params, 8_000);
      if (!r) { console.log(`  ${endpoint}(${JSON.stringify(params)}) → null`); continue; }
      const size = JSON.stringify(r).length;
      const keys = typeof r === 'object' ? Object.keys(r).slice(0, 12).join(',') : '';
      console.log(`  ${endpoint}(${JSON.stringify(params)}) → ${size}b keys=${keys}`);
      // Chercher trace de tennis dans la reponse
      const s = JSON.stringify(r).toLowerCase();
      if (s.includes('tennis')) console.log(`    ★ contient "tennis"`);
    } catch (e) { console.log(`  ${endpoint} → ERR ${e.message}`); }
  }
}

await probeOnewinTennis();
await probeCongobetTennis();
await probeSportcashTennis();
process.exit(0);
