// Lecture des cotes 1xbet football (GetGameZip). Port fidèle de matchCore.ts xbetOdds().
import { FEED, COUNTRY, viaWorker } from './api.js';
import { isHalfLine } from '../../core/markets.js';

function iterate(g, cb) {
  if (!g?.E) return;
  for (const sub of g.E) {
    for (const it of (Array.isArray(sub) ? sub : [sub])) {
      if (it?.C == null) continue;
      const c = parseFloat(it.C);
      if (!isNaN(c) && c > 1) cb(it, c);
    }
  }
}

// Helper : ecrit odds[key] = c ET odds._ids[key] = { betType: i.T, param: i.P }
// pour permettre au backend de generer un code coupon (endpoint 1xBet/Megapari
// SaveCoupon existant en prod : megapariCoupon). gameId + kind sont ajoutes
// par collect.js. i.P est present pour Total/Handicap/TT lines, sinon null.
function put1x(odds, key, i, c) {
  odds[key] = c;
  if (!odds._ids) odds._ids = {};
  odds._ids[key] = { betType: i.T, param: i.P ?? null };
}

function parseGE(GE, odds, prefix = '') {
  const grp = (gid) => GE.find((x) => x.G === gid);
  iterate(grp(1), (i, c) => {
    if (i.T === 1) put1x(odds, `${prefix}match_1`, i, c);
    if (i.T === 2) put1x(odds, `${prefix}match_X`, i, c);
    if (i.T === 3) put1x(odds, `${prefix}match_2`, i, c);
  });
  iterate(grp(8), (i, c) => {
    if (i.T === 4) put1x(odds, `${prefix}dc_1X`, i, c);
    if (i.T === 5) put1x(odds, `${prefix}dc_12`, i, c);
    if (i.T === 6) put1x(odds, `${prefix}dc_X2`, i, c);
  });
  iterate(grp(17), (i, c) => {
    const p = i.P; if (p == null || !isHalfLine(p)) return;
    if (i.T === 9) put1x(odds, `${prefix}${prefix ? 'over' : 'match_over'}_${p}`, i, c);
    if (i.T === 10) put1x(odds, `${prefix}${prefix ? 'under' : 'match_under'}_${p}`, i, c);
  });
  iterate(grp(19), (i, c) => {
    if (i.T === 180) put1x(odds, `${prefix}btts_yes`, i, c);
    if (i.T === 181) put1x(odds, `${prefix}btts_no`, i, c);
  });
  iterate(grp(15), (i, c) => {
    const p = i.P; if (p == null || !isHalfLine(p)) return;
    if (i.T === 11) put1x(odds, `${prefix}tt_home_over_${p}`, i, c);
    if (i.T === 12) put1x(odds, `${prefix}tt_home_under_${p}`, i, c);
  });
  iterate(grp(62), (i, c) => {
    const p = i.P; if (p == null || !isHalfLine(p)) return;
    if (i.T === 13) put1x(odds, `${prefix}tt_away_over_${p}`, i, c);
    if (i.T === 14) put1x(odds, `${prefix}tt_away_under_${p}`, i, c);
  });
  iterate(grp(2), (i, c) => {
    if (i.P == null || !isHalfLine(i.P)) return;
    if (i.T === 7) put1x(odds, `${prefix}hcp_home_${i.P}`, i, c);
    if (i.T === 8) put1x(odds, `${prefix}hcp_away_${i.P}`, i, c);
  });
  iterate(grp(14), (i, c) => {
    if (i.T === 182) put1x(odds, `${prefix}even`, i, c);
    if (i.T === 183) put1x(odds, `${prefix}odd`, i, c);
  });
}

function parseMainOnly(GE, odds) {
  const grp = (gid) => GE.find((x) => x.G === gid);
  // 1X2 sans prolongation (fallback si G1 absent).
  iterate(grp(11581), (i, c) => {
    if (i.T === 16684 && odds.match_1 == null) put1x(odds, 'match_1', i, c);
    if (i.T === 16685 && odds.match_X == null) put1x(odds, 'match_X', i, c);
    if (i.T === 16686 && odds.match_2 == null) put1x(odds, 'match_2', i, c);
  });
  // Draw No Bet (G9).
  iterate(grp(9), (i, c) => {
    if (i.T === 703) put1x(odds, 'dnb_1', i, c);
    if (i.T === 704) put1x(odds, 'dnb_2', i, c);
  });
  // 1ère équipe à marquer (3-way).
  iterate(grp(169), (i, c) => {
    if (i.T === 923) put1x(odds, 'fts_home', i, c);
    if (i.T === 925) put1x(odds, 'fts_none', i, c);
    if (i.T === 924) put1x(odds, 'fts_away', i, c);
  });
  // Mi-temps la plus prolifique (G445).
  iterate(grp(445), (i, c) => {
    if (i.T === 1305) put1x(odds, 'half_most_ht', i, c);
    if (i.T === 1306) put1x(odds, 'half_most_h2', i, c);
    if (i.T === 1307) put1x(odds, 'half_most_equal', i, c);
  });
}

