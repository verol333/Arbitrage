#!/usr/bin/env node
// Audit 1win : dump les outcomes bruts du marche 1MT BTTS pour verifier
// qu'on n'a PAS inverse yes/no dans le parseur.
// Le scan du 27/07 a montre 5 opps 40%+ toutes sur Hacken vs AIK 1MT BTTS,
// avec 1win "Non=3.75" contre 5 autres books "Oui=~3.00". Math impossible.

import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';

const MATCH_ID = process.argv[2] || '37642888'; // Hacken vs AIK par defaut

console.log(`=== Audit 1win outcomes bruts | match id=${MATCH_ID} ===\n`);
const oddsMap = await fetchOddsWS([Number(MATCH_ID)]);
const groups = oddsMap.get(Number(MATCH_ID));

if (!groups) {
  console.log('Aucune donnee retournee — event ID probablement expire ou live termine.');
  process.exit(1);
}

console.log(`Marches retournes : ${Object.keys(groups).length}`);
console.log(`\n--- Tous les groupes contenant "both teams" ou "btts" ---`);
for (const [name, list] of Object.entries(groups)) {
  if (!/both teams|btts/i.test(name)) continue;
  console.log(`\nGroupe: "${name}"`);
  for (const o of (list || [])) {
    console.log(`  outcome name="${o.name}" outcome="${o.outcome}" cf=${o.cf} status=${o.status}`);
  }
}

console.log(`\n--- Tous les groupes contenant "1st half" ---`);
for (const [name, list] of Object.entries(groups)) {
  if (!/1st half/i.test(name)) continue;
  console.log(`\nGroupe: "${name}"`);
  for (const o of (list || []).slice(0, 6)) {
    console.log(`  outcome name="${o.name}" outcome="${o.outcome}" cf=${o.cf} status=${o.status}`);
  }
}

process.exit(0);
