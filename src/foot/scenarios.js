// ESPACE DES SCENARIOS D'UN MATCH DE FOOT.
// Un scenario = (score mi-temps, score final). C'est le socle du solveur :
// au lieu de raisonner "famille de marches", on enumere tous les deroules
// possibles et on demande a chaque marche ce qu'il paie dans chacun.
// Cap a 7 buts par equipe : au-dela l'evenement est negligeable et aucun
// marche de notre perimetre ne le distingue.
export const CAP = 7;

export function buildScenarios(cap = CAP) {
  const out = [];
  for (let h = 0; h <= cap; h++)
    for (let a = 0; a <= cap; a++)
      for (let hh = 0; hh <= h; hh++)
        for (let ha = 0; ha <= a; ha++) out.push({ h, a, hh, ha });
  return out;
}

export const scenarioLabel = (s) => s.hh + '-' + s.ha + ' HT / ' + s.h + '-' + s.a + ' FT';

// Buts selon la periode visee par le marche.
export function goals(sc, sp) {
  if (sp === 'H1') return [sc.hh, sc.ha];
  if (sp === 'H2') return [sc.h - sc.hh, sc.a - sc.ha];
  return [sc.h, sc.a];
}
