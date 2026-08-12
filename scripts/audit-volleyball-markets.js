// Probe API Betclic (offer.cdn.betclic.fr) — découverte structure endpoints foot.
// Test direct fetch (sans Byparr) puis via Byparr si besoin.
const BC_HDR = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  'Origin': 'https://www.betclic.fr',
  'Referer': 'https://www.betclic.fr/',
};

async function fetch1(label, url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: BC_HDR, signal: AbortSignal.timeout(15000) });
    const txt = await res.text().catch(() => '');
    console.log(`[${label}] HTTP=${res.status} size=${txt.length}b (${Date.now()-t0}ms)`);
    return { status: res.status, body: txt };
  } catch (e) {
    console.log(`[${label}] ERR ${e.message}`);
    return null;
  }
}

async function fetchJSON(label, url) {
  const r = await fetch1(label, url);
  if (!r || r.status !== 200) return null;
  try { return JSON.parse(r.body); } catch { console.log(`  ${label} : not JSON, preview: ${r.body.slice(0,200)}`); return null; }
}

(async () => {
  const base = 'https://offer.cdn.betclic.fr/api/pub/v2';
  const qp = 'application=2&countrycode=fr&language=fr&sitecode=frfr';

  // Étape 1 : lister les sports
  console.log('\n=== Étape 1 : SPORTS list ===');
  const sports = await fetchJSON('sports', `${base}/sports?${qp}`);
  if (Array.isArray(sports)) {
    sports.forEach((s) => console.log(`  id=${s.id} name="${s.name}" comps=${s.competition_count || '?'}`));
  } else if (sports) {
    console.log('  keys:', Object.keys(sports));
    console.log('  preview:', JSON.stringify(sports).slice(0, 500));
  }

  // Étape 2 : chercher le sport football (id probablement = 1)
  console.log('\n=== Étape 2 : FOOTBALL competitions ===');
  for (const sid of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const j = await fetchJSON(`sport/${sid}/competitions`, `${base}/sports/${sid}/competitions?${qp}`);
    if (Array.isArray(j) && j.length) {
      console.log(`  sportId=${sid}: ${j.length} compétitions`);
      j.slice(0, 5).forEach((c) => console.log(`    id=${c.id} name="${c.name}" matches=${c.match_count || '?'}`));
      break;
    } else if (j) {
      console.log(`  sportId=${sid}: keys=${Object.keys(j).join(',')}`);
    }
  }

  // Étape 3 : essayons v3 aussi
  console.log('\n=== Étape 3 : v3 endpoints ===');
  const base3 = 'https://offer.cdn.betclic.fr/api/pub/v3';
  await fetch1('v3 sports', `${base3}/sports?${qp}`);
  await fetch1('v3 sports/football', `${base3}/sports/football?${qp}`);
  await fetch1('v3 sports/1/matches', `${base3}/sports/1/matches?${qp}`);

  // Étape 4 : essai endpoint "top matches" ou "highlights"
  console.log('\n=== Étape 4 : autres endpoints candidats ===');
  await fetch1('matches upcoming', `${base}/matches/upcoming?${qp}&sportId=1`);
  await fetch1('sports/1/matches', `${base}/sports/1/matches?${qp}`);
  await fetch1('matches', `${base}/matches?${qp}&sportId=1`);
  await fetch1('events', `${base}/events?${qp}&sportId=1`);
  await fetch1('sports/football-sfootball', `${base}/sports/football-sfootball?${qp}`);

  process.exit(0);
})();
