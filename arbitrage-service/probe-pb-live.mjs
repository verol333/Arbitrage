// Sonde : structure brute du flux LIVE PremierBet (et horaires).
const BASE = 'https://sports-api.premierbet.com/cm/v1';
const PARAMS = { country: 'CM', group: 'g1', platform: 'desktop', locale: 'fr' };
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  Referer: 'https://www.premierbet.com/',
  Origin: 'https://www.premierbet.com',
};
async function raw(path, extra) {
  const ps = new URLSearchParams(Object.assign({}, PARAMS, extra || {}));
  const url = BASE + path + '?' + ps.toString();
  try {
    const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(25000) });
    const t = await r.text();
    return { status: r.status, body: t };
  } catch (e) { return { status: 0, body: 'ERR ' + e.message }; }
}
function flatten(data) {
  const out = [];
  if (!data || typeof data !== 'object') return out;
  if (Array.isArray(data)) return data;
  for (const c of data.categories || []) for (const k of c.competitions || []) out.push.apply(out, (k.events || []));
  return out;
}
(async function () {
  console.log('NOW =', new Date().toISOString());
  const variants = [
    ['/events/live', { sportId: '1' }],
    ['/events/live', {}],
    ['/events/live', { sportId: '1', timeOffset: '0' }],
    ['/events/all', { sportId: '1' }],
    ['/events/upcoming', { sportId: '1', timeOffset: '-60', date: new Date().toISOString().slice(0, 10) }],
  ];
  for (const v of variants) {
    const r = await raw(v[0], v[1]);
    console.log('');
    console.log('=== ' + v[0] + ' ' + JSON.stringify(v[1]) + ' status=' + r.status + ' len=' + r.body.length);
    console.log('HEAD: ' + r.body.slice(0, 400));
    let data = null; try { data = JSON.parse(r.body); } catch (e) {}
    if (data) {
      console.log('TOPKEYS: ' + JSON.stringify(Object.keys(data).slice(0, 20)));
      const evs = flatten(data);
      console.log('EVENTS: ' + evs.length);
      for (const ev of evs.slice(0, 8)) {
        const nm = Array.isArray(ev.eventNames) ? ev.eventNames.join(' - ') : String(ev.eventNames);
        console.log('  - ' + nm + ' | ' + ev.competitionName + ' | startTime=' + ev.startTime + ' (' + (ev.startTime ? new Date(Number(ev.startTime)).toISOString() : '-') + ')');
      }
    }
  }
})().catch(function (e) { console.log('ERR', e.message); });
