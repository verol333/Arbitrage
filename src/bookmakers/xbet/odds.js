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

function parseGE(GE, odds, prefix = '') {
  const grp = (gid) => GE.find((x) => x.G === gid);
  iterate(grp(1), (i, c) => {
    if (i.T === 1) odds[`${prefix}match_1`] = c;
    if (i.T === 2) odds[`${prefix}match_X`] = c;
    if (i.T === 3) odds[`${prefix}match_2`] = c;
  });
  iterate(grp(8), (i, c) => {
    if (i.T === 4) odds[`${prefix}dc_1X`] = c;
    if (i.T === 5) odds[`${prefix}dc_12`] = c;
    if (i.T === 6) odds[`${prefix}dc_X2`] = c;
  });
  iterate(grp(17), (i, c) => {
    const p = i.P; if (p == null || !isHalfLine(p)) return;
    if (i.T === 9) odds[`${prefix}${prefix ? 'over' : 'match_over'}_${p}`] = c;
    if (i.T === 10) odds[`${prefix}${prefix ? 'under' : 'match_under'}_${p}`] = c;
  });
  iterate(grp(19), (i, c) => {
    if (i.T === 180) odds[`${prefix}btts_yes`] = c;
    if (i.T === 181) odds[`${prefix}btts_no`] = c;
  });
  iterate(grp(15), (i, c) => {
    const p = i.P; if (p == null || !isHalfLine(p)) return;
    if (i.T === 11) odds[`${prefix}tt_home_over_${p}`] = c;
    if (i.T === 12) odds[`${prefix}tt_home_under_${p}`] = c;
  });
  iterate(grp(62), (i, c) => {
    const p = i.P; if (p == null || !isHalfLine(p)) return;
    if (i.T === 13) odds[`${prefix}tt_away_over_${p}`] = c;
    if (i.T === 14) odds[`${prefix}tt_away_under_${p}`] = c;
  });
  iterate(grp(2), (i, c) => {
    if (i.P == null || !isHalfLine(i.P)) return;
    if (i.T === 7) odds[`${prefix}hcp_home_${i.P}`] = c;
    if (i.T === 8) odds[`${prefix}hcp_away_${i.P}`] = c;
  });
  iterate(grp(14), (i, c) => {
    if (i.T === 182) odds[`${prefix}even`] = c;
    if (i.T === 183) odds[`${prefix}odd`] = c;
  });
}

function parseMainOnly(GE, odds) {
  const grp = (gid) => GE.find((x) => x.G === gid);
  // 1X2 sans prolongation (fallback si G1 absent).
  iterate(grp(11581), (i, c) => {
    if (i.T === 16684 && odds.match_1 == null) odds.match_1 = c;
    if (i.T === 16685 && odds.match_X == null) odds.match_X = c;
    if (i.T === 16686 && odds.match_2 == null) odds.match_2 = c;
  });
  // Draw No Bet (G9).
  iterate(grp(9), (i, c) => {
    if (i.T === 703) odds.dnb_1 = c;
    if (i.T === 704) odds.dnb_2 = c;
  });
  // 1ère équipe à marquer (3-way).
  iterate(grp(169), (i, c) => {
    if (i.T === 923) odds.fts_home = c;
    if (i.T === 925) odds.fts_none = c;
    if (i.T === 924) odds.fts_away = c;
  });
  // Mi-temps la plus prolifique (G445).
  iterate(grp(445), (i, c) => {
    if (i.T === 1305) odds.half_most_ht = c;
    if (i.T === 1306) odds.half_most_h2 = c;
    if (i.T === 1307) odds.half_most_equal = c;
  });
}

// Parseur BASKET 1xBet (marchés incl. OT).
// Mapping (G, T, P) validé via probe-basket-dump :
//   G=101 T=401→match_1, T=402→match_2 (Winner 2-way incl OT)
//   G=17  T=9→over, T=10→under, P=line (Total match incl OT)
//   G=2   T=7→hcp_home, T=8→hcp_away, P=line (Handicap incl OT)
//   G=15  T=11→over, T=12→under, P=line (TT home incl OT)
//   G=62  T=13→over, T=14→under, P=line (TT away incl OT)
//   G=91  T=755→q1_match_1, T=757→q1_match_2 (2-way Q1)
//   G=92  T=766→q2_match_1, T=767→q2_match_2 (2-way Q2)
// Attention: pas de match_X pour basket incl OT (pas de nul possible).
function parseBasketGE(GE, odds, prefix = '') {
  const grp = (gid) => GE.find((x) => x.G === gid);
  iterate(grp(101), (i, c) => {
    if (i.T === 401) odds[`${prefix}match_1`] = c;
    if (i.T === 402) odds[`${prefix}match_2`] = c;
  });
  iterate(grp(17), (i, c) => {
    const p = i.P; if (p == null || !isHalfLine(p)) return;
    if (i.T === 9) odds[`${prefix}${prefix ? 'over' : 'match_over'}_${p}`] = c;
    if (i.T === 10) odds[`${prefix}${prefix ? 'under' : 'match_under'}_${p}`] = c;
  });
  iterate(grp(2), (i, c) => {
    if (i.P == null || !isHalfLine(i.P)) return;
    if (i.T === 7) odds[`${prefix}hcp_home_${i.P}`] = c;
    if (i.T === 8) odds[`${prefix}hcp_away_${i.P}`] = c;
  });
  iterate(grp(15), (i, c) => {
    const p = i.P; if (p == null || !isHalfLine(p)) return;
    if (i.T === 11) odds[`${prefix}tt_home_over_${p}`] = c;
    if (i.T === 12) odds[`${prefix}tt_home_under_${p}`] = c;
  });
  iterate(grp(62), (i, c) => {
    const p = i.P; if (p == null || !isHalfLine(p)) return;
    if (i.T === 13) odds[`${prefix}tt_away_over_${p}`] = c;
    if (i.T === 14) odds[`${prefix}tt_away_under_${p}`] = c;
  });
  if (!prefix) {
    iterate(grp(91), (i, c) => {
      if (i.T === 755) odds.q1_match_1 = c;
      if (i.T === 757) odds.q1_match_2 = c;
    });
    iterate(grp(92), (i, c) => {
      if (i.T === 766) odds.q2_match_1 = c;
      if (i.T === 767) odds.q2_match_2 = c;
    });
  }
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
