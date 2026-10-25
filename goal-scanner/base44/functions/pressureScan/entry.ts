import { createClientFromRequest } from "../../../sdk-shim.ts";
import { sleep, xbetList, xbetSnap, T22, H } from "../../shared/liveMarkets.ts";
import { sameTeam } from "../../shared/teamMatch.ts";
import { fotmobFind, fotmobDetails } from "../../shared/fotmobLive.ts";
import { compute, isSignal, watchWindow, type Sample } from "../../shared/pressureModel.ts";
import { dbRetry } from "../../shared/dbRetry.ts";
import { lateProfile, lateOk } from "../../shared/lateGoals.ts";
import { matchContext, snap85 } from "../../shared/matchContext.ts";
import { dailySelection, selected } from "../../shared/dailySelection.ts";
import { lateDecision } from "../../shared/lateDecision.ts";

// Scanner « pression » (tourne en continu sur GitHub) :
// - toutes les 15 s : compteurs de TOUS les matchs 1xBet → intensité des 10 dernières minutes de chacun ;
// - les 3 matchs les plus intenses (30e–45e et 65e–88e) sont suivis à la seconde : stats 1xBet, cotes 1xBet + 22Bet, FotMob (xG, momentum) ;
// - opportunité « +1 but » (observation, aucune mise) → fiche + alerte téléphone.
// L'état reste en mémoire entre deux cycles (même machine) : aucun temps de chauffe perdu.
const FOLLOW = 15; // tous les matchs dans la fenêtre sont relevés à la seconde
const ST = (v: any[], id: number) => { const s = v.find((x: any) => x.ID === id); return [Number(s?.S1 || 0), Number(s?.S2 || 0)] as [number, number]; };
const toSample = (sc: any, min: number): Sample | null => {
  const v = sc?.ST?.[0]?.Value || [];
  // Seulement les matchs riches en données : attaques, attaques dangereuses et tirs fournis
  if (![45, 58, 59].every((id) => v.some((x: any) => x.ID === id))) return null;
  return { at: Date.now(), min, da: ST(v, 58), at_: ST(v, 45), on: ST(v, 59), off: ST(v, 60), co: ST(v, 70), poss: ST(v, 29), rc: ST(v, 71), yc: ST(v, 26), pen: ST(v, 72) };
};

const S: any = { hist: new Map<number, Sample[]>(), info: new Map<number, any>(), follow: new Map<number, any>(), t22: [] as any[], until: 0, running: null as Promise<void> | null, signals: 0 };

async function rawList() {
  const j = await fetch(`https://1xbet.cg/service-api/LiveFeed/Get1x2_VZip?sports=1&count=1000&lng=en&mode=4&country=93&partner=159&getEmpty=true`, { headers: H, signal: AbortSignal.timeout(6000) }).then((r) => r.json()).catch(() => null);
  return j?.Value || [];
}
async function detail(id: number) {
  const j = await fetch(`https://1xbet.cg/service-api/LiveFeed/GetGameZip?id=${id}&lng=en&country=93&partner=159&grMode=4&countevents=5`, { headers: H, signal: AbortSignal.timeout(4000) }).then((r) => r.json()).catch(() => null);
  return j?.Value || null;
}

