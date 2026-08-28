#!/usr/bin/env node
// POURQUOI 1xBET SE TAIT SUR LES MARCHES PAR SET (tennis) — lecture seule.
//
// Constat du recensement du 28/08/2026 : 1xBet est apparie sur 37/45 matchs mais
// ne remonte AUCUNE cote de set sur 25 d'entre eux, alors qu'il en expose une
// cinquantaine sur les autres. Trois causes possibles, une seule mesure les
// separe :
//   A. la requete echoue (proxys satures : 406/429) -> rien a decoder
//   B. la reponse arrive mais ne contient aucun sous-jeu (SG vide)
//   C. les sous-jeux existent mais leur libelle n'est pas reconnu comme un set
//      par setNumber() -> ils sont ignores en silence
//
// Ce script rejoue la lecture brute match par match et classe chaque silence.
// Aucune cote ecrite, aucun pari place.
// Rapport : docs/xbet-tennis-silence.md
import { writeFileSync, mkdirSync } from 'node:fs';
import xbet from '../src/bookmakers/xbet/index.js';
import { FEED, COUNTRY, viaWorker } from '../src/bookmakers/xbet/api.js';

const MATCHES = parseInt(process.env.XS_MATCHES || '25', 10);
const HORIZON = parseInt(process.env.XS_HORIZON || '48', 10);
// XS_WHERE : head = tete de liste (grands tournois), tail = bas de liste
// (longue traine : ITF, juniors, doubles obscurs), all = echantillon reparti.
const WHERE = process.env.XS_WHERE || 'head';

const out = [];
function say(s) { console.log(s); out.push(s); }

// Copie fidele de setNumber() de src/bookmakers/xbet/odds.js — on teste
// EXACTEMENT le filtre en production, sans le modifier.
function setNumber(label) {
  const l = String(label).toLowerCase();
  let m = l.match(/([1-5])\s*(?:er|re|ere|ème|eme|e|st|nd|rd|th)?\s*(?:set|manche)/);
  if (m) return Number(m[1]);
  m = l.match(/(?:set|manche)\s*([1-5])/);
  if (m) return Number(m[1]);
  return null;
}

function zipUrl(id) {
  return FEED + '/service-api/LineFeed/GetGameZip?id=' + id
    + '&lng=fr&isSubGames=true&GroupEvents=true&countevents=2000&grMode=4&country='
    + COUNTRY + '&marketType=1&isNewBuilder=true';
}

(async function main() {
  say('# 1xBet tennis : anatomie du silence par set');
  say('');
  say('Genere le ' + new Date().toISOString());
  say('');

  const matches = await xbet.listMatches({ sport: 'tennis', live: false, horizonHours: HORIZON });
  say('Matchs tennis listes par 1xBet : ' + matches.length + ' — sonde sur ' + Math.min(MATCHES, matches.length) + '.');
  say('');

  const rows = [];
  const unknownLabels = new Map();
  const tally = { ok: 0, fetch_fail: 0, sg_empty: 0, label_unmatched: 0 };

  let panel;
  if (WHERE === 'tail') panel = matches.slice(-MATCHES);
  else if (WHERE === 'all') {
    const step = Math.max(1, Math.floor(matches.length / MATCHES));
    panel = [];
    for (let k = 0; k < matches.length && panel.length < MATCHES; k += step) panel.push(matches[k]);
  } else panel = matches.slice(0, MATCHES);
  say('Segment sonde : ' + WHERE + '.');
  say('');
  for (let i = 0; i < panel.length; i += 4) {
    const slice = panel.slice(i, i + 4);
    const res = await Promise.all(slice.map(async (m) => {
      const gd = await viaWorker(zipUrl(m.id));
      if (!gd || !gd.Value) return { m: m, cause: 'fetch_fail', sg: 0, sets: [], labels: [] };
      const SG = gd.Value.SG || [];
      const labels = SG.map(function (sg) {
        return { txt: ((sg.PN || '') + ' | ' + (sg.TG || '')).trim(), set: setNumber((sg.PN || '') + ' ' + (sg.TG || '')) };
      });
      const sets = labels.filter(function (l) { return l.set; }).map(function (l) { return l.set; });
      let cause = 'ok';
      if (!SG.length) cause = 'sg_empty';
      else if (!sets.length) cause = 'label_unmatched';
      return { m: m, cause: cause, sg: SG.length, sets: sets, labels: labels };
    }));
    for (const r of res) {
      tally[r.cause]++;
      rows.push(r);
      if (r.cause === 'label_unmatched') {
        for (const l of r.labels) {
          if (!l.set && l.txt) unknownLabels.set(l.txt, (unknownLabels.get(l.txt) || 0) + 1);
        }
      }
    }
    await new Promise(function (r) { setTimeout(r, 400); });
  }

  say('## Verdict : ou se perd la cote de set');
  say('');
  say('| Cause | Matchs | Ce que ca veut dire |');
  say('|---|---:|---|');
  say('| Sets lus | ' + tally.ok + ' | le book repond et les sous-jeux sont reconnus |');
  say('| Requete echouee | ' + tally.fetch_fail + ' | aucun proxy n a repondu — cote perdue par saturation reseau, pas par le book |');
  say('| Aucun sous-jeu | ' + tally.sg_empty + ' | le book repond mais n expose aucun sous-marche sur ce match |');
  say('| Libelle non reconnu | ' + tally.label_unmatched + ' | les sous-jeux existent, notre filtre les jette |');
  say('');

  say('## Detail par match');
  say('');
  say('| Match | Competition | Cause | Sous-jeux | Sets reconnus |');
  say('|---|---|---|---:|---|');
  for (const r of rows) {
    say('| ' + r.m.home + ' vs ' + r.m.away + ' | ' + (r.m.league || '?') + ' | ' + r.cause + ' | ' + r.sg + ' | '
      + (r.sets.length ? Array.from(new Set(r.sets)).sort().join(', ') : '—') + ' |');
  }
  say('');

  if (unknownLabels.size) {
    say('## Libelles de sous-jeux presents mais jetes par le filtre');
    say('');
    say('| Libelle natif (PN | TG) | Occurrences |');
    say('|---|---:|');
    const sorted = Array.from(unknownLabels.entries()).sort(function (a, b) { return b[1] - a[1]; });
    for (const [txt, n] of sorted.slice(0, 40)) say('| ' + txt + ' | ' + n + ' |');
    say('');
  }

  mkdirSync('docs', { recursive: true });
  writeFileSync('docs/xbet-tennis-silence.md', out.join('\n') + '\n');
  console.log('\nRapport ecrit : docs/xbet-tennis-silence.md');
})();
