#!/usr/bin/env node
// Probe 1win / sportcash / congobet pour verifier ce qu'ils exposent en tennis.
// But : decider si on peut activer tennis proprement pour chacun.

import { WIN_SID, API_BASE, ORIGIN, UA, PLATFORM } from '../src/bookmakers/onewin/api.js';
import { CONGO_API, congoJson } from '../src/bookmakers/congobet/api.js';
import { xget } from '../src/bookmakers/sportcash/api.js';

async function probeOnewinTennis() {
  console.log('\n═══ 1win TENNIS (sportId=12) ═══');
  const sid = WIN_SID.tennis;
  const now = Math.floor(Date.now() / 1000);
  const body = { sportId: sid, startAtFrom: now - 3600, startAtTo: now + 3 * 86400, limit: 50, offset: 0, l: 'en-001', p: PLATFORM };
  try {
    const res = await fetch(`${API_BASE}/matches/get-many`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Referer: `${ORIGIN}/`, 'User-Agent': UA },
      body: JSON.stringify(body),
    });
    const j = res.ok ? await res.json() : null;
    const items = j?.result?.items || [];
    console.log(`  matches PREMATCH: ${items.length}`);
    if (!items.length) { console.log('  → sportId=12 vide, tester d\'autres IDs.'); return; }
    for (const m of items.slice(0, 3)) {
      const home = m.homeTeam?.name || m.competitors?.[0]?.name;
      const away = m.awayTeam?.name || m.competitors?.[1]?.name;
      console.log(`  sample: ${home} vs ${away} | tour=${m.tournament?.name || ''} | id=${m.id}`);
    }
    // Probe odds via WS
    const { fetchOddsWS } = await import('../src/bookmakers/onewin/ws.js');
    const ids = items.slice(0, 2).map((m) => m.id);
    const map = await fetchOddsWS(ids);
    for (const id of ids) {
      const groups = map.get(id) || map.get(String(id));
      if (!groups) { console.log(`  odds id=${id}: NO GROUPS`); continue; }
      const names = Object.keys(groups);
      console.log(`  odds id=${id}: ${names.length} groupes`);
      for (const n of names.slice(0, 25)) console.log(`    "${n}" (${(groups[n] || []).length} outcomes)`);
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
}

async function probeCongobetTennis() {
  console.log('\n═══ Congobet TENNIS (sportId=103) ═══');
  try {
    const cats = await congoJson(`${CONGO_API}eventCategories/103?l=fr`);
    console.log(`  categories: ${Array.isArray(cats) ? cats.length : 'ERR'}`);
    if (!Array.isArray(cats) || !cats.length) {
      // Fallback : essayer autres sport IDs pour tennis
      for (const sid of [103, 104, 105, 106, 107, 108, 109, 110, 4]) {
        const c = await congoJson(`${CONGO_API}eventCategories/${sid}?l=fr`);
        console.log(`  fallback sid=${sid}: ${Array.isArray(c) ? c.length : 'ERR'}`);
      }
      return;
    }
    // Show structure
    const walk = (n, depth = 0) => {
      const pad = '  '.repeat(depth + 1);
      console.log(`${pad}"${n.name || n.id}" id=${n.id} events=${n.eventsCount || 0} subs=${(n.subCategories || []).length}`);
      if (depth < 2) for (const s of (n.subCategories || []).slice(0, 5)) walk(s, depth + 1);
    };
    for (const c of cats.slice(0, 3)) walk(c);
    // Essayer de fetch un event
    const leaves = [];
    const collect = (node) => {
      const subs = node.subCategories || [];
      if (!subs.length && (node.eventsCount || 0) > 0) leaves.push(node);
      else subs.forEach(collect);
    };
    cats.forEach(collect);
    console.log(`  leaves avec events: ${leaves.length}`);
    if (leaves.length) {
      const lf = leaves[0];
      const page = await congoJson(`${CONGO_API}events?eventCategoryIds=${lf.id}&offset=0&length=5&fetchEventBetTypesMode=0&betTypeId=10001&l=fr`);
      const items = Array.isArray(page) ? page : (page?.data || []);
      console.log(`  events sample (${items.length}):`);
      for (const ev of items.slice(0, 3)) {
        console.log(`    ${ev.homeTeamName} vs ${ev.awayTeamName} | id=${ev.id} | tour=${(ev.categoryPath || '').slice(0, 60)}`);
        // fetch bettypes
        const bt = await congoJson(`${CONGO_API}bettypes?eventId=${ev.id}&l=fr`);
        if (Array.isArray(bt)) {
          console.log(`      betTypes: ${bt.length}`);
          for (const b of bt.slice(0, 20)) console.log(`        id=${b.id} "${b.name}"`);
        }
        break; // 1 event suffit
      }
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
}

async function probeSportcashTennis() {
  console.log('\n═══ Sportcash TENNIS ═══');
  try {
    const wc = await xget('getWidgetCentrali', {});
    const ds_seen = new Set();
    // Explorer TOUS les widgets pour trouver Tennis
    const collect = (evs) => {
      for (const e of evs) if (e?.ds) ds_seen.add(e.ds);
    };
    if (wc?.bws) for (const bw of wc.bws) collect(bw.avs || []);
    if (wc?.tms) collect(wc.tms);
    if (wc?.lms) for (const k of Object.keys(wc.lms)) {
      const b = wc.lms[k];
      for (const lk of ['avs', 'tms', 'hmv', 'hgevs', 'lvs', 'evs']) {
        if (Array.isArray(b?.[lk])) collect(b[lk]);
      }
    }
    console.log(`  ds distincts observes: ${[...ds_seen].join(' | ')}`);
    // Compter events par ds
    const byDs = new Map();
    const collectByDs = (evs) => {
      for (const e of evs) {
        if (!e?.ds) continue;
        if (!byDs.has(e.ds)) byDs.set(e.ds, []);
        byDs.get(e.ds).push(e);
      }
    };
    if (wc?.bws) for (const bw of wc.bws) collectByDs(bw.avs || []);
    if (wc?.tms) collectByDs(wc.tms);
    if (wc?.lms) for (const k of Object.keys(wc.lms)) {
      const b = wc.lms[k];
      for (const lk of ['avs', 'tms', 'hmv', 'hgevs', 'lvs', 'evs']) {
        if (Array.isArray(b?.[lk])) collectByDs(b[lk]);
      }
    }
    for (const [ds, evs] of byDs) console.log(`    ${ds}: ${evs.length} events`);
    const tennisEvs = byDs.get('Tennis') || [];
    if (tennisEvs.length) {
      console.log('  → Tennis DETECTE, probe getEvento pour markets :');
      const e = tennisEvs[0];
      const j = await xget('getEvento', { pal: String(e.p), avv: String(e.a), idAggregata: '-1', isLive: 'false' }, 15_000);
      const scs = j?.scs || [];
      console.log(`  markets ${e.p}/${e.a} : ${scs.length}`);
      const cs_seen = new Set();
      for (const m of scs) if (m.cs != null) cs_seen.add(m.cs);
      console.log(`  cs codes distincts (${cs_seen.size}) : ${[...cs_seen].slice(0, 30).join(',')}`);
      // Dump quelques markets
      for (const m of scs.slice(0, 15)) {
        console.log(`    cs=${m.cs} "${m.ct || m.name || ''}" ${(m.sns || m.selections || []).length} sels`);
      }
    } else {
      console.log('  → aucun event Tennis dans widgets Sportcash.');
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
}

await probeOnewinTennis();
await probeCongobetTennis();
await probeSportcashTennis();
process.exit(0);
