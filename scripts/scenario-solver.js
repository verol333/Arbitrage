#!/usr/bin/env node
// SOLVEUR PAR SCENARIOS (recouvrements autorises).
//
// Rupture avec le scan par familles : on ne cherche plus une partition ou
// chaque issue est couverte une fois et une seule (somme des inverses > 1
// garantie chez un book correct, donc zero opportunite). Ici on autorise les
// jambes qui SE CHEVAUCHENT : plusieurs jambes peuvent gagner sur le meme
// scenario, et une jambe remboursee rend sa mise au lieu de la bruler.
//
// Methode : on enumere tous les deroules (score MT + score final), chaque
// marche lisible devient une fonction de paiement sur ces scenarios, puis on
// cherche la repartition de mises qui maximise le PIRE scenario. Si le pire
// scenario rend plus que la mise totale, le profit est garanti quoi qu'il
// arrive. Un scenario non couvert apparait immediatement comme pire cas
// negatif : aucun faux positif possible.
//
// Optimisation : jeu a somme nulle resolu par poids multiplicatifs (Hedge).
// Le joueur choisit une jambe, l'adversaire choisit le scenario le plus
// defavorable ; la moyenne des reponses converge vers l'optimum du pire cas.
//
// Lecture seule, ne place rien. Sortie : docs/scenario-solver.md
import { writeFileSync, mkdirSync } from 'node:fs';
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';
import { rawOutcomes, RAW_BOOKS } from '../src/foot/rawOutcomes.js';
import { strip } from '../src/foot/families.js';
import { buildScenarios, scenarioLabel } from '../src/foot/scenarios.js';
import { settler, isEarlyPayout } from '../src/foot/settle.js';

const TOP_MATCHES = Number(process.env.TOP_MATCHES || 10);
const HORIZON_HOURS = Number(process.env.HORIZON_HOURS || 48);
const MIN_PROFIT = Number(process.env.MIN_PROFIT || 0.5); // en %
const ITER = Number(process.env.ITER || 600);

const SC = buildScenarios();
const N = SC.length;

// ---------- construction des jambes ----------
// Une jambe = un pari disponible chez un book, avec son vecteur de paiement
// sur les N scenarios (cote si gagnant, 1 si rembourse, 0 si perdant).
function buildLegs(perBook, ref) {
  // Les cases "autre score" ont besoin de connaitre les scores deja listes
  // dans le meme marche chez le meme book.
  const siblings = new Map();
  for (const r of perBook) {
    for (const o of r.outcomes || []) {
      const k = r.key + '|' + strip(o.market);
      if (!siblings.has(k)) siblings.set(k, new Set());
      const re = /(\d+)\s*[:\-]\s*(\d+)/g;
      let m;
      while ((m = re.exec(String(o.selection)))) siblings.get(k).add(Number(m[1]) + ':' + Number(m[2]));
    }
  }

  const bySig = new Map(); // signature de paiement -> meilleure cote
  let parsed = 0, skipped = 0;

  for (const r of perBook) {
    if (r.error) continue;
    for (const o of r.outcomes || []) {
      const ctx = { home: ref.home, away: ref.away, line: o.line, siblingScores: siblings.get(r.key + '|' + strip(o.market)) };
      let fn;
      try { fn = settler(o.market, o.selection, ctx); } catch { fn = null; }
      if (!fn) { skipped++; continue; }
      const pay = new Float64Array(N);
      let sig = '';
      let wins = 0;
      for (let i = 0; i < N; i++) {
        let v;
        try { v = fn(SC[i]); } catch { v = null; }
        if (v !== 'W' && v !== 'L' && v !== 'V') { sig = ''; break; }
        pay[i] = v === 'W' ? o.odds : v === 'V' ? 1 : 0;
        if (v === 'W') wins++;
        sig += v === 'W' ? '1' : v === 'V' ? '2' : '0';
      }
      if (!sig || wins === 0 || wins === N) { skipped++; continue; }
      parsed++;
      const cur = bySig.get(sig);
      if (!cur || o.odds > cur.odds) {
        bySig.set(sig, { odds: o.odds, book: r.key, market: o.market, selection: o.selection, pay, early: isEarlyPayout(o.market, o.selection) });
      }
    }
  }
  return { legs: [...bySig.values()], parsed, skipped };
}

// ---------- optimisation du pire cas ----------
function solve(legs, iter = ITER) {
  if (!legs.length) return null;
  const M = Math.max(...legs.map((l) => l.odds));
  const w = new Float64Array(N).fill(1);
  const count = new Float64Array(legs.length);
  const eta = 0.9;

  for (let it = 0; it < iter; it++) {
    let sum = 0;
    for (let i = 0; i < N; i++) sum += w[i];
    // meilleure reponse : la jambe au meilleur rendement espere sous les poids
    let bestIdx = 0, bestVal = -Infinity;
    for (let k = 0; k < legs.length; k++) {
      const pay = legs[k].pay;
      let v = 0;
      for (let i = 0; i < N; i++) if (w[i]) v += (w[i] / sum) * pay[i];
      if (v > bestVal) { bestVal = v; bestIdx = k; }
    }
    count[bestIdx]++;
    const pay = legs[bestIdx].pay;
    for (let i = 0; i < N; i++) w[i] *= Math.exp(-eta * (pay[i] / M));
  }

  // mixture = repartition des mises (somme 1)
  let tot = 0;
  for (let k = 0; k < legs.length; k++) tot += count[k];
  let mix = legs.map((l, k) => ({ leg: l, x: count[k] / tot })).filter((e) => e.x > 0.004);
  let s = mix.reduce((a, e) => a + e.x, 0);
  mix = mix.map((e) => ({ ...e, x: e.x / s }));

  const worst = worstCase(mix);
  return { mix, ...worst };
}