async function loop(db: any) {
  let lastList = 0, lastSave = new Map<number, number>();
  const real = new Set((await xbetList()).map((g: any) => g.id));
  let realAt = Date.now();
  while (Date.now() < S.until) {
    // 1. Tous les matchs, toutes les 15 s
    if (Date.now() - lastList > 15000) {
      lastList = Date.now();
      if (Date.now() - realAt > 60000) { const l = await xbetList(); real.clear(); for (const g of l) real.add(g.id); realAt = Date.now(); S.t22 = await xbetList(T22, ""); }
      // Sélection du jour : seuls les meilleurs matchs (avant-match solide) sont suivis
      await dailySelection(async (list) => {
        const ex = (await db.PressureState.filter({ key: "selection" }, { limit: 1 }).catch(() => null))?.items?.[0];
        const data = { key: "selection", hist: { list }, saved_at: new Date().toISOString() };
        return ex ? db.PressureState.update(ex.id, data) : db.PressureState.create(data);
      }).catch(() => null);
      const live = new Set<number>();
      // Doublons 1xBet (même affiche sous deux noms, ex. « Lions » et « Queensland Lions ») : on garde le match d'origine.
      const seen = new Map<string, number>();
      const raw = ((await rawList()) as any[]).filter((g) => real.has(g.I)).sort((a, b) => a.I - b.I);
      const tail = (n: string) => String(n || "").toLowerCase().trim().split(/\s+/).pop();
      for (const g of raw) {
        const k = `${g.LE || g.L}|${tail(g.O1E || g.O1)}|${tail(g.O2E || g.O2)}`;
        if (seen.has(k)) continue;
        seen.set(k, g.I);
        const min = Math.floor((g.SC?.TS || 0) / 60), s = toSample(g.SC, min);
        live.add(g.I);
        S.info.set(g.I, { home: g.O1E || g.O1, away: g.O2E || g.O2, league: g.LE || g.L || "", min, sc: [Number(g.SC?.FS?.S1 || 0), Number(g.SC?.FS?.S2 || 0)] });
        if (!s) continue;
        const h = S.hist.get(g.I) || [];
        if (!h.length || h[h.length - 1].min !== min || Date.now() - h[h.length - 1].at > 30000) h.push(s);
        if (h.length > 120) h.shift();
        S.hist.set(g.I, h);
      }
      for (const id of [...S.hist.keys()]) if (!live.has(id)) { S.hist.delete(id); }
      // Matchs terminés / sortis du direct
      for (const [id, f] of S.follow) if (!live.has(id)) { await end(db, id, f, "ended"); }
      // 2. Classement par intensité récente (attaques dangereuses/min sur 10 min)
      const rank = [...S.hist.entries()].map(([id, h]) => {
        const i = S.info.get(id); if (!i || !watchWindow(i.min) || h.length < 3 || !selected(i.home, i.away)) return null;
        const old = h.find((s: Sample) => i.min - s.min <= 10) || h[0], now = h[h.length - 1];
        const span = Math.max(1, now.min - old.min);
        return { id, r: (now.da[0] - old.da[0] + now.da[1] - old.da[1]) / span };
      }).filter(Boolean).sort((a: any, b: any) => b.r - a.r) as any[];
      const top = rank.slice(0, FOLLOW).map((x) => x.id), keep = new Set(rank.slice(0, FOLLOW * 2).map((x) => x.id));
      for (const [id, f] of S.follow) if (!keep.has(id) && !f.pending.length) await end(db, id, f, "dropped");
      for (const id of top) if (S.follow.size < FOLLOW && !S.follow.has(id)) await start(db, id);
    }
    // Mémoire sauvegardée chaque minute : un redémarrage reprend l'historique sans temps de chauffe
    if (Date.now() - (S.memAt || 0) > 60000) {
      S.memAt = Date.now();
      const hist: any = {};
      for (const [id, h] of S.hist) { const n = h[h.length - 1]; const k = h.filter((s: Sample) => n.min - s.min <= 12); if (k.length) hist[id] = k; }
      const data = { key: "main", hist, saved_at: new Date().toISOString() };
      (S.memId ? db.PressureState.update(S.memId, data) : db.PressureState.create(data).then((r: any) => { S.memId = r.id; })).catch(() => null);
    }
    // Bilan de santé toutes les 3 min : quelles données sont réellement disponibles sur les matchs suivis
    if (Date.now() - (S.beatAt || 0) > 180000) {
      S.beatAt = Date.now();
      const cov = [...S.follow.entries()].map(([id, f]: any) => { const h = S.hist.get(id) || [], n = h[h.length - 1]; return { match: f.label, min: S.info.get(id)?.min, stats1xbet: !!n, historique_min: h.length ? n.min - h[0].min : 0, fotmob: !!f.fm, cote: f.odds?.o ?? null }; });
      db.AppLog.create({ area: "scanner_pression", action: "sante", level: "info", ok: true, message: `${S.hist.size} matchs mesurés, ${S.follow.size} suivis`, details: { suivis: cov, erreur: S.err || null } }).catch(() => null);
    }
    // 3. Matchs suivis : relevé à la seconde
    await Promise.all([...S.follow.entries()].map(([id, f]) => tick(db, id, f).catch((e) => { S.err = String(e?.stack || e).slice(0, 400); })));
    await sleep(1000);
  }
}

