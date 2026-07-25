// Probe v3 : découvrir sport IDs basket/hockey/volley pour 1win, YellowBet,
// Congobet, Sportcash. Utilise des vraies signatures : samples d'équipes,
// noms d'endpoints alternatifs, dumps de catalogues.
import { fetchJson } from '../src/net/fetcher.js';
import { stealthGetJson } from '../src/net/stealth.js';

const out = {};

// ── 1win ────────────────────────────────────────────────────────────────
// L'endpoint /matches/get-many filtre via sportId. On teste tous les IDs 1..200
// et on garde ceux qui renvoient au moins 1 match avec des équipes non-foot.
out['1win'] = {};
try {
  const now = Math.floor(Date.now() / 1000);
  const found = [];
  // On requête d'abord /sports/get-many pour dump COMPLET (name, slug)
  const catRes = await fetch('https://api-gateway.top-parser.com/sports/get-many', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://1win.ng', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({ l: 'en-001', p: '44ba10e5-7df2-47ab-a44d-dc93803c7a6e', limit: 200 }),
  });
  const catJ = catRes.ok ? await catRes.json() : null;
  // Dump ALL keys, pas juste name
  out['1win'].sports_raw_items = (catJ?.result?.items || []).slice(0, 100).map((s) => ({ ...s }));
  // Test sur quelques IDs candidats
  for (const sid of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]) {
    const r = await fetch('https://api-gateway.top-parser.com/matches/get-many', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://1win.ng', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({ sportId: sid, startAtFrom: now, startAtTo: now + 3 * 86400, limit: 5, offset: 0, l: 'en-001', p: '44ba10e5-7df2-47ab-a44d-dc93803c7a6e' }),
    });
    const j = r.ok ? await r.json() : null;
    const items = j?.result?.items || [];
    if (items.length) {
      const m = items[0];
      found.push({ sid, sample: `${m.homeTeam?.name || m.team1?.name} vs ${m.awayTeam?.name || m.team2?.name}`, sport_name: m.sport?.name || m.sportName, tournament: m.tournament?.name });
    }
  }
  out['1win'].sids_with_matches = found;
} catch (e) { out['1win'].error = e.message; }

// ── YellowBet ───────────────────────────────────────────────────────────
// Le paramètre `sportIds` semble ignoré. On teste `sportId` (singulier), et
// on dump 500 events sans filter pour grouper par sport.
out.yellowbet = {};
try {
  const url = `https://yellowbet.cg/services/evapi/event/GetEvents?count=500&take=500`;
  const j = await stealthGetJson(url, { headers: { brandid: '122', channelid: '4', language: 'fr', terminal: 'yellowbet.cg' }, timeoutMs: 15000 });
  const events = j?.data || [];
  const bySport = {};
  for (const ev of events) {
    const k = `${ev.sid}|${ev.sn || ev.spn || '?'}`;
    if (!bySport[k]) bySport[k] = { sid: ev.sid, sname: ev.sn || ev.spn, count: 0, sample: `${ev.h} vs ${ev.a}` };
    bySport[k].count++;
  }
  out.yellowbet.total_events = events.length;
  out.yellowbet.per_sport = Object.values(bySport);
  // Aussi test avec `sportId` (singulier)
  const url2 = `https://yellowbet.cg/services/evapi/event/GetEvents?sportId=3&count=10&take=10`;
  const j2 = await stealthGetJson(url2, { headers: { brandid: '122', channelid: '4', language: 'fr', terminal: 'yellowbet.cg' }, timeoutMs: 12000 });
  out.yellowbet.singular_sportId_test = { total: (j2?.data || []).length, sample: (j2?.data || [])[0] ? `${j2.data[0].h} vs ${j2.data[0].a} sid=${j2.data[0].sid}` : null };
} catch (e) { out.yellowbet.error = e.message; }

