// Probe v3 final : associer sport IDs → nom réel pour 1win, Congobet, Sportcash
import { fetchJson } from '../src/net/fetcher.js';

const out = {};

// ── 1win : scan sids 1..100, dump sample équipes pour identifier
out['1win'] = {};
try {
  const now = Math.floor(Date.now() / 1000);
  const found = [];
  for (const sid of Array.from({ length: 100 }, (_, i) => i + 1)) {
    const r = await fetch('https://api-gateway.top-parser.com/matches/get-many', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://1win.ng', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({ sportId: sid, startAtFrom: now, startAtTo: now + 7 * 86400, limit: 3, offset: 0, l: 'en-001', p: '44ba10e5-7df2-47ab-a44d-dc93803c7a6e' }),
    });
    const j = r.ok ? await r.json() : null;
    const items = j?.result?.items || [];
    if (items.length) {
      const m = items[0];
      const home = m.homeTeam?.name || m.team1?.name || m.competitors?.[0]?.name;
      const away = m.awayTeam?.name || m.team2?.name || m.competitors?.[1]?.name;
      const sport = m.sport?.name || m.sportName || m.sport?.tag || null;
      const tourn = m.tournament?.name || m.category?.name || null;
      found.push({ sid, sport, tournament: tourn, sample: `${home} vs ${away}` });
    }
  }
  out['1win'] = found;
} catch (e) { out['1win'] = { error: e.message }; }

// ── Congobet : sample event pour chaque sportId 101..115
out.congobet = {};
try {
  const found = [];
  for (const sid of [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115]) {
    const j = await fetchJson(`https://hg-event-api-prod.sporty-tech.net/api/events?eventCategoryIds=${sid}&offset=0&length=3&fetchEventBetTypesMode=0&betTypeId=10001&l=fr`, {
      headers: { 'user-agent': 'Mozilla/5.0', origin: 'https://www.congobet.net', referer: 'https://www.congobet.net/sports' }, timeoutMs: 10000,
    });
    const items = Array.isArray(j) ? j : (j?.data || []);
    if (items.length) {
      const ev = items[0];
      found.push({
        sid,
        sport_path: ev.categoryPath,
        category: (ev.categories || [])[0],
        sample: `${ev.homeTeamName} vs ${ev.awayTeamName}`,
        league: (ev.categories || []).join(' / '),
      });
    }
  }
  out.congobet = found;
} catch (e) { out.congobet = { error: e.message }; }

// ── Sportcash : depuis getWidgetCentrali.lms, extraire un vrai event par sid
out.sportcash = {};
try {
  const j = await fetchJson('https://sportcash.ci/XSportDatastore/getWidgetCentrali?systemCode=SPORTCASH&lingua=FR&hash=', {
    headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://sportcash.ci/' }, timeoutMs: 15000,
  });
  const found = [];
  if (j?.lms) for (const [sid, bucket] of Object.entries(j.lms)) {
    const evs = [...(bucket?.avs || []), ...(bucket?.tms || [])];
    const first = evs[0];
    found.push({
      sid,
      keys: bucket ? Object.keys(bucket).slice(0, 8) : [],
      first_full: first ? { ds: first.ds, dt: first.dt, dc: first.dc, da: first.da, p: first.p, a: first.a } : null,
    });
  }
  out.sportcash.buckets = found;
  // Dump aussi les BW banners pour trouver d'autres sports
  const bws = (j?.bws || []).map((bw) => ({
    d: bw.d,
    sports_in: [...new Set((bw.avs || []).map((a) => a.ds).filter(Boolean))],
    count: (bw.avs || []).length,
  }));
  out.sportcash.banner_sports = bws;
  // Home landing complète
  const hl = await fetchJson('https://sportcash.ci/XSportDatastore/getHomeLandingData?systemCode=SPORTCASH&lingua=FR&hash=&timezone=1', {
    headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://sportcash.ci/' }, timeoutMs: 15000,
  });
  const dsCount = {};
  const walk = (arr) => { for (const a of (arr || [])) { const k = a?.ds; if (k) dsCount[k] = (dsCount[k] || 0) + 1; if (a.avs) walk(a.avs); } };
  walk(hl?.tms);
  if (hl?.lvs) for (const lv of Object.values(hl.lvs)) { if (lv?.avs) walk(lv.avs); else walk([lv]); }
  out.sportcash.hl_ds_counts = dsCount;
} catch (e) { out.sportcash.error = e.message; }

console.log('=== V3 START ===');
console.log(JSON.stringify(out, null, 2));
console.log('=== V3 END ===');
process.exit(0);