function worstCase(mix) {
  let min = Infinity, argmin = 0;
  for (let i = 0; i < N; i++) {
    let v = 0;
    for (const e of mix) v += e.x * e.leg.pay[i];
    if (v < min) { min = v; argmin = i; }
  }
  return { worst: min, worstScenario: SC[argmin] };
}

// ---------- collecte ----------
console.log('=== SOLVEUR PAR SCENARIOS ===');
console.log(N + ' scenarios | ' + TOP_MATCHES + ' matchs | ' + ITER + ' iterations');

const catalogs = new Map();
for (const key of RAW_BOOKS) {
  const book = bookmakersByKey[key];
  if (!book) continue;
  try {
    const matches = await book.listMatches({ live: false, sport: 'football', horizonHours: HORIZON_HOURS });
    catalogs.set(key, matches);
    console.log('[' + key + '] ' + matches.length + ' matchs');
  } catch (e) {
    console.log('[' + key + '] listMatches KO : ' + e.message);
  }
}
const entries = alignCatalogs(catalogs, { minBooks: 1, horizonMs: Date.now() + HORIZON_HOURS * 3600 * 1000 });
entries.sort((a, b) => Object.keys(b.matches).length - Object.keys(a.matches).length || (a.ref.start || 0) - (b.ref.start || 0));
const targets = entries.slice(0, TOP_MATCHES);
console.log(entries.length + ' matchs apparies, ' + targets.length + ' retenus\n');

const results = [];

for (const entry of targets) {
  const label = entry.ref.home + ' vs ' + entry.ref.away;
  const perBook = await Promise.all(
    Object.entries(entry.matches)
      .filter(([k]) => RAW_BOOKS.includes(k))
      .map(async ([key, m]) => ({ key, ...(await rawOutcomes(key, m.id)) }))
  );
  const { legs, parsed, skipped } = buildLegs(perBook, entry.ref);
  const sol = legs.length ? solve(legs) : null;
  const profit = sol ? (sol.worst - 1) * 100 : null;
  console.log('- ' + label + ' : ' + parsed + ' paris regles / ' + skipped + ' ignores, ' +
    legs.length + ' jambes distinctes, pire cas ' + (sol ? sol.worst.toFixed(4) : 'n/a'));
  results.push({ label, parsed, skipped, legs: legs.length, sol, profit, books: perBook.filter((r) => r.outcomes?.length).map((r) => r.key) });
}

// ---------- rapport ----------
results.sort((a, b) => (b.profit ?? -999) - (a.profit ?? -999));
const md = ['# Solveur par scenarios (recouvrements autorises)', '',
  'Genere le ' + new Date().toISOString(), '',
  'Espace : ' + N + ' scenarios (score MT x score final, cap 7 buts). Le pire cas est le rendement garanti ' +
  'pour 1 unite misee au total : au-dessus de 1.00 le profit est certain.', ''];

const winners = results.filter((r) => r.profit != null && r.profit >= MIN_PROFIT);
md.push('## Opportunites (pire cas > mise)', '');
if (!winners.length) {
  md.push('Aucune combinaison ne garantit un rendement superieur a la mise sur cet echantillon.');
} else {
  for (const r of winners) {
    md.push('### ' + r.label + ' — profit garanti ' + r.profit.toFixed(2) + '%', '');
    // Colonne de controle : ce que chaque jambe rapporte DANS le pire scenario.
    // Une jambe declaree gagnante sur un scenario ou elle devrait perdre saute
    // immediatement aux yeux (c'est ainsi qu'on traque les fuites de reglage).
    const wi = SC.indexOf(r.sol.worstScenario);
    md.push('| Part de mise | Book | Cote | Marche | Selection | Pire scenario |');
    md.push('|---:|---|---:|---|---|---|');
    for (const e of r.sol.mix.sort((a, b) => b.x - a.x)) {
      const p = wi >= 0 ? e.leg.pay[wi] : null;
      const verdict = p == null ? '?' : p > 1.0001 ? 'GAGNE' : p > 0.0001 ? 'rembourse' : 'perd';
      md.push('| ' + (e.x * 100).toFixed(1) + '% | ' + e.leg.book + ' | ' + e.leg.odds + ' | ' +
        String(e.leg.market).replace(/\|/g, '/').slice(0, 34) + ' | ' +
        String(e.leg.selection).replace(/\|/g, '/').slice(0, 34) + (e.leg.early ? ' *(2UP)*' : '') + ' | ' + verdict + ' |');
    }
    md.push('', 'Pire scenario : ' + scenarioLabel(r.sol.worstScenario), '');
  }
}

md.push('', '## Tous les matchs (pire cas atteint)', '');
md.push('| Match | Books lus | Paris regles | Ignores | Jambes | Pire cas | Ecart |');
md.push('|---|---|---:|---:|---:|---:|---:|');
for (const r of results) {
  md.push('| ' + r.label + ' | ' + r.books.join(', ') + ' | ' + r.parsed + ' | ' + r.skipped + ' | ' + r.legs +
    ' | ' + (r.sol ? r.sol.worst.toFixed(4) : 'n/a') + ' | ' + (r.profit != null ? r.profit.toFixed(2) + '%' : 'n/a') + ' |');
}
md.push('', 'Note : les marches statistiques, joueurs et intervalles de temps sont hors de cet espace ' +
  'de scenarios et comptent dans la colonne "Ignores". Les marches 2UP sont regles au pire cas ' +
  '(comme un 1X2 simple), leur gain reel ne peut donc qu etre superieur.', '');

mkdirSync('docs', { recursive: true });
writeFileSync('docs/scenario-solver.md', md.join('\n'));
console.log('\nRapport : docs/scenario-solver.md');
