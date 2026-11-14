// Sonde : champs disponibles sur un event LIVE PremierBet (startTime est null).
const BASE = 'https://sports-api.premierbet.com/cm/v1';
const PARAMS = { country: 'CM', group: 'g1', platform: 'desktop', locale: 'fr' };
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  Referer: 'https://www.premierbet.com/',
  Origin: 'https://www.premierbet.com',
};
async function get(path, extra) {
  const ps = new URLSearchParams(Object.assign({}, PARAMS, extra || {}));
  const r = await fetch(BASE + path + '?' + ps.toString(), { headers: HEADERS, signal: AbortSignal.timeout(25000) });
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch (e) { return { status: r.status, json: null, raw: t.slice(0, 300) }; }
}
function allEvents(body) {
  const out = [];
  const root = body && body.data ? body.data : body;
  for (const c of (root && root.categories) || []) {
    for (const k of c.competitions || []) {
      for (const ev of k.events || []) out.push({ cat: c.name, comp: k.name, compKeys: Object.keys(k), ev: ev });
    }
  }
  return out;
}
(async function () {
  console.log('NOW =', new Date().toISOString());
  const r = await get('/events/live', { sportId: '1' });
  const all = allEvents(r.json);
  console.log('pagination =', JSON.stringify(r.json && r.json.pagination));
  console.log('events =', all.length);
  if (all[0]) {
    console.log('COMPETITION KEYS =', JSON.stringify(all[0].compKeys));
    console.log('EVENT KEYS =', JSON.stringify(Object.keys(all[0].ev)));
    const e0 = Object.assign({}, all[0].ev);
    delete e0.markets;
    console.log('EVENT (sans markets) =', JSON.stringify(e0).slice(0, 1200));
  }
  // le detail d'un event donne-t-il l'heure de coup d'envoi ?
  const id = all[0] && all[0].ev && all[0].ev.id;
  if (id) {
    const variants = ['/events/' + id, '/events/' + id + '/details', '/event/' + id];
    for (const v of variants) {
      const d = await get(v, {});
      const j = d.json || {};
      const root = j.data ? j.data : j;
      console.log('');
      console.log('=== ' + v + ' status=' + d.status + ' keys=' + JSON.stringify(Object.keys(root).slice(0, 15)));
      console.log('   startTime=' + root.startTime + ' / ' + JSON.stringify({ start: root.startTime, begin: root.beginTime, date: root.date, time: root.startDate }));
    }
  }
})().catch(function (e) { console.log('ERR', e.message); });
