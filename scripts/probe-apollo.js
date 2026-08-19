#!/usr/bin/env node
// Probe Apollo pour diagnostiquer pourquoi listMatches retourne 0.
// Dump la réponse brute pour identifier si :
//  a) L'API renvoie du vide (endpoint cassé / changé de path)
//  b) L'API renvoie du contenu mais le parser rate (structure changée)
//  c) L'API renvoie une erreur HTTP silencieuse

import { apolloGet, APOLLO_SID } from '../src/bookmakers/apollo/api.js';

const sid = APOLLO_SID.football;
console.log(`Apollo sport ID football = ${sid}`);

// Test 1 : réponse brute /sport/offer/v3/sports (liste sports)
console.log('\n═══ Test 1 : GET /sport/offer/v3/sports (liste des sports) ═══');
const sports = await apolloGet('/sport/offer/v3/sports');
if (!sports) {
  console.log('❌ Réponse null (network/HTTP error)');
} else {
  console.log(`✅ Réponse recue, structure top-level : ${JSON.stringify(Object.keys(sports))}`);
  if (sports.Response && Array.isArray(sports.Response)) {
    console.log(`   Response array length = ${sports.Response.length}`);
    console.log(`   Premiers sports : ${JSON.stringify(sports.Response.slice(0, 3).map(s => ({ Id: s.Id, Name: s.Name })))}`);
  } else {
    console.log(`   Structure inattendue, dump complet :`);
    console.log(JSON.stringify(sports, null, 2).slice(0, 1000));
  }
}

// Test 2 : listMatches prématch (même query que production)
console.log('\n═══ Test 2 : GET /sport/offer/v3/sports/offer prématch (query prod) ═══');
const now = new Date().toISOString();
const dateTo = '2046-04-07T22:59:59.000Z';
const path = `/sport/offer/v3/sports/offer?Offset=0&Limit=200&DateFrom=${now}&DateTo=${dateTo}&SportIds=${sid}`;
console.log(`   URL: ${path}`);
const prematch = await apolloGet(path);
if (!prematch) {
  console.log('❌ Réponse null (network/HTTP error)');
} else {
  console.log(`✅ Réponse recue, structure top-level : ${JSON.stringify(Object.keys(prematch))}`);
  if (prematch.Response && Array.isArray(prematch.Response)) {
    console.log(`   Response length = ${prematch.Response.length}`);
    if (prematch.Response.length > 0) {
      const s = prematch.Response[0];
      console.log(`   Sport[0].Categories length = ${(s.Categories || []).length}`);
      if (s.Categories?.[0]) {
        const c = s.Categories[0];
        console.log(`   Category[0].Leagues length = ${(c.Leagues || []).length}`);
        if (c.Leagues?.[0]) {
          const l = c.Leagues[0];
          console.log(`   League[0].Matches length = ${(l.Matches || []).length}`);
          if (l.Matches?.[0]) {
            const m = l.Matches[0];
            console.log(`   Match[0] keys : ${JSON.stringify(Object.keys(m).slice(0, 15))}`);
            console.log(`   Match[0] sample : Id=${m.Id} TeamHome=${m.TeamHome} TeamAway=${m.TeamAway} MatchStartTime=${m.MatchStartTime}`);
          }
        }
      }
    } else {
      console.log(`   ⚠️ Response est un tableau vide`);
    }
  } else {
    console.log(`   Structure inattendue, dump 2 KB :`);
    console.log(JSON.stringify(prematch, null, 2).slice(0, 2000));
  }
}

// Test 3 : listMatches live (idem prod)
console.log('\n═══ Test 3 : GET /sport/offer/v3/sports/offer LIVE (query prod) ═══');
const nowLive = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
const pathLive = `/sport/offer/v3/sports/offer?Offset=0&Limit=200&DateFrom=${nowLive}&DateTo=${new Date().toISOString()}&SportIds=${sid}&Live=true`;
console.log(`   URL: ${pathLive}`);
const liveRes = await apolloGet(pathLive);
if (!liveRes) {
  console.log('❌ Réponse null (network/HTTP error)');
} else {
  console.log(`✅ Réponse recue, structure top-level : ${JSON.stringify(Object.keys(liveRes))}`);
  if (liveRes.Response && Array.isArray(liveRes.Response)) {
    let totalMatches = 0;
    for (const s of liveRes.Response) for (const c of s.Categories || []) for (const l of c.Leagues || []) totalMatches += (l.Matches || []).length;
    console.log(`   Total matches dans l arborescence : ${totalMatches}`);
  } else {
    console.log(`   Structure inattendue, dump 1 KB :`);
    console.log(JSON.stringify(liveRes, null, 2).slice(0, 1000));
  }
}

// Test 4 : essai avec un autre path historique (au cas où l'API a changé)
console.log('\n═══ Test 4 : essai path alternatif /sport/offer/v3/sports/offers ═══');
const pathAlt = `/sport/offer/v3/sports/offers?Offset=0&Limit=200&DateFrom=${now}&DateTo=${dateTo}&SportIds=${sid}`;
const alt = await apolloGet(pathAlt);
if (!alt) {
  console.log('❌ Réponse null');
} else {
  console.log(`✅ Structure top-level : ${JSON.stringify(Object.keys(alt))}`);
}

console.log('\nFin probe Apollo.');
process.exit(0);
