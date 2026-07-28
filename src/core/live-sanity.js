// Garde-fou LIVE : rejette les opportunites dont une jambe est incoherente
// avec le score+minute reel du match. Corrige les cotes fantomes (cotes
// suspendues, pre-match retournees en LIVE, ou API delayees) qui creent des
// surebets artificiels de type "victoire equipe qui mene 1-0 a 55' cotee 3.15".

// Renvoie un tableau de raisons ; vide si l'opp est plausible.
export function liveSanityReject(opp) {
  if (!opp.is_live) return [];
  const liveA = opp.leg_a_live || null;
  const liveB = opp.leg_b_live || null;
  // Choisit le snapshot avec un score parse (priorite leg_a puis leg_b).
  const pick = parseSnap(liveA) || parseSnap(liveB) || parseSnap(opp);
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
  // Accepte {score:"h-a", minute:N} ou {live_score,"h-a", live_minute:N}
  const score = x.score ?? x.live_score ?? x.live_score_at_confirm ?? null;
  const minute = x.minute ?? x.live_minute ?? x.live_minute_at_confirm ?? null;
  if (!score || minute == null) return null;
  const m = String(score).match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!m) return null;
  const hs = Number(m[1]), as = Number(m[2]);
  const mm = Number(minute);
  if (!Number.isFinite(hs) || !Number.isFinite(as) || !Number.isFinite(mm)) return null;
  return { hs, as, mm };
}

// Renvoie une string decrivant l'incoherence, ou null si OK.
// hs/as = score courant, mm = minute jouee.
function coteImpossible(label, cote, hs, as, mm) {
  const L = String(label || '').toLowerCase();
  const lead = hs - as;                 // + = home devant
  const timeLeft = Math.max(0, 90 - mm);
  // Seuils :
  //  >=80' + big lead → cote gagnant doit etre <1.4
  //  >=60' + lead 2+  → cote gagnant doit etre <1.7
  //  >=60' + lead 1   → cote gagnant doit etre <2.5
  // Cote perdant (menant qui est en fait derriere) < 1.5 = impossible.
  const isHomeWin = /domicile|home|équipe 1|joueur 1|éq\.1/.test(L) && !/nul|draw|dnb|extérieur|away|éq\.2|joueur 2/.test(L);
  const isAwayWin = /extérieur|away|équipe 2|joueur 2|éq\.2/.test(L) && !/nul|draw|dnb|domicile|home|éq\.1|joueur 1/.test(L);
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
