#!/usr/bin/env node
// PROBE MAXIBET SCRAPE.DO — teste render+super mode pour bypass CF
//
// Si render=true+super=true retourne le HTML rendu avec cotes, on a gagne :
// on peut fetch listing + pages detail avec tous marches via Scrape.do.

const KEY = process.env.SCRAPE_DO_KEY;
if (!KEY) { console.log('❌ SCRAPE_DO_KEY manquant'); process.exit(1); }
console.log(`▶ MAXIBET SCRAPE.DO PROBE (key: ${KEY.slice(0, 8)}...)\n`);

async function scrapedo(url, opts = '') {
  const target = encodeURIComponent(url);
  const scrapeUrl = `https://api.scrape.do/?token=${KEY}&url=${target}${opts}`;
  try {
    const res = await fetch(scrapeUrl, { signal: AbortSignal.timeout(60_000) });
    const t = await res.text();
    return { status: res.status, body: t, len: t.length };
  } catch (e) {
    return { status: 0, body: null, err: e.message };
  }
}

// ═══ 1. Test progressif : basic → render → render+super ═══
const target = 'https://m.maxibet.bet/fr/sports/prematch/Soccer';

console.log('══ 1. BASIC (no render, no super) ══');
const r1 = await scrapedo(target);
console.log(`  status=${r1.status} len=${r1.len} ${r1.body?.slice(0, 100)?.replace(/\s+/g, ' ')}`);

console.log('\n══ 2. RENDER (JS execution) ══');
const r2 = await scrapedo(target, '&render=true&waitUntil=networkidle0');
console.log(`  status=${r2.status} len=${r2.len} ${r2.body?.slice(0, 100)?.replace(/\s+/g, ' ')}`);

console.log('\n══ 3. RENDER + SUPER (CF bypass premium) ══');
const r3 = await scrapedo(target, '&render=true&super=true&waitUntil=networkidle0');
console.log(`  status=${r3.status} len=${r3.len} ${r3.body?.slice(0, 200)?.replace(/\s+/g, ' ')}`);
if (r3.body && r3.body.length > 5000) {
  // Cherche marches + cotes
  const cotesCount = (r3.body.match(/>\s*\d\.\d+\s*</g) || []).length;
  const marketMentions = ['Résultat', 'Double Chance', 'Handicap', 'Total', 'BTTS', '1re mi-temps'].map((m) => `${m}=${r3.body.includes(m)}`).join(' | ');
  console.log(`  cotes trouvees (pattern >X.XX<): ${cotesCount}`);
  console.log(`  marches presents: ${marketMentions}`);
  // Sample interessant
  const marketIdx = r3.body.indexOf('Résultat du match');
  if (marketIdx > 0) {
    console.log(`\n  Sample autour "Résultat du match":`);
    console.log(`  ${r3.body.slice(marketIdx, marketIdx + 800)}`);
  }
}

console.log('\n══ 4. GEO (test avec geoCode=us) ══');
const r4 = await scrapedo(target, '&render=true&super=true&geoCode=us&waitUntil=networkidle0');
console.log(`  status=${r4.status} len=${r4.len}`);

// ═══ 5. Test API endpoint direct (au cas ou super bypass permet direct) ═══
console.log('\n══ 5. TEST API PATTERNS via scrape.do super ══');
const apis = [
  'https://m.maxibet.bet/api/config',
  'https://api.maxibet.bet/prematch/soccer',
  'https://sports-api.maxibet.bet/api/v3/events/highlights?sportId=1',
];
for (const a of apis) {
  const r = await scrapedo(a, '&super=true');
  console.log(`  status=${r.status} len=${r.len} ${a}`);
}

console.log('\n▶ Fin.');
process.exit(0);