async function start(db: any, id: number) {
  const i = S.info.get(id);
  const label = `${i.home} - ${i.away}`;
  const sel = selected(i.home, i.away);
  const fotmob = sel?.fotmob ?? await fotmobFind(i.home, i.away).catch(() => null);
  // Une seule fiche par match, même si deux machines tournent en même temps
  const ex: any = await db.PressureLive.filter({ xbet_id: id, status: "live" }, "-created_date", 1).catch(() => null);
  const rec = ((Array.isArray(ex) ? ex : ex?.items) || [])[0] || await dbRetry(() => db.PressureLive.create({ xbet_id: id, fotmob_id: fotmob ?? undefined, match_label: label, league: i.league, status: "live", minute: i.min, score: i.sc.join("-"), updated_at: new Date().toISOString() })).catch(() => null);
  if (rec?.id && sel) db.PressureLive.update(rec.id, { context: { ...sel.ctx, late: sel.late, prematch: { score: sel.score, parts: sel.parts } } }).catch(() => null);
  S.follow.set(id, { rec: rec?.id, label, fotmob, sel, ctx: sel?.ctx, late: sel?.late, fm: null, fmAt: 0, t22: S.t22.find((t: any) => sameTeam(t.home, i.home) && sameTeam(t.away, i.away))?.id, odds: null, oddsAt: 0, series: [], sig: new Set<string>(), pending: [] as any[] });
}

async function end(db: any, id: number, f: any, status: string) {
  S.follow.delete(id);
  const i = S.info.get(id);
  const fin = status === "ended" && f.s85 && i ? { score: i.sc.join("-"), late_goal: i.sc[0] + i.sc[1] > f.s85.goals } : {};
  if (f.rec) await db.PressureLive.update(f.rec, { status, ...fin, updated_at: new Date().toISOString() }).catch(() => null);
  for (const p of f.pending) {
    // Sorti du direct après la 85e sans nouveau but = perdu ; sinon annulé au bout de 3 h
    if (status === "ended" && (i?.min ?? 0) >= 85) await dbRetry(() => db.PressureSignal.update(p.id, { status: "lost", last_score: i.sc.join("-"), last_minute: i.min, settled_at: new Date().toISOString() })).catch(() => null);
  }
}

