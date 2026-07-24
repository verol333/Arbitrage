// Cherche les vrais endpoints tennis pour 1win, Congobet, YellowBet, Sportcash.
import { CONGO_API, congoJson } from '../../src/bookmakers/congobet/api.js';
import { evapi as ybevapi, BASE_URL as YBBASE } from '../../src/bookmakers/yellowbet/api.js';
import { API_BASE as WINBASE, ORIGIN as WINORIG, UA as WINUA, PLATFORM as WINPL } from '../../src/bookmakers/onewin/api.js';
import { xget as scget } from '../../src/bookmakers/sportcash/api.js';

async function probeOneWinTennis() {
  const out = { book: '1win' };
  // Test 1win avec différents sportId (ancien 12 puis autres candidats).
  const candidates = [12, 5, 6, 7, 20, 22, 39, 40];
  const now = Math.floor(Date.now() / 1000);
  for (const sid of candidates) {
    const body = { sportId: sid, startAtFrom: now - 3600, startAtTo: now + 3 * 86400, limit: 5, offset: 0, l: 'en-001', p: WINPL };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    try {
      const res = await fetch(`${WINBASE}/matches/get-many`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: WINORIG, Referer: `${WINORIG}/`, 'User-Agent': WINUA },
        body: JSON.stringify(body), signal: ctrl.signal,
      });
      clearTimeout(t);
      const data = await res.json();
      const items = data?.result?.items || [];
      out[`sportId_${sid}`] = { total: items.length, sample: items.slice(0, 2).map((m) => ({ home: m.homeTeam?.name || m.competitors?.[0]?.name, away: m.awayTeam?.name || m.competitors?.[1]?.name, sport: m.sport?.name || m.sportName })) };
    } catch (e) { out[`sportId_${sid}`] = { error: e.message }; }
  }
  return out;
}

async function probeCongobetTennis() {
  const out = { book: 'congobet' };
  // Test top-level categories, chercher un id de tennis parmi les sports.
  try {
    // GET all root categories (list of sports)
    const roots = await congoJson(`${CONGO_API}eventCategories?l=fr`);
    out.roots_type = Array.isArray(roots) ? 'array' : typeof roots;
    if (Array.isArray(roots)) {
      out.roots = roots.slice(0, 30).map((r) => ({ id: r.id, name: r.name, eventsCount: r.eventsCount, sub: (r.subCategories || []).length }));
    }
  } catch (e) { out.roots_err = e.message; }
  // Try common tennis IDs
  const candidates = ['102', '104', '105', '201', '202', '301', '2', '4', 'tennis', '10001'];
  for (const cid of candidates) {
    try {
      const r = await congoJson(`${CONGO_API}events?eventCategoryIds=${cid}&offset=0&length=5&fetchEventBetTypesMode=0&betTypeId=10001&l=fr`);
      const items = Array.isArray(r) ? r : (r?.data || []);
      if (items.length) {
        out[`cat_${cid}`] = { total: items.length, sample: items.slice(0, 2).map((e) => ({ home: e.homeTeamName, away: e.awayTeamName, cat: e.categoryPath })) };
      }
    } catch { /* silent */ }
  }
  return out;
}

async function probeYellowBetTennis() {
  const out = { book: 'yellowbet' };
  // YellowBet API stealth. Try common tennis IDs.
  const candidates = [33, 34, 35, 12, 4, 2, 100, 200];
  const now = new Date();
  const to = new Date(now.getTime() + 72 * 3600 * 1000);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  for (const sid of candidates) {
    try {
      const url = `${YBBASE}/event/GetEvents?sportIds=${sid}&fromDate=${iso(now)}&toDate=${iso(to)}&take=5&skip=0`;
      const data = await ybevapi(url);
      const events = Array.isArray(data?.data) ? data.data : [];
      if (events.length) {
        out[`sportId_${sid}`] = { total: events.length, sample: events.slice(0, 2).map((ev) => ({ home: ev.h, away: ev.a, league: ev.ln, sid: ev.sid })) };
      }
    } catch (e) { out[`sportId_${sid}`] = { error: e.message }; }
  }
  return out;
}

async function probeSportcashTennis() {
  const out = { book: 'sportcash' };
  const wc = await scget('getWidgetCentrali', {});
  const hl = await scget('getHomeLandingData', { timezone: '1' });
  const labels = new Set();
  const collect = (arr) => { for (const item of (arr || [])) { if (item?.ds) labels.add(item.ds); if (Array.isArray(item?.avs)) collect(item.avs); } };
  if (wc?.tms) collect(wc.tms);
  if (wc?.bws) for (const bw of wc.bws) collect(bw.avs || []);
  if (wc?.lms) for (const bk of Object.values(wc.lms)) collect(bk?.avs || []);
  if (hl?.tms) collect(hl.tms);
  if (hl?.lvs) for (const lv of hl.lvs) collect(lv?.avs || []);
  out.all_sport_labels = [...labels];
  out.has_tennis = [...labels].some((l) => /tennis/i.test(l));
  return out;
}

(async () => {
  const out = { at: new Date().toISOString() };
  for (const [name, fn] of [
    ['onewin', probeOneWinTennis],
    ['congobet', probeCongobetTennis],
    ['yellowbet', probeYellowBetTennis],
    ['sportcash', probeSportcashTennis],
  ]) {
    process.stderr.write(`[probe-alt-tennis] ${name}...\n`);
    try { out[name] = await fn(); } catch (e) { out[name] = { error: e.message }; }
  }
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
