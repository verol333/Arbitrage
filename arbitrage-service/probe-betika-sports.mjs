// Sonde Betika (skin Congo) — phase 2 : confirmer sport_id=2 (handball vs
// basket ?) et balayer 31..60 pour trouver basket/hockey/volley.
const BASE = 'https://api-cd.betika.com';
const HDR = { accept: 'application/json', 'accept-language': 'fr', origin: 'https://www.betika.com', referer: 'https://www.betika.com/', 'user-agent': 'Mozilla/5.0' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (m) => console.log(m);
async function getJson(url, timeoutMs = 20000) { const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs); try { const res = await fetch(url, { headers: HDR, signal: ctrl.signal }); if (!res.ok) return null; return await res.json(); } catch { return null; } finally { clearTimeout(t); } }

log('=== sport_id=2 : TOUTES les competitions (limit=100) ===');
const j2 = await getJson(BASE + '/v1/uo/matches?page=1&limit=100&sport_id=2&tab=upcoming');
const arr2 = j2?.data || [];
log('Matchs: ' + arr2.length);
const comps2 = {};
for (const e of arr2) { const c = String(e.competition_name || e.category || '').trim(); if (c) comps2[c] = (comps2[c]||0)+1; }
log('Competitions distinctes (' + Object.keys(comps2).length + '):');
for (const [c, n] of Object.entries(comps2)) log('  [' + n + '] ' + c);
const blob2 = Object.keys(comps2).join(' ').toLowerCase();
log('Contient "basket": ' + /basket/.test(blob2) + ' | "handball": ' + /handball/.test(blob2) + ' | "volley": ' + /volley/.test(blob2) + ' | "hockey": ' + /hockey/.test(blob2));

log('\n=== Balayage 31..60 ===');
for (let id = 31; id <= 60; id++) {
  const j = await getJson(BASE + '/v1/uo/matches?page=1&limit=10&sport_id=' + id + '&tab=upcoming');
  const arr = j?.data || [];
  if (arr.length) { const comps = [...new Set(arr.map(e => String(e.competition_name||'').trim()).filter(Boolean))].slice(0,3); log('  id=' + id + ' -> ' + arr.length + ' | comps=[' + comps.join(', ') + '] | ' + arr[0].home_team + ' vs ' + arr[0].away_team); }
  await sleep(200);
}
log('\n=== FIN ===');