async function tick(db: any, id: number, f: any) {
  const v = await detail(id);
  if (!v) return;
  const min = Math.floor((v.SC?.TS || 0) / 60), sc: [number, number] = [Number(v.SC?.FS?.S1 || 0), Number(v.SC?.FS?.S2 || 0)];
  const s = toSample(v.SC, min);
  const h = S.hist.get(id) || [];
  if (s) { if (h.length && h[h.length - 1].min === min) h[h.length - 1] = s; else h.push(s); S.hist.set(id, h); }
  const i = S.info.get(id); if (i) { i.min = min; i.sc = sc; }
  // Signaux en cours : but marqué = gagné
  for (const p of [...f.pending]) if (sc[0] + sc[1] > p.goals) {
    await dbRetry(() => db.PressureSignal.update(p.id, { status: "won", goal_minute: min, last_score: sc.join("-"), last_minute: min, settled_at: new Date().toISOString() })).catch(() => null);
    f.pending = f.pending.filter((x: any) => x !== p);
  }
  // Alerte « avant la pause » : 2e mi-temps commencée sans but = perdu
  if (min >= 46) for (const p of [...f.pending]) if (p.mt1) {
    await dbRetry(() => db.PressureSignal.update(p.id, { status: "lost", last_score: sc.join("-"), last_minute: min, settled_at: new Date().toISOString() })).catch(() => null);
    f.pending = f.pending.filter((x: any) => x !== p);
  }
  const mt1 = min <= 45;
  // FotMob toutes les 30 s, cotes « +1 but » toutes les 3 s
  if (f.fotmob && Date.now() - f.fmAt > 30000) { f.fmAt = Date.now(); f.fm = await fotmobDetails(f.fotmob).catch(() => f.fm); if (f.fm && !f.fm.covered) f.fm = null; }
  const line = sc[0] + sc[1] + 0.5;
  if (Date.now() - f.oddsAt > 3000) {
    f.oddsAt = Date.now();
    const [x, t] = await Promise.all([xbetSnap(id), f.t22 ? xbetSnap(f.t22, T22, "") : null]);
    const mk = `${mt1 ? "H1TOT" : "TOT"}_${line}`;
    const o = [["1xBet", x], ["22Bet", t]].map(([b, m]: any) => ({ b, o: m && !m.locked.has(mk) ? m.mk[mk]?.[0] : null })).filter((z) => z.o);
    f.odds = o.sort((a, b) => b.o - a.o)[0] || null;
    // Historique de la cote sur la même ligne (2 dernières minutes) : une baisse = le marché croit au but
    if (f.oh?.line !== mk) f.oh = { line: mk, pts: [] };
    if (f.odds) { f.oh.pts.push({ t: Date.now(), o: f.odds.o }); f.oh.pts = f.oh.pts.filter((p: any) => Date.now() - p.t <= 120000); }
  }
  if (h.length < 2) return;
  const first = f.oh?.pts?.[0], oddDrop = first && f.odds && Date.now() - first.t >= 60000 ? first.o - f.odds.o : null;
  const m = compute(h, f.fm, sc, f.odds?.o ?? null, mt1 ? 47 : 94, oddDrop);
  const key = `${mt1 ? "mt1" : "fin"}_${line}`;
  // Filtres tirés de l'analyse des perdus : fin de match uniquement (85e+), une seule équipe qui pousse,
  // Peu importe le score : l'équipe qui pousse doit avoir un profil de buts tardifs
  // Profil d'avant-match (FotMob) : calculé une fois, dès que le match est suivi
  if (f.fotmob && f.late === undefined) { f.late = null; f.late = await lateProfile(f.fotmob).catch(() => null); }
  // Contexte du match (classement, enjeu, favori, confrontations, forme) : enregistré pour chaque match suivi
  if (f.fotmob && f.ctx === undefined) {
    f.ctx = null; f.ctx = await matchContext(f.fotmob).catch(() => null);
    if (f.rec && (f.ctx || f.late)) db.PressureLive.update(f.rec, { context: { ...(f.ctx || {}), late: f.late } }).catch(() => null);
  }
  // Photo à la 85e (même sans signal) : sert à mesurer plus tard ce qui annonce un but tardif
  if (!mt1 && min >= 85 && !f.s85) {
    f.s85 = snap85(f.ctx, sc, f.fm, s);
    if (f.rec) db.PressureLive.update(f.rec, { snap85: f.s85 }).catch(() => null);
  }
  // Temps additionnel annoncé vers la 90e : ajouté à la photo dès qu'il est connu
  if (f.s85 && f.s85.added_time == null && f.fm?.added90) {
    f.s85.added_time = f.fm.added90;
    if (f.rec) db.PressureLive.update(f.rec, { snap85: f.s85 }).catch(() => null);
  }
  // Décision 85e–90e : note d'avant-match + situation du match (la cote ne filtre pas, il faut juste un marché ouvert)
  const dec = !mt1 && min >= 85 && min <= 90 && f.sel && f.s85 && m.odd && m.span >= 5 ? lateDecision(f.sel, sc, m, f.s85, s?.rc ?? null) : null;
  if (dec?.go && !f.sig.size) {
    f.sig.add(key);
    // Une seule opportunité par match, même si une autre machine du scanner tourne en parallèle
    const since = new Date(Date.now() - 3 * 3600e3).toISOString();
    // Cette version du SDK renvoie une liste (pas { items }) : on lit les deux formes.
    const seen = async () => {
      const r: any = await dbRetry(() => db.PressureSignal.filter({ $or: [{ xbet_id: id }, { match_label: f.label }], created_date: { $gte: since } }, "created_date", 10));
      return (Array.isArray(r) ? r : r?.items) || [];
    };
    const before = await seen().catch(() => null);
    if (!before || before.length) return; // déjà signalé (ou base illisible : on ne risque pas un doublon)
    let rec = await dbRetry(() => db.PressureSignal.create({ xbet_id: id, match_label: f.label, league: i?.league, minute: min, score: sc.join("-"), line, odd: m.odd, odd_book: f.odds?.b, prob: m.prob, prob10: m.prob10, value_pct: m.value, side: m.side, stars: m.stars, period: mt1 ? "mt1" : "fin", metrics: m, context: { ...(f.ctx || {}), late: f.late, s85: f.s85, prematch: { score: f.sel.score, parts: f.sel.parts }, decision: dec }, description: `Avant-match ${f.sel.score}/100, décision ${dec.total}/100`, status: "pending" })).catch(() => null);
    // Deux machines au même instant : seul le plus ancien signal reste
    const after = rec?.id ? await seen().catch(() => []) : [];
    if (after.length > 1 && after[0].id !== rec.id) { await db.PressureSignal.delete(rec.id).catch(() => null); rec = null; }
    if (rec?.id) { f.pending.push({ id: rec.id, goals: sc[0] + sc[1], mt1 }); S.signals++; }
  }
  // Fiche en direct : enregistrée toutes les 30 s (économie d'écritures)
  const last = f.series[f.series.length - 1];
  if (!last || last.m !== min) f.series.push({ m: min, da: s ? s.da[0] + s.da[1] : null, appm: m.appm10, mom: m.mom10, p: m.prob10 });
  if (f.series.length > 45) f.series.shift();
  if (f.rec && Date.now() - (f.savedAt || 0) > 30000) {
    f.savedAt = Date.now();
    dbRetry(() => db.PressureLive.update(f.rec, { minute: min, score: sc.join("-"), metrics: { ...m, line, odd_book: f.odds?.b }, series: f.series, updated_at: new Date().toISOString() }))
      .then(() => { if (String(S.err).startsWith("save")) S.err = null; })
      .catch((e: any) => { f.savedAt = Date.now() - 25000; S.err = "save " + String(e?.message || e).slice(0, 300); }); // nouvel essai dans 5 s
  }
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const db = base44.asServiceRole.entities as any;
  const body = await req.json().catch(() => ({}));
  const t0 = Date.now(), seconds = Math.min(Number(body.seconds || 60), 1800);
  S.until = Math.max(S.until, Date.now() + seconds * 1000);
  if (!S.running) {
    // Au démarrage d'une machine : les fiches « en direct » d'une machine précédente sont closes, les signaux orphelins aussi
    const old = (await db.PressureLive.filter({ status: "live" }, { limit: 50 }).catch(() => null))?.items || [];
    if (old.length) await db.PressureLive.bulkUpdate(old.map((r: any) => ({ id: r.id, status: "ended" }))).catch(() => null);
    const stale = (await db.PressureSignal.filter({ status: "pending", created_date: { $lt: new Date(Date.now() - 3 * 3600e3).toISOString() } }, { limit: 100 }).catch(() => null))?.items || [];
    if (stale.length) await db.PressureSignal.bulkUpdate(stale.map((r: any) => ({ id: r.id, status: "void" }))).catch(() => null);
    const mem = (await db.PressureState.filter({ key: "main" }, { limit: 1 }).catch(() => null))?.items?.[0];
    if (mem) {
      S.memId = mem.id;
      if (Date.now() - new Date(mem.saved_at).getTime() < 10 * 60e3) for (const [id, h] of Object.entries(mem.hist || {})) S.hist.set(Number(id), h as Sample[]);
    }
    S.running = loop(db).catch((e) => console.error("pression", e)).finally(() => { S.running = null; });
  }
  await Promise.race([S.running, sleep(seconds * 1000)]);
  const summary = { matchsAvecStats: S.hist.size, suivis: [...S.follow.values()].map((f: any) => f.label), signaux: S.signals, erreur: S.err || null };
  await db.AppLog.create({ area: "scanner_pression", action: "cycle", level: "info", ok: true, message: `${summary.matchsAvecStats} matchs mesurés, ${summary.suivis.length} suivis`, duration_ms: Date.now() - t0, details: summary }).catch(() => null);
  return Response.json(summary);
});