// Vérification RIGOUREUSE de la sémantique handicap SB LIVE :
// (1) Récupère un match live SB
// (2) Fetch cotes via productId=1 (LIVE) et productId=3 (PREMATCH endpoint)
// (3) Compare le handicap id=16 : mêmes valeurs = mapping stable (full match)
//     valeurs différentes = LIVE recalcule (rest of match)
// (4) Vérifie aussi id=1 (1X2), id=18 (Total), id=10 (DC) pour cohérence

const HDR = {
  'User-Agent': 'Mozilla/5.0 Chrome/151.0.0.0',
  'Accept': '*/*', 'Accept-Language': 'en',
  'Referer': 'https://www.sportybet.com/ng/sport/football/live',
  'Origin': 'https://www.sportybet.com',
  'Cookie': 'locale=en; device-id=b0671631-24f3-4e60-a281-117254ea1551; sb_country=ng',
  'clientid': 'web', 'operid': '2', 'platform': 'web',
};

const log = (m) => console.log(m);

async function fetch200(url) {
  const res = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(20_000) });
  return res.ok ? res.json() : null;
}

// 1. Liste live matches
log('\n═══════ VERIF SEMANTIQUE HANDICAP SB LIVE ═══════');
const listUrl = `https://www.sportybet.com/api/ng/factsCenter/liveOrPrematchEvents?sportId=sr%3Asport%3A1&_t=${Date.now()}`;
const listJson = await fetch200(listUrl);
const events = [];
for (const t of (listJson?.data || [])) for (const e of (t?.events || [])) events.push(e);
const live = events.filter((e) => e?.status === 1);
log(`[list] ${live.length} matchs live`);
if (!live.length) { log('Aucun match live, stop'); process.exit(0); }

// 2. Pour 3 matchs, dump handicap markets détaillés
for (const ev of live.slice(0, 3)) {
  log(`\n── ${ev.homeTeamName} vs ${ev.awayTeamName} — score=${ev.setScore} time=${ev.playedSeconds}`);

  // Fetch LIVE (productId=1)
  const liveJson = await fetch200(`https://www.sportybet.com/api/ng/factsCenter/event?eventId=${encodeURIComponent(ev.eventId)}&productId=1&_t=${Date.now()}`);
  const liveMarkets = liveJson?.data?.markets || [];

  // Fetch PREMATCH endpoint (productId=3) — pour comparaison
  const preJson = await fetch200(`https://www.sportybet.com/api/ng/factsCenter/event?eventId=${encodeURIComponent(ev.eventId)}&productId=3&_t=${Date.now()}`);
  const preMarkets = preJson?.data?.markets || [];

  log(`  LIVE (productId=1) : ${liveMarkets.length} markets`);
  log(`  PREMATCH (productId=3) : ${preMarkets.length} markets`);

  // Compare id=1 (1X2)
  const l1x2 = liveMarkets.find((m) => String(m.id) === '1');
  const p1x2 = preMarkets.find((m) => String(m.id) === '1');
  log(`  1X2 LIVE: ${l1x2 ? l1x2.outcomes.map((o) => `${o.desc}=${o.odds}`).join(' ') : 'ABSENT'}`);
  log(`  1X2 PRE:  ${p1x2 ? p1x2.outcomes.map((o) => `${o.desc}=${o.odds}`).join(' ') : 'ABSENT'}`);

  // Compare tous les id=16 (Asian Handicap) — plusieurs lignes possibles
  const liveHcps = liveMarkets.filter((m) => String(m.id) === '16');
  const preHcps = preMarkets.filter((m) => String(m.id) === '16');
  log(`\n  HANDICAP id=16 :`);
  log(`    ${liveHcps.length} lignes en LIVE, ${preHcps.length} en PREMATCH endpoint`);

  for (const hcp of liveHcps) {
    const spec = hcp.specifier || '';
    const outStr = (hcp.outcomes || []).map((o) => `${o.desc}=${o.odds}`).join(' ');
    log(`    LIVE  specifier="${spec}" desc="${hcp.desc || ''}" outcomes=[${outStr}]`);
  }
  for (const hcp of preHcps) {
    const spec = hcp.specifier || '';
    const outStr = (hcp.outcomes || []).map((o) => `${o.desc}=${o.odds}`).join(' ');
    log(`    PRE   specifier="${spec}" desc="${hcp.desc || ''}" outcomes=[${outStr}]`);
  }

  // Verdict semantique
  if (liveHcps.length && preHcps.length) {
    // Compare same specifier
    const sameSpec = liveHcps.find((h) => preHcps.some((p) => p.specifier === h.specifier));
    if (sameSpec) {
      const pMatch = preHcps.find((p) => p.specifier === sameSpec.specifier);
      const lOut = sameSpec.outcomes.map((o) => `${o.desc}=${o.odds}`).sort().join(',');
      const pOut = pMatch.outcomes.map((o) => `${o.desc}=${o.odds}`).sort().join(',');
      if (lOut === pOut) log(`    ➡️  MEMES COTES → mapping cross-book SAFE (full match semantic)`);
      else log(`    ⚠️  COTES DIFFERENTES pour specifier="${sameSpec.specifier}" → LIVE recalcule (rest of match)`);
    } else {
      log(`    ⚠️  Specifiers différents live vs prematch → semantic différente`);
    }
  } else {
    log(`    (Pas de comparaison possible : un des endpoints n'a pas de handicap)`);
  }

  // Compare id=18 (Total) sur ligne courante
  const l18 = liveMarkets.find((m) => String(m.id) === '18' && /total=2\.5/.test(m.specifier || ''));
  const p18 = preMarkets.find((m) => String(m.id) === '18' && /total=2\.5/.test(m.specifier || ''));
  if (l18 && p18) {
    const lOut = l18.outcomes.map((o) => `${o.desc}=${o.odds}`).join(' ');
    const pOut = p18.outcomes.map((o) => `${o.desc}=${o.odds}`).join(' ');
    log(`  TOTAL 2.5 LIVE: ${lOut}`);
    log(`  TOTAL 2.5 PRE:  ${pOut}`);
    log(`  ➡️  ${lOut === pOut ? 'MEMES' : 'DIFFERENTES'}`);
  }
}

log('\nDONE');
