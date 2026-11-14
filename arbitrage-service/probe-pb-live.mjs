// Sonde : comment PremierBet date ses matchs EN DIRECT.
const BASE = 'https://sports-api.premierbet.com/cm/v1';
const PARAMS = { country: 'CM', group: 'g1', platform: 'desktop', locale: 'fr' };
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  Referer: 'https://www.premierbet.com/',
  Origin: 'https://www.premierbet.com',
};
async function mget(path, extra = {}) {
  const ps = new URLSearchParams({ ...PARAMS, ...extra });
  const r = await fetch(\`\${BASE}\${path}?\${ps}\`, { headers: HEADERS, signal: AbortSignal.timeout(25000) });
  if (!r.ok) return { status: r.status, data: null };
  return { status: r.status, data: await r.json() };
}
function eventsOf(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  const out = [];
  for (const c of data.categories || []) for (const k of c.competitions || []) out.push(...(k.events || []));
  return out;
}
const iso = (v) => {
  if (v == null) return 'null';
  const n = Number(v);
  return Number.isFinite(n) && n > 1e11 ? new Date(n).toISOString() : String(v);
};
(async () => {
  const now = Date.now();
  console.log('NOW =', new Date(now).toISOString(), '(', now, ')');
  for (const extra of [{ sportId: '1' }, { sportId: '1', timeOffset: '-60' }]) {
    const r = await mget('/events/live', extra);
    const evs = eventsOf(r.data);
    console.log('\n===== /events/live', JSON.stringify(extra), 'status=' + r.status, 'events=' + evs.length);
    if (evs[0]) console.log('RAW[0] =', JSON.stringify(evs[0]).slice(0, 1500));
    for (const ev of evs.slice(0, 12)) {
      const fields = {};
      for (const [k, v] of Object.entries(ev)) if (/time|date|start|live|period|minute|status/i.test(k)) fields[k] = v;
      console.log('- ' + (ev.eventNames?.join?.(' - ') || ev.eventNames) + ' | ' + ev.competitionName + ' | startTime=' + iso(ev.startTime) + ' | ' + JSON.stringify(fields));
    }
  }
})().catch((e) => console.log('ERR', e.message));
