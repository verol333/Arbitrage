// Sonde Betika (api-cd.betika.com, skin Congo) : decouvre les sport_id du skin
// pour basket/hockey/volleyball + dump les sub_type_id et structure des marches
// afin d'ecrire les parseurs deterministes (meme methode que le foot/tennis).
// Autonome (Node 20 fetch natif).
const BASE = 'https://api-cd.betika.com';
const HDR = { accept: 'application/json', 'accept-language': 'fr', origin: 'https://www.betika.com', referer: 'https://www.betika.com/', 'user-agent': 'Mozilla/5.0' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (m) => console.log(m);

async function getJson(url, timeoutMs = 20000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try { const res = await fetch(url, { headers: HDR, signal: ctrl.signal }); if (!res.ok) return null; return await res.json(); } catch { return null; } finally { clearTimeout(t); }
}

// Phase 1 : balayage sport_id 1..30 pour identifier les sports par nom de competition.
log('=== PHASE 1 : decouverte des sport_id ===');
const found = {};
for (let id = 1; id <= 30; id++) {
  const j = await getJson(BASE + '/v1/uo/matches?page=1&limit=20&sport_id=' + id + '&tab=upcoming');
  const arr = j?.data || [];
  if (!arr.length) { log('  id=' + id + ' -> vide'); continue; }
  const comps = [...new Set(arr.map(e => String(e.competition_name || e.category || '').trim()).filter(Boolean))].slice(0, 3);
  const sample = arr[0];
  log('  id=' + id + ' -> ' + arr.length + ' matchs | comps=[' + comps.join(', ') + '] | ex: ' + (sample.home_team || '') + ' vs ' + (sample.away_team || ''));
  const blob = (comps.join(' ') + ' ' + (sample.home_team||'') + ' ' + (sample.away_team||'')).toLowerCase();
  if (/basket|nba|euroleague/.test(blob)) found.basket = id;
  else if (/hockey|nhl|khl/.test(blob)) found.hockey = id;
  else if (/volley|volleyball/.test(blob)) found.volleyball = id;
  await sleep(300);
}
log('Identifies: ' + JSON.stringify(found));

// Phase 2 : pour chaque sport trouve, dump les sub_type_id d'un match reel.
for (const [sport, sid] of Object.entries(found)) {
  log('\n========================================');
  log('=== ' + sport.toUpperCase() + ' (sport_id=' + sid + ') ===');
  const lj = await getJson(BASE + '/v1/uo/matches?page=1&limit=20&sport_id=' + sid + '&tab=upcoming');
  const arr = lj?.data || [];
  if (!arr.length) { log('Aucun match'); continue; }
  const pmid = arr[0].parent_match_id;
  log('Match sonde: ' + arr[0].home_team + ' vs ' + arr[0].away_team + ' (parent_match_id=' + pmid + ')');
  const mj = await getJson(BASE + '/v1/uo/match?parent_match_id=' + pmid);
  const markets = mj?.data || [];
  log('Marches: ' + markets.length);
  const bySub = {};
  for (const m of markets) {
    const st = m.sub_type_id; if (st == null) continue;
    if (!bySub[st]) bySub[st] = { name: m.name, odds: [] };
    for (const o of (m.odds || []).slice(0, 4)) bySub[st].odds.push({ display: o.display, odd_def: o.odd_def, sbv: o.special_bet_value, odd: o.odd_value });
  }
  const keys = Object.keys(bySub).map(Number).sort((a,b)=>a-b);
  log('sub_type_id distincts: ' + keys.length);
  for (const st of keys) log('  sub_type_id=' + st + '  name="' + bySub[st].name + '"  odds=' + JSON.stringify(bySub[st].odds));
}
log('\n=== FIN SONDE ===');
