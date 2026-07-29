#!/usr/bin/env node
// Probe des marques utilisant BtoBet (meme backend/cotes que PremierBet)
// L'objectif : trouver un book moins protege qui expose la meme API BtoBet
// pour recuperer les cotes de PremierBet indirectement.

import { gotScraping } from 'got-scraping';

const BRANDS = [
  // EDITEC brands (memes cotes PremierBet)
  'https://www.bet237.cm',       // Cameroun
  'https://www.bet237.com',
  'https://www.sba.mg',          // Madagascar (SBA)
  'https://www.guineegames.com', // Guinee
  'https://www.rnsbetting.com',  // R&S Betting
  'https://www.mercurybet.sl',   // Sierra Leone
  'https://www.cogelo.com',
  // Autres BtoBet Africa
  'https://www.premierbetzone.com',      // PremierBet zone
  'https://sports.premierbet.co.tz',     // Tanzania
  'https://www.premierbet.ao',           // Angola
  'https://www.premierbet.gh',           // Ghana
  'https://sports.premierbet.co.ke',     // Kenya
];

// Endpoints BtoBet standards
const BTOBET_PATHS = [
  '/api/sportsbook/prematch/events',
  '/api/sportsbook/live/events',
  '/api/v3/sport/events',
  '/api/v3/prematch',
  '/dataservices/api/v1/events',
  '/dataservices/prematch',
  '/api/betradar/events',
  '/api/matches',
];

async function fetchText(url) {
  try {
    const r = await gotScraping({
      url,
      headers: { accept: 'text/html,application/json,*/*', 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8' },
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120 }],
        devices: ['desktop'], locales: ['fr-FR'], operatingSystems: ['linux'],
      },
      timeout: { request: 10_000 },
      retry: { limit: 0 },
      throwHttpErrors: false,
      responseType: 'text',
    });
    const body = r.body || '';
    return {
      status: r.statusCode,
      size: body.length,
      isCf: /cloudflare|just a moment|attention required|access restricted|access denied/i.test(body.slice(0, 800)),
      hasBtoBet: /btobet|editec|neogames|aspire.global/i.test(body),
      hasBetradar: /betradar|sportradar/i.test(body),
      isJson: body.trim().startsWith('{') || body.trim().startsWith('['),
      snippet: body.slice(0, 200).replace(/\s+/g, ' '),
    };
  } catch (e) {
    return { status: 0, err: e.message };
  }
}

for (const brand of BRANDS) {
  console.log(`\n═══ ${brand} ═══`);
  const home = await fetchText(brand + '/');
  const flags = [
    home.status === 200 ? 'OK' : `${home.status}`,
    home.isCf ? 'CF-BLOCK' : '',
    home.hasBtoBet ? '★BtoBet' : '',
    home.hasBetradar ? 'Sportradar' : '',
    home.isJson ? 'JSON' : '',
  ].filter(Boolean).join(' ');
  console.log(`  / → ${flags} size=${home.size}`);
  if (home.status !== 200 || home.isCf) {
    if (home.snippet) console.log(`  ↳ ${home.snippet}`);
    continue;
  }
  // Test BtoBet endpoints
  for (const path of BTOBET_PATHS) {
    const r = await fetchText(brand + path);
    if (r.status === 404 || r.status === 0) continue;
    console.log(`  ${path} → ${r.status} ${r.isJson ? 'JSON' : ''} size=${r.size}`);
    if (r.isJson && r.size > 100) {
      console.log(`    ↳ ${r.snippet}`);
    }
  }
}

process.exit(0);
