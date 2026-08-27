#!/usr/bin/env node
// AUTO-VERIFICATION : s'execute AVANT chaque scan et fait echouer le job si un
// lecteur de marche est faux. Chaque run precedent partait avec une erreur de
// lecture ; ces assertions verrouillent les regles deja corrigees.
import { execFileSync } from 'node:child_process';
import { classifyHalfPredicate } from './halves-markets.js';
import { classifyStatOutcome, statMask, statFamily, STAT_FULL_MASK } from './stat-markets.js';

let failed = 0;
function ok(label, cond) {
  console.log((cond ? '  OK   ' : '  ECHEC') + ' ' + label);
  if (!cond) failed++;
}
const half = (m, s, homeNamed = false, awayNamed = false) =>
  classifyHalfPredicate({ m: m.toLowerCase(), s: s.toLowerCase(), homeNamed, awayNamed });

console.log('-- Buts : les statistiques ne doivent JAMAIS entrer dans la grille de buts');
ok('"Corners. 1st half. Total" n est pas un total de buts',
  half('corners. 1st half. total', 'under 3.5') === null);
ok('"Corners. 1st half. Team total" n est pas un total de buts',
  half('corners. 1st half. team total', 'under 1.5', true) === null);
ok('"Cartons 1ere mi-temps" n est pas un total de buts',
  half('total cartons 1ere mi-temps', 'moins de 2.5') === null);

console.log('-- Buts : un vrai total de mi-temps reste lu');
const totH1 = half('1ere mi-temps - total de buts', 'over 1.5');
ok('Over 1.5 buts MT1 lisible', typeof totH1 === 'function');
ok('Over 1.5 buts MT1 : vrai pour 2-0 en MT1', totH1 && totH1(2, 0, 0, 0) === true);
ok('Over 1.5 buts MT1 : faux pour 1-0 en MT1', totH1 && totH1(1, 0, 0, 0) === false);
ok('Over 1.5 buts MT1 : ignore les buts de la 2eme MT', totH1 && totH1(0, 0, 3, 3) === false);

console.log('-- Selections combinees lues en INTERSECTION (et non par moitie)');
const comb = half('1ere mi-temps - resultat de la mi-temps', '2 / > 1.5');
ok('"2 / > 1.5" lisible', typeof comb === 'function');
ok('"2 / > 1.5" vrai pour 0-2 a la mi-temps', comb && comb(0, 2, 0, 0) === true);
ok('"2 / > 1.5" FAUX pour 0-1 (2eme condition non remplie)', comb && comb(0, 1, 0, 0) === false);
ok('"2 / > 1.5" FAUX pour 2-0 (mauvaise equipe)', comb && comb(2, 0, 0, 0) === false);
ok('une moitie illisible fait rejeter le marche',
  half('1ere mi-temps - resultat de la mi-temps', '2 / buteur') === null);

console.log('-- Corners : espace d issues propre');
ok('la famille corners est reconnue', statFamily('Corners. 1st half. Total') === 'CORNERS');
const cU = classifyStatOutcome({ market: 'Corners. 1st half. Total', selection: 'Under 3.5' });
const cO = classifyStatOutcome({ market: 'Corners. 1st half. Total', selection: 'Over 3.5' });
const cFT = classifyStatOutcome({ market: 'Total Corners - FT', selection: 'Under 8.5' });
ok('corners MT1 : domaine dedie', !!cU && cU.domain === 'CORNERS_H1');
ok('corners MT1 et corners FT : domaines distincts', !!cFT && cFT.domain === 'CORNERS_FT');
ok('Under 3.5 corners : vrai pour 2-1', !!cU && cU.pred(2, 1) === true);
ok('Under 3.5 corners : faux pour 3-2', !!cU && cU.pred(3, 2) === false);
const mU = cU && statMask(cU.pred), mO = cO && statMask(cO.pred);
ok('Under 3.5 corners ne couvre pas tout', !!mU && mU !== STAT_FULL_MASK && mU !== 0n);
ok('Under 3.5 + Over 3.5 corners couvrent exactement tout', !!mU && !!mO && (mU | mO) === STAT_FULL_MASK);
ok('Under 3.5 et Over 3.5 corners sont disjoints', !!mU && !!mO && (mU & mO) === 0n);
const cTeam = classifyStatOutcome({ market: 'Corners. 1st half. Tenerife total', selection: 'Under 1.5', homeNamed: true });
ok('corners d une equipe nommee : lus sur cette equipe seule',
  !!cTeam && cTeam.pred(1, 9) === true && cTeam.pred(2, 0) === false);
ok('ligne entiere (remboursement possible) rejetee',
  classifyStatOutcome({ market: 'Total Corners - FT', selection: 'Over 9' }) === null);

console.log('-- Le solveur doit etre syntaxiquement valide');
try {
  execFileSync(process.execPath, ['--check', 'scripts/combinatorial-solver.js'], { stdio: 'pipe' });
  ok('scripts/combinatorial-solver.js compile', true);
} catch (e) {
  ok('combinatorial-solver.js NE COMPILE PAS : ' + String(e.stderr || e.message).slice(0, 400), false);
}

console.log('');
if (failed) {
  console.log('AUTO-VERIFICATION ECHOUEE : ' + failed + ' regle(s) de lecture cassee(s) - scan annule');
  process.exit(1);
}
console.log('AUTO-VERIFICATION OK - lecture des marches conforme, scan autorise');