// Parseur BASKET 1xBet (marchés incl. OT).
// Mapping (G, T, P) valide via probe-basket-dump + probe-xbet-basket-raw :
//   G=101 T=401→match_1, T=402→match_2 (Winner 2-way incl OT) ✅ verifie asymetrique
//   G=17  T=9→over, T=10→under, P=line (Total match incl OT)  ✅
//   G=2   T=7→hcp_home, T=8→hcp_away, P=line (Handicap incl OT) ✅
//   G=15  T=11→over, T=12→under, P=line (TT home incl OT) ✅
//   G=62  T=13→over, T=14→under, P=line (TT away incl OT) ✅
// Attention: pas de match_X pour basket incl OT (pas de nul possible).
//
// ⚠️ G=91 / G=92 SONT DELIBEREMENT OMIS (fix root cause 2026-08-08).
// L'ancien mapping (T=755/757→q1_match_1/2, T=766/767→q2_match_1/2) etait FAUX.
// Preuves rassemblees via probe-xbet-basket-raw sur 6 matchs distincts (WNBA,
// Argentina W, Chicago Sky, Fu Jen, Bank of Taiwan, Ginebra Philippines) :
//   G=91 : cotes SYSTEMATIQUEMENT symetriques ~1.81/1.87 sur TOUS les matchs,
//          independamment de la force des equipes. Argentina W (favori FT 1.18
//          vs 4.32) → G=91 T=755=1.809 T=757=1.811. Un vrai Q1 Winner avec
//          Argentina favori serait 1.4/2.8, pas 1.81/1.81.
// Interpretation : G=91/G=92 ne sont PAS "Q1/Q2 Winner". C'est un marche
// 1xBet-specifique intrinsequement 50/50 (probablement Handicap 0 Q1 ou
// Q1 DNB ou Race-to-N points, non documente). Mapping impossible cross-book
// avec les Q1 Winner 3-way de 1win/SB/BetMomo.
//
// Approche precedente (readWinner2Way avec delta 0.02) etait un MASQUE qui
// cachait le probleme sans le comprendre. Le vrai fix : ne pas mapper ce
// marche du tout. Si un jour on identifie le VRAI groupe G du Q1 Winner
// 2xBet (via dump d'un match Q1 en cours), on l'ajoutera. En attendant, la
// couverture Q1/Q2 Winner reste correcte via 1win + sportybet + betmomo qui
// eux exposent bien Q1 Winner en 3-way et sont valides par
// pushArbPeriodWinner (3-way check dans compareBasketTwoBooks).
function parseBasketGE(GE, odds, prefix = '') {
  const grp = (gid) => GE.find((x) => x.G === gid);
  // Winner 2-way FT (incl OT) : lecture directe. Le mapping G=101/T=401/T=402
  // est verifie par probe raw sur Argentina W (T=401=1.178 T=402=4.325 —
  // asymetrique coherent avec Argentina favori).
  iterate(grp(101), (i, c) => {
    if (i.T === 401) put1x(odds, `${prefix}match_1`, i, c);
    if (i.T === 402) put1x(odds, `${prefix}match_2`, i, c);
  });
  iterate(grp(17), (i, c) => {
    const p = i.P; if (p == null || !isHalfLine(p)) return;
    if (i.T === 9) put1x(odds, `${prefix}${prefix ? 'over' : 'match_over'}_${p}`, i, c);
    if (i.T === 10) put1x(odds, `${prefix}${prefix ? 'under' : 'match_under'}_${p}`, i, c);
  });
  iterate(grp(2), (i, c) => {
    if (i.P == null || !isHalfLine(i.P)) return;
    if (i.T === 7) put1x(odds, `${prefix}hcp_home_${i.P}`, i, c);
    if (i.T === 8) put1x(odds, `${prefix}hcp_away_${i.P}`, i, c);
  });
  iterate(grp(15), (i, c) => {
    const p = i.P; if (p == null || !isHalfLine(p)) return;
    if (i.T === 11) put1x(odds, `${prefix}tt_home_over_${p}`, i, c);
    if (i.T === 12) put1x(odds, `${prefix}tt_home_under_${p}`, i, c);
  });
  iterate(grp(62), (i, c) => {
    const p = i.P; if (p == null || !isHalfLine(p)) return;
    if (i.T === 13) put1x(odds, `${prefix}tt_away_over_${p}`, i, c);
    if (i.T === 14) put1x(odds, `${prefix}tt_away_under_${p}`, i, c);
  });
  // G=91 / G=92 (ancien mapping Q1/Q2 Winner) EXPRESSEMENT OMIS — voir
  // commentaire d'en-tete. Ne PAS reactiver sans probe fresh sur match
  // basket LIVE avec Q1 en cours qui identifierait le VRAI G du Winner.
}

