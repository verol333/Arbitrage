#!/usr/bin/env node
// Dict Apollo v3 : dump BetTypeInfo + BaseHeader qui contiennent les vrais noms
import { fetchJson } from '../src/net/fetcher.js';

const SPORT_API = 'https://sportapis-apollo.webapis.sk/SportsOfferApi/api';
const HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Origin: 'https://m.apollogames.cg',
  Referer: 'https://m.apollogames.cg/',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
};

const apolloGet = (path) => fetchJson(`${SPORT_API}${path}`, { headers: HEADERS, timeoutMs: 20000 });

const now = new Date().toISOString();
const dateTo = '2046-01-01T00:00:00.000Z';
const list = await apolloGet(`/sport/offer/v3/sports/offer?Offset=0&Limit=200&DateFrom=${now}&DateTo=${dateTo}&SportIds=389`);
const allMatches = [];
for (const s of list?.Response || []) for (const c of s.Categories || []) for (const l of c.Leagues || []) for (const m of l.Matches || []) {
  if (!m.Id || !m.TeamHome || !m.TeamAway) continue;
  allMatches.push({ id: m.Id, home: m.TeamHome, away: m.TeamAway, league: `${c.Name} / ${l.Name}` });
}

// Fetch 1 seul match — on va dumper les 26 offers avec BetTypeInfo complet
const m = allMatches[0];
console.log(`Match : ${m.home} vs ${m.away}\n`);
const raw = await apolloGet(`/sport/offer/v3/match/offers?MatchId=${m.id}&IncludeBetTypeNames=true`);

// BaseHeader dump
console.log(`═══ BaseHeader ═══`);
console.log(JSON.stringify(raw.BaseHeader, null, 2));

// Dump each offer with FULL BetTypeInfo
console.log(`\n═══ Chaque offer avec BetTypeInfo complet ═══\n`);
const offers = raw.Offers || [];
for (const o of offers) {
  const key = o.BetTypeKey;
  console.log(`\n──────── BetTypeKey=${key} ────────`);
  console.log(`  Description : "${o.Description}"`);
  console.log(`  OriginDescription : "${o.OriginDescription}"`);
  console.log(`  Sbv : ${o.Sbv ?? '(vide)'}`);
  console.log(`  BaseLine : ${o.BaseLine ?? '(vide)'}`);
  console.log(`  BetTypeClassId : ${o.BetTypeClassId}`);
  console.log(`  BetTypeCategories : ${JSON.stringify(o.BetTypeCategories)}`);
  console.log(`  BetTypeInfo :`);
  console.log(`    ${JSON.stringify(o.BetTypeInfo, null, 2).replace(/\n/g, '\n    ')}`);
  console.log(`  Odds (${(o.Odds || []).length}) :`);
  for (const od of (o.Odds || []).slice(0, 5)) {
    console.log(`    ${JSON.stringify(od)}`);
  }
}
