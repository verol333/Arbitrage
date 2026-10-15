import { fetchLiveMatches, fetchOddsAndInfo } from "../../shared/onewinLiveWs.ts";
import { listBetpawaLive, listBetpawaCategories } from "../../shared/betpawaLive.ts";
import { sameTeam } from "../../shared/teamMatch.ts";
import { xbetList, bpSnap, cbList, cbSnap, label } from "../../shared/liveMarkets.ts";
import { findOdd } from "./autoBet.ts";

// Contrôle complet sans miser : appariement des matchs sur chaque site, options qu'un prochain but
// ferait gagner (identifiants de mise présents ?), puis essai à blanc de la mise (capital + connexion).
export async function audit(db: any, limit = 12) {
  const cats = await listBetpawaCategories().catch(() => []);
  const foot = cats.find((c: any) => /^(football|soccer)$/i.test(c.name.trim()));
  const [xl, wp, bl, cl] = await Promise.all([
    xbetList(),
    Promise.all([0, 100, 200, 300].map((o) => fetchLiveMatches("football", o))).then((p) => p.flat().filter((m: any) => !m.virtual)),
    foot ? listBetpawaLive(foot.id).catch(() => []) : [],
    cbList().catch(() => []),
  ]);
  const uniq = (l: any[]) => [...new Map(l.map((e) => [String(e.id), e])).values()];
  const books: Record<string, any[]> = { w: uniq(wp), b: uniq(bl), c: uniq(cl) };
  const scoreOf = (k: string, e: any) => k === "c" ? e.score : k === "b" ? String(e.score || "").split("-").map(Number) : null;
  const links: any[] = [], doubts: any[] = [];
  for (const g of xl) {
    const m: any = { x: g.id, name: `${g.home} - ${g.away}`, home: g.home, sc: [g.sh, g.sa], min: g.min };
    for (const k of ["w", "b", "c"]) {
      const cand = books[k].filter((e) => sameTeam(e.home, g.home) && sameTeam(e.away, g.away));
      // Même équipe trouvée dans l'autre sens (domicile/extérieur inversés) : danger sur les totaux par équipe
      const rev = books[k].filter((e) => sameTeam(e.home, g.away) && sameTeam(e.away, g.home));
      if (cand.length > 1) doubts.push({ type: "plusieurs matchs possibles", site: k, x: m.name, candidats: cand.map((e) => `${e.home} - ${e.away}`) });
      if (rev.length) doubts.push({ type: "domicile/extérieur inversés", site: k, x: m.name, autre: rev.map((e) => `${e.home} - ${e.away}`) });
      const e = cand[0];
      if (!e) continue;
      m[k] = e.id; m[`${k}Name`] = `${e.home} - ${e.away}`; if (k === "w") m.wHome = e.home;
      const s = scoreOf(k, e);
      if (s && s.length === 2 && s.every(Number.isFinite) && (s[0] !== g.sh || s[1] !== g.sa)) doubts.push({ type: "score différent", site: k, x: `${m.name} ${g.sh}-${g.sa}`, autre: `${m[`${k}Name`]} ${s.join("-")}` });
    }
    // Un même match d'un site relié à deux matchs 1xBet différents
    if (m.w || m.b || m.c) links.push(m);
  }
  for (const k of ["w", "b", "c"]) {
    const seen = new Map<string, string>();
    for (const m of links) if (m[k]) { const id = String(m[k]); if (seen.has(id)) doubts.push({ type: "même match relié deux fois", site: k, a: seen.get(id), b: m.name }); else seen.set(id, m.name); }
  }

  // Options qu'un prochain but ferait gagner, sur un échantillon (priorité aux matchs présents sur le plus de sites)
  const sample = links.filter((m) => m.min < 80).sort((a, b) => [b.w, b.b, b.c].filter(Boolean).length - [a.w, a.b, a.c].filter(Boolean).length).slice(0, limit);
  const checks: any[] = [], dryOne: Record<string, any> = {};
  for (const m of sample) {
    const [h, a] = m.sc;
    const [ws, bs, cs] = await Promise.all([m.w ? fetchOddsAndInfo([m.w], 2500, 600).catch(() => null) : null, m.b ? bpSnap(m.b).catch(() => null) : null, m.c ? cbSnap(m.c).catch(() => null) : null]);
    const row: any = { match: `${m.name} ${h}-${a} ${m.min}'`, noms: { w: m.wName, b: m.bName, c: m.cName }, options: [] };
    for (const side of ["H", "A"]) {
      const n = side === "H" ? h + 1 : a + 1;
      const opts: [string, number][] = [[`IT${side}_${n - 0.5}`, 0], [`TOT_${h + a + 0.5}`, 0], [`GOAL${h + a + 1}`, side === "H" ? 0 : 2]];
      if (n === 1 && (side === "H" ? a : h) > 0) opts.push(["BTTS", 0]);
      for (const [key, sd] of opts) {
        const r: any = { but: side === "H" ? "domicile" : "extérieur", option: label(key, sd) };
        if (m.w && !/^GOAL/.test(key)) { const f = findOdd(ws?.odds.get(m.w), m.wHome, key, sd); r["1win"] = f ? `${f.cf} (id ${f.id}, état ${f.status})` : "absente"; if (f && f.status === 1 && !dryOne.w) dryOne.w = { m, key, sd, o: { id: f.id, cf: f.cf, status: 1 } }; }
        if (m.b && !/^GOAL/.test(key)) { const id = bs?.ids?.[key]?.[sd], cf = bs?.mk?.[key]?.[sd]; r.betpawa = id && cf ? `${cf} (id ${id}${bs!.locked.has(key) ? ", bloquée" : ""})` : "absente"; if (id && cf && !bs!.locked.has(key) && !dryOne.b) dryOne.b = { m, key, sd, o: { id, cf, status: 1 } }; }
        if (m.c) { const id = cs?.ids?.[key]?.[sd], cf = cs?.mk?.[key]?.[sd]; r.congobet = id && cf ? `${cf} (marché ${id.bt}, option ${id.it}${cs!.locked.has(key) ? ", bloquée" : ""})` : "absente"; if (id && cf && !cs!.locked.has(key) && !dryOne.c) dryOne.c = { m, key, sd, o: { id: id.it, bt: id.bt, ev: Number(m.c), cf, status: 1 } }; }
        row.options.push(r);
      }
    }
    checks.push(row);
  }

  // Essai à blanc : même chemin que la vraie mise (doublon, capital, cote, connexion), 100 F, sans envoyer le pari
  const { execBet } = await import("../../shared/probAutoExec.ts");
  const essais: any = {};
  for (const [k, book] of [["w", "1win"], ["b", "betpawa"], ["c", "congobet"]] as const) {
    const d = dryOne[k];
    if (!d) { essais[book] = "aucune option ouverte trouvée sur l'échantillon"; continue; }
    const base = { signal_key: `audit|${Date.now()}|${k}`, book, source: "goal", xbet_id: d.m.x, onewin_match_id: d.m.w, match_label: d.m.name, minute: d.m.min, score: d.m.sc.join("-"), market_key: d.key, market_label: label(d.key, d.sd), odd: d.o.cf, stake: 100 };
    essais[book] = { option: `${d.m.name} [${base.market_label}] @${d.o.cf}`, ...(await execBet(db, { base, o: d.o, dry: true }).catch((e: any) => ({ step: "erreur", error: String(e?.message || e) }))) };
  }
  return {
    en_direct: { "1xbet": xl.length, "1win": wp.length, betpawa: bl.length, congobet: cl.length },
    relies: { "1win": links.filter((m) => m.w).length, betpawa: links.filter((m) => m.b).length, congobet: links.filter((m) => m.c).length },
    doutes: doubts, controles: checks, essais_a_blanc: essais,
  };
}