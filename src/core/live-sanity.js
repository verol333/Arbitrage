// Garde-fou LIVE : rejette les opportunites dont une jambe est incoherente
// avec le score+minute reel du match. Corrige les cotes fantomes (cotes
// suspendues, pre-match retournees en LIVE, ou API delayees) qui creent des
// surebets artificiels de type "victoire equipe qui mene 1-0 a 55' cotee 3.15".

// Renvoie un tableau de raisons ; vide si l'opp est plausible.
export function liveSanityReject(opp) {
  if (!opp.is_live) return [];
  const liveA = opp.leg_a_live || null;
  const liveB = opp.leg_b_live || null;
  // Merge des 2 snapshots (chaque bookmaker en a un). Prend le score max
  // et la minute max — plus recente = plus proche de la verite.
  const pick = mergeSnaps(mergeSnaps(parseSnap(liveA), parseSnap(liveB)), parseSnap(opp));
  if (!pick) return [];
  const { hs, as, mm } = pick;
  const reasons = [];
  const check = (label, cote) => {
    if (!cote) return;
    const r = coteImpossible(label, cote, hs, as, mm);
    if (r) reasons.push(`${label} @${cote} — ${r}`);
  };
  // Verifie chaque jambe : label est celui affiche a l'utilisateur ("Domicile",
  // "Extérieur", "Nul ou Extérieur", "Domicile (DNB)", ...).
  check(opp.leg_a_label, opp.leg_a_odd);
  check(opp.leg_b_label, opp.leg_b_odd);
  return reasons;
}

function parseSnap(x) {
  if (!x) return null;
  const score = x.score ?? x.live_score ?? x.live_score_at_confirm ?? null;
  const minute = x.minute ?? x.live_minute ?? x.live_minute_at_confirm ?? null;
  if (!score) return null;
  const m = String(score).match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!m) return null;
  const hs = Number(m[1]), as = Number(m[2]);
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return null;
  const mmNum = Number(minute);
  // Minute optionnelle : Number.isFinite(NaN)===false → mm=null si non parsable.
  const mm = Number.isFinite(mmNum) ? mmNum : null;
  return { hs, as, mm };
}

// Merge deux snapshots (leg A + leg B) : garde le score de A si dispo, sinon B.
// Utilise la minute la PLUS elevee (source la plus recente / fiable).
function mergeSnaps(a, b) {
  if (a && !b) return a;
  if (!a && b) return b;
  if (!a && !b) return null;
  // Si les 2 scores different, on prend le max de chaque cote (= plus recent).
  const hs = Math.max(a.hs, b.hs);
  const as = Math.max(a.as, b.as);
  const mm = a.mm != null && b.mm != null ? Math.max(a.mm, b.mm) : (a.mm ?? b.mm);
  return { hs, as, mm };
}

