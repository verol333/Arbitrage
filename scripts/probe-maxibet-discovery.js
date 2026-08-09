#!/usr/bin/env node
// PROBE MAXIBET DISCOVERY — reconnaissance complete
// Objectif : identifier voie d'acces prematch foot pour maxibet.bet
//
// Strategies testees :
//   1. Direct HTTPS (fetchJson) — probable 403 CF
//   2. Stealth got-scraping (stealthGetJson) — rotation fingerprint
//   3. Jina reader proxy (r.jina.ai) — sans cle, retourne HTML text
//   4. Endpoints candidats standards (SportRadar, Digitain, Betsson, BetConstruct)
//
// Sortie : HTML sample + endpoints qui repondent + urls API decouvertes.

import { stealthGetJson } from '../src/net/stealth.js';
import { fetchJson } from '../src/net/fetcher.js';
import { gotScraping } from 'got-scraping';

console.log('▶ PROBE MAXIBET DISCOVERY\n');

// Helper : GET raw text avec got-scraping (comme stealthGet mais renvoie body brut)
async function stealthGetText(url, timeoutMs = 20_000) {
  try {
    const res = await gotScraping({
      url,
      timeout: { request: timeoutMs },
      retry: { limit: 0 },
      throwHttpErrors: false,
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 126 }],
        devices: ['desktop'],
        locales: ['fr-FR'],
        operatingSystems: ['linux'],
      },
    });
    return { status: res.statusCode, body: res.body, headers: res.headers };
  } catch (e) {
    return { status: 0, body: null, err: e.message };
  }
}

async function jinaReader(url, timeoutMs = 30_000) {
  // r.jina.ai/{url} → HTML lisible (Jina fait un headless internal)
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'X-Return-Format': 'text', 'Accept': '*/*' },
    });
    if (!res.ok) return { status: res.status, body: null };
    const t = await res.text();
    return { status: res.status, body: t };
  } catch (e) {
    return { status: 0, body: null, err: e.message };
  }
}

// ═══ 1. Home page — detection protection ═══
console.log('══ 1. HOME PAGE (detect protection) ══');
const home = await stealthGetText('https://m.maxibet.bet/');
console.log(`  stealth m.maxibet.bet/ → status=${home.status} bodyLen=${home.body?.length || 0}`);
if (home.body) {
  const cf = /cloudflare|cf-ray|__cf/i.test(home.body);
  const aka = /akamai/i.test(home.body);
  const dd = /datadome/i.test(home.body);
  const cfChallenge = /cf-challenge|cf_chl|challenge-platform/i.test(home.body);
  console.log(`  Protection : CF=${cf} CF-challenge=${cfChallenge} Akamai=${aka} DataDome=${dd}`);
  console.log(`  Server header : ${home.headers?.server || '?'}`);
  console.log(`  Body sample first 500:\n    ${home.body.slice(0, 500).replace(/\n/g, ' | ')}`);
  // Cherche URLs API dans le HTML
  const apiUrls = new Set();
  for (const m of home.body.matchAll(/https?:\/\/[^"'\s<>]*(?:api|sport|feed|odds|event|betting|graph)[^"'\s<>]*/gi)) apiUrls.add(m[0].slice(0, 200));
  for (const m of home.body.matchAll(/["'](\/api\/[^"'\s]+)["']/gi)) apiUrls.add(m[1]);
  for (const m of home.body.matchAll(/["'](\/services\/[^"'\s]+)["']/gi)) apiUrls.add(m[1]);
  for (const m of home.body.matchAll(/["'](\/graphql[^"'\s]*)["']/gi)) apiUrls.add(m[1]);
  console.log(`\n  URLs API-like trouvees (${apiUrls.size}) :`);
  [...apiUrls].slice(0, 30).forEach((u) => console.log(`    - ${u}`));
  // Cherche hydration data
  const nextData = home.body.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]{0,5000})/);
  if (nextData) {
    console.log(`\n  __NEXT_DATA__ present (${nextData[1].length}B)`);
    const conf = nextData[1].match(/"(?:apiUrl|baseUrl|api|apiBase|apiHost|host)":"([^"]+)"/g);
    if (conf) conf.slice(0, 10).forEach((c) => console.log(`    → ${c}`));
  }
  const winConf = home.body.match(/window\.(?:__|_)(?:CONFIG|INITIAL_STATE|DATA)\s*=\s*({[\s\S]{0,2000}?})[;<]/);
  if (winConf) console.log(`\n  window.__CONFIG present, sample:\n    ${winConf[1].slice(0, 800)}`);
}

// ═══ 2. Jina reader fallback (bypass CF via r.jina.ai) ═══
console.log('\n══ 2. JINA READER (r.jina.ai fallback) ══');
const jinaHome = await jinaReader('https://m.maxibet.bet/fr/sports/pre-match/event-view/Soccer');
console.log(`  jina → status=${jinaHome.status} bodyLen=${jinaHome.body?.length || 0}`);
if (jinaHome.body) {
  console.log(`  Sample first 800:\n${jinaHome.body.slice(0, 800)}`);
  // Cherche noms d'équipes / matchs dans le rendu
  const teamLines = jinaHome.body.match(/^.+\s+vs?\.?\s+.+$/gmi)?.slice(0, 10);
  if (teamLines) {
    console.log(`\n  Lignes "X vs Y" trouvees :`);
    teamLines.forEach((l) => console.log(`    - ${l.trim().slice(0, 100)}`));
  }
}

// ═══ 3. Endpoints candidats (SportRadar/Digitain/BetConstruct) ═══
console.log('\n══ 3. ENDPOINTS API CANDIDATS ══');
const candidates = [
  // SportRadar UOF (PremierBet-like)
  'https://sports-api.maxibet.bet/br/api/v3/events/highlights?sportId=1',
  'https://api.maxibet.bet/br/api/v3/events/highlights?sportId=1',
  'https://api.maxibet.bet/api/v3/events/highlights?sportId=1',
  'https://m.maxibet.bet/api/v3/events/highlights?sportId=1',
  // Digitain
  'https://m.maxibet.bet/api/config',
  'https://m.maxibet.bet/api/sports',
  'https://m.maxibet.bet/services/Get',
  // BetConstruct
  'https://m.maxibet.bet/services/getBetTypes',
  // Betsson/Betsson-like
  'https://m.maxibet.bet/api/prematch/events?sport=soccer',
  'https://api.maxibet.bet/prematch/soccer',
  // Deviner : /fr/sports/pre-match/event-view/Soccer → /fr/api/sports/pre-match/soccer
  'https://m.maxibet.bet/fr/api/sports/pre-match/soccer',
  'https://m.maxibet.bet/api/sports/pre-match/soccer',
  // GraphQL commun
  'https://m.maxibet.bet/graphql',
];
for (const u of candidates) {
  const r = await stealthGetText(u, 12_000);
  const preview = r.body ? r.body.slice(0, 100).replace(/\s+/g, ' ') : '';
  console.log(`  status=${r.status} len=${r.body?.length || 0} ${u.slice(0, 70)}${preview ? ' | ' + preview : ''}`);
}

console.log('\n▶ Fin.');
process.exit(0);
