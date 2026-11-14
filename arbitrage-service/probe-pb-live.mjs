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
async function mget(path, extra) {
  const ps = new URLSearchParams(Object.assign({}, PARAMS, extra || {}));
  const url = BASE + path + '?' + ps.toString();
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(25000) });
  if (!r.ok) return { status: r.status, data: null };
  return { status: r.status, data: await r.json() };
}
function eventsOf(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  const out = [];
  for (const c of data.categories || []) for (const k of c.competitions || []) out.push.apply(out, (k.events || []));
  return out;
}
const iso = function (v) {
  if (v == null) return 'null';
  const n = Number(v);
  return Number.isFinite(n) && n > 1e11 ? new Date(n).toISOString() : String(v);
};
(async function () {
  const now = Date.now();
  console.log('NOW =', new Date(now).toISOString(), '(', now, ')');
  const variants = [{ sportId: '1' }, { sportId: '1', timeOffset: '-60' }];
  for (const extra of variants) {
    const r = await mget('/events/live', extra);
    const evs = eventsOf(r.data);
    console.log('');
    console.log('===== /events/live ' + JSON.stringify(extra) + ' status=' + r.status + ' events=' + evs.length);
    if (evs[0]) console.log('RAW[0] =', JSON.stringify(evs[0]).slice(0, 1500));
    for (const ev of evs.slice(0, 12)) {
      const fields = {};
      for (const k of Object.keys(ev)) if (/time|date|start|live|period|minute|status/i.test(k)) fields[k] = ev[k];
      const nm = Array.isArray(ev.eventNames) ? ev.eventNames.join(' - ') : String(ev.eventNames);
      console.log('- ' + nm + ' | ' + ev.competitionName + ' | startTime=' + iso(ev.startTime) + ' | ' + JSON.stringify(fields));
    }
  }
})().catch(function (e) { console.log('ERR', e.message); });