// Renvoie une string decrivant l'incoherence, ou null si OK.
// hs/as = score courant, mm = minute jouee.
function coteImpossible(label, cote, hs, as, mm) {
  const L = String(label || '').toLowerCase();
  const lead = hs - as;                 // + = home devant
  const timeLeft = mm != null ? Math.max(0, 90 - mm) : null;
  const hasTime = timeLeft != null;

  // ─── CHECKS SCORE-SEULEMENT (minute inconnue, ex : BM sans current_game_time) ─
  // Ces regles marchent quelle que soit la minute — un ecart de +3 ne peut
  // pas donner une cote de gagnant a >5, meme au tout debut du match.
  const isHomeWinL = /domicile|home|équipe 1|joueur 1|éq\.1/.test(L) && !/nul|draw|dnb|extérieur|away|éq\.2|joueur 2/.test(L);
  const isAwayWinL = /extérieur|away|équipe 2|joueur 2|éq\.2/.test(L) && !/nul|draw|dnb|domicile|home|éq\.1|joueur 1/.test(L);
  if (isHomeWinL && lead >= 3 && cote > 5) return `home menant +${lead} score-only cote>5 impossible`;
  if (isAwayWinL && lead <= -3 && cote > 5) return `away menant +${-lead} score-only cote>5 impossible`;
  if (isHomeWinL && lead >= 2 && cote > 8) return `home menant +${lead} cote>8 impossible`;
  if (isAwayWinL && lead <= -2 && cote > 8) return `away menant +${-lead} cote>8 impossible`;
  // Nul avec ecart >=3 = quasi impossible (comeback tres rare) → cote <8 suspect
  if (/^nul$|^draw$/.test(L) && Math.abs(lead) >= 3 && cote < 6) return `nul avec ecart ${Math.abs(lead)} cote<6 impossible`;
  // Si pas de minute → on s'arrete la (impossible d'appliquer les seuils temporels).
  if (!hasTime) return null;
  // Seuils temporels :
  //  >=80' + big lead → cote gagnant doit etre <1.4
  //  >=60' + lead 2+  → cote gagnant doit etre <1.7
  //  >=60' + lead 1   → cote gagnant doit etre <2.5
  const isHomeWin = isHomeWinL;
  const isAwayWin = isAwayWinL;
  const isDraw = /^nul$|^draw$/.test(L);
  const isDcX2 = /nul ou ext|x\s*2|x2/.test(L);      // Nul + Ext gagne
  const isDc1X = /dom.*nul|1\s*x|1x/.test(L);         // Dom + Nul gagne
  const isDc12 = /un gagnant|1\s*2|12/.test(L);       // Dom ou Ext (pas nul)
  // Home win
  if (isHomeWin) {
    if (timeLeft <= 10 && lead >= 1 && cote > 1.4) return `home menant +${lead} @${mm}'`;
    if (timeLeft <= 30 && lead >= 2 && cote > 1.7) return `home menant +${lead} @${mm}'`;
    if (timeLeft <= 30 && lead >= 1 && cote > 2.5) return `home menant +${lead} @${mm}'`;
    if (timeLeft <= 10 && lead <= -2 && cote < 3) return `home derriere ${-lead} @${mm}' (impossible)`;
    if (lead <= -1 && cote < 1.5) return `home derriere ${-lead} cote <1.5 impossible`;
  }
  if (isAwayWin) {
    if (timeLeft <= 10 && lead <= -1 && cote > 1.4) return `away menant +${-lead} @${mm}'`;
    if (timeLeft <= 30 && lead <= -2 && cote > 1.7) return `away menant +${-lead} @${mm}'`;
    if (timeLeft <= 30 && lead <= -1 && cote > 2.5) return `away menant +${-lead} @${mm}'`;
    if (timeLeft <= 10 && lead >= 2 && cote < 3) return `away derriere ${lead} @${mm}' (impossible)`;
    if (lead >= 1 && cote < 1.5) return `away derriere ${lead} cote <1.5 impossible`;
  }
  if (isDraw) {
    // Nul avec un gros ecart tardif = impossible
    if (timeLeft <= 15 && Math.abs(lead) >= 2 && cote < 15) return `nul avec ecart ${Math.abs(lead)} @${mm}' impossible`;
  }
  if (isDc1X) {
    // 1X = home ou draw
    if (timeLeft <= 10 && lead <= -2 && cote < 4) return `1X avec away +${-lead} @${mm}' impossible`;
  }
  if (isDcX2) {
    if (timeLeft <= 10 && lead >= 2 && cote < 4) return `X2 avec home +${lead} @${mm}' impossible`;
  }
  if (isDc12) {
    // 12 = pas de nul → si score serré à la fin, cote 12 impossible bas
    if (timeLeft <= 5 && Math.abs(lead) >= 2 && cote > 1.4) return `12 avec ecart ${Math.abs(lead)} @${mm}' cote elevee`;
  }
  return null;
}

// Filtre un tableau d'opportunites LIVE, retourne { kept, dropped }.
export function filterLiveSanity(opps, logFn) {
  const kept = [];
  const dropped = [];
  for (const o of opps) {
    const reasons = liveSanityReject(o);
    if (!reasons.length) { kept.push(o); continue; }
    dropped.push({ opp: o, reasons });
    if (logFn) {
      logFn(`  🚫 SANITY DROP ${o.profit_pct}% | ${o.market_family} | ${o.leg_a_book}:${o.leg_a_label}=${o.leg_a_odd} vs ${o.leg_b_book}:${o.leg_b_label}=${o.leg_b_odd} | ${o.team_home} vs ${o.team_away} | ${reasons.join(' | ')}`);
    }
  }
  return { kept, dropped };
}