export async function getOdds(matchId, { live = false, noCache = false, sport = 'football' } = {}) {
  const feedPath = live ? 'LiveFeed' : 'LineFeed';
  const url = `${FEED}/service-api/${feedPath}/GetGameZip?id=${matchId}&lng=fr&isSubGames=true&GroupEvents=true&countevents=2000&grMode=4&country=${COUNTRY}&marketType=1&isNewBuilder=true`;
  // En live ou re-fetch confirm : force noCache pour cotes fraîches (bypass allorigins 5min cache).
  const gd = await viaWorker(url, { noCache: live || noCache });
  if (!gd?.Value) return null;
  const GE = gd.Value.GE || [];
  const odds = {};
  if (sport === 'basket') {
    parseBasketGE(GE, odds, '');
    return odds;
  }
  // Hockey utilise parseGE (foot) car les autres books (CongoBet/BetMomo/SportyBet/
  // PremierBet) exposent le winner regulation 3-way (match_1/X/2) et non incl OT
  // 2-way. parseBasketGE lisait G=101 (incl OT 2-way) → mismatch semantique
  // cross-book. parseGE lit G=1 (1X2 regulation 3-way) + G=17 (total) + G=2 (hcp)
  // + G=15/62 (tt) + G=19 (btts) + G=8 (dc) + G=14 (odd/even) — tout compatible
  // regulation avec les autres books.
  if (sport === 'hockey') {
    parseGE(GE, odds, '');
    return odds;
  }
  // Volleyball : structure quasi-identique basket 2-way + tennis sets.
  // G=1 (2-way winner, T=1 home + T=3 away, sans T=2 nul), G=17 (total points),
  // G=2 (handicap points), G=15/62 (team totals), G=14 (odd/even), G=343 (nOut=3
  // potentially total sets 2/3-way). Ignore G=343 pour l'instant (pas de mapping
  // valide sans probe). Reuse parseBasketGE (2-way + total + hcp + tt).
  if (sport === 'volleyball') {
    parseBasketGE(GE, odds, '');
    // Ajout G=14 odd/even (parseBasketGE ne le fait pas mais volleyball l'expose).
    iterate((GE.find((x) => x.G === 14)), (i, c) => {
      if (i.T === 182) put1x(odds, 'even', i, c);
      if (i.T === 183) put1x(odds, 'odd', i, c);
    });
    return odds;
  }
  parseGE(GE, odds, '');
  parseMainOnly(GE, odds);

  if (!live) {
    const SG = gd.Value.SG || [];
    const wanted = [];
    for (const sg of SG) {
      const pn = (sg.PN || '').toLowerCase(), tg = (sg.TG || '').toLowerCase(), sid = sg.I;
      if (!sid) continue;
      // Skip les subgames par equipe / par joueur pour eviter que leurs
      // groupes (Total home/away corners, Total joueur X corners) polluent
      // le prefixe cor_ generique du match (produisait Corners Total 12%+
      // fantomes en 07/27).
      if (/team|joueur|player|equipe|domicile|exterieur/i.test(pn + ' ' + tg)) continue;
      let prefix = null;
      if (sg.P === 1 && /mi-temps|half/.test(pn) && !tg) prefix = 'ht_';
      else if (sg.P === 2 && /mi-temps|half/.test(pn) && !tg) prefix = 'h2_';
      // Corners : accepter uniquement les subgames dont le TG est PUREMENT
      // "corners" (pas "corners home team", pas "corners 1st half").
      else if (/^corners?$/i.test(tg) && !sg.P) prefix = 'cor_';
      if (prefix) wanted.push({ sid, prefix });
    }
    // Cap : 6 subgames max (HT, H2, corners, plus une petite marge). Etait
    // etendu a 10 recemment mais a introduit du bruit corners → retour 6.
    const subs = await Promise.all(wanted.slice(0, 6).map(async ({ sid, prefix }) => {
      const sd = await viaWorker(`${FEED}/service-api/LineFeed/GetGameZip?id=${sid}&lng=fr&isSubGames=false&GroupEvents=true&countevents=250&grMode=4&country=${COUNTRY}&marketType=1&isNewBuilder=true`);
      return { prefix, GE: sd?.Value?.GE || null };
    }));
    for (const { prefix, GE: GEsub } of subs) if (GEsub) parseGE(GEsub, odds, prefix);
  }
  return odds;
}