// ── Congobet ────────────────────────────────────────────────────────────
// eventCategories/{sportId} — teste 101 (foot connu), puis d'autres IDs
out.congobet = {};
try {
  const found = [];
  for (const sid of [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 200, 201, 202, 300, 301, 400, 401]) {
    const j = await fetchJson(`https://hg-event-api-prod.sporty-tech.net/api/eventCategories/${sid}?l=fr`, {
      headers: { 'user-agent': 'Mozilla/5.0', origin: 'https://www.congobet.net', referer: 'https://www.congobet.net/sports' }, timeoutMs: 10000,
    });
    if (Array.isArray(j) && j.length) {
      const totalEvents = j.reduce((sum, c) => {
        const walk = (n) => (n.eventsCount || 0) + (n.subCategories || []).reduce((s, sc) => s + walk(sc), 0);
        return sum + walk(c);
      }, 0);
      const sampleName = j[0]?.name || '?';
      if (totalEvents > 0) found.push({ sid, events: totalEvents, sample_cat: sampleName });
    }
  }
  out.congobet.discovered = found;
  // Aussi dump events live sans filter pour voir tous les sports actifs
  const live = await fetchJson(`https://hg-event-api-prod.sporty-tech.net/api/events/sports/live?offset=0&length=200`, {
    headers: { 'user-agent': 'Mozilla/5.0', origin: 'https://www.congobet.net', referer: 'https://www.congobet.net/sports' }, timeoutMs: 12000,
  });
  const bySport = {};
  for (const ev of (Array.isArray(live) ? live : [])) {
    const sid = (ev.categoryPath || '').split('/').filter(Boolean)[0] || '?';
    const sname = (ev.categories || [])[0] || '?';
    const k = `${sid}|${sname}`;
    if (!bySport[k]) bySport[k] = { sid, sname, count: 0, sample: `${ev.homeTeamName} vs ${ev.awayTeamName}` };
    bySport[k].count++;
  }
  out.congobet.live_per_sport = Object.values(bySport);
} catch (e) { out.congobet.error = e.message; }

// ── Sportcash ───────────────────────────────────────────────────────────
// wc.lms KEYED par sport ID. Dump avec vrai `ds` (via avs[0].ds).
// Aussi tester getHomeLandingData qui pourrait exposer plus.
out.sportcash = {};
try {
  const j = await fetchJson('https://sportcash.ci/XSportDatastore/getWidgetCentrali?systemCode=SPORTCASH&lingua=FR&hash=', {
    headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://sportcash.ci/' }, timeoutMs: 15000,
  });
  const entries = [];
  if (j?.lms) for (const [sid, bucket] of Object.entries(j.lms)) {
    const avs = bucket?.avs || [];
    entries.push({
      sid,
      events: avs.length,
      ds_samples: [...new Set(avs.slice(0, 5).map((a) => a.ds).filter(Boolean))],
      dt_samples: [...new Set(avs.slice(0, 5).map((a) => a.dt).filter(Boolean))].slice(0, 3),
      dc_samples: [...new Set(avs.slice(0, 5).map((a) => a.dc).filter(Boolean))].slice(0, 3),
      sample_match: avs[0] ? `${avs[0].da} | ds=${avs[0].ds} dt=${avs[0].dt}` : null,
    });
  }
  out.sportcash.buckets = entries;
  // Home landing peut avoir d'autres sports
  const hl = await fetchJson('https://sportcash.ci/XSportDatastore/getHomeLandingData?systemCode=SPORTCASH&lingua=FR&hash=&timezone=1', {
    headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://sportcash.ci/' }, timeoutMs: 15000,
  });
  const dsSet = new Set();
  for (const bucket of [hl?.tms, ...(Object.values(hl?.lvs || {}).flatMap((lv) => lv.avs || [lv]))]) {
    for (const av of (bucket || [])) if (av?.ds) dsSet.add(av.ds);
  }
  out.sportcash.hl_ds_distinct = [...dsSet];
} catch (e) { out.sportcash.error = e.message; }

console.log('=== SPORTS V2 START ===');
console.log(JSON.stringify(out, null, 2));
console.log('=== SPORTS V2 END ===');
process.exit(0);
