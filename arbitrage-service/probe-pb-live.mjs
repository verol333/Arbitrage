// Sonde : recuperer l'heure de coup d'envoi des matchs LIVE PremierBet
// (startTime est null dans /events/live). Deux pistes testees :
//   1) la meme affiche vue dans le catalogue a venir (meme id) ;
//   2) la deduction depuis le scoreboard (period + minute).
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
  try { return await r.json(); } catch (e) { return null; }
}
function events(body) {
  const out = [];
  const root = body && body.data ? body.data : body;
  for (const c of (root && root.categories) || []) for (const k of c.competitions || []) for (const ev of k.events || []) out.push(ev);
  return out;
}
function elapsedMin(sb) {
  if (!sb) return null;
  const period = String(sb.period || '').toUpperCase();
  const minute = Number(sb.minute);
  if (!Number.isFinite(minute) && !period) return null;
  const m = Number.isFinite(minute) ? minute : 0;
  if (period === '1P' || period === 'H1') return m;
  if (period === 'HT' || period === 'P') return 45 + m;
  if (period === '2P' || period === 'H2') return 45 + m;
  if (period === 'ET' || period === 'ET1') return 90 + m;
  if (period === 'ET2') return 105 + m;
  return null;
}
(async function () {
  const now = Date.now();
  console.log('NOW =', new Date(now).toISOString());
  const live = events(await get('/events/live', { sportId: '1' }));
  console.log('live events =', live.length);
  const map = new Map();
  const today = new Date(now).toISOString().slice(0, 10);
  const yday = new Date(now - 86400000).toISOString().slice(0, 10);
  for (const d of [yday, today]) {
    const ups = events(await get('/events/upcoming', { sportId: '1', timeOffset: '-60', date: d }));
    let withStart = 0;
    for (const ev of ups) if (ev.startTime) { withStart++; map.set(String(ev.id), Number(ev.startTime)); }
    console.log('upcoming ' + d + ' : ' + ups.length + ' events, ' + withStart + ' avec startTime');
  }
  let inMap = 0; let byScore = 0; let neither = 0; const rows = [];
  for (const ev of live) {
    const id = String(ev.id);
    const sb = ev.scoreboard || {};
    const el = elapsedMin(sb);
    const derived = el == null ? null : now - el * 60000;
    const known = map.get(id) || null;
    if (known) inMap++; else if (derived) byScore++; else neither++;
    if (rows.length < 14) {
      rows.push({
        nm: (ev.eventNames || []).join(' - '),
        period: sb.period, minute: sb.minute,
        known: known ? new Date(known).toISOString() : null,
        derived: derived ? new Date(derived).toISOString() : null,
        ecartMin: known && derived ? Math.round((derived - known) / 60000) : null,
      });
    }
  }
  console.log('couverture : catalogue=' + inMap + ' deduction=' + byScore + ' aucune=' + neither + ' / total=' + live.length);
  for (const r of rows) console.log(JSON.stringify(r));
})().catch(function (e) { console.log('ERR', e.message); });
