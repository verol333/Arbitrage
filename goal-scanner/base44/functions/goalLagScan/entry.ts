import { createClientFromRequest } from "../../../sdk-shim.ts";
import { fetchLiveMatches } from "../../shared/onewinLiveWs.ts";
import { listBetpawaLive, listBetpawaCategories } from "../../shared/betpawaLive.ts";
import { sameTeam } from "../../shared/teamMatch.ts";
import { sleep, xbetList, xbetSnap, bpSnap, wParse, cbList, cbSnap } from "../../shared/liveMarkets.ts";
import { OnewinStream } from "./onewinStream.ts";
import { type Book, type GoalEv, type Line, newGoal, sample, toRecord, WINDOW_MS } from "./tracker.ts";
import { step, toSignal, verdict, STATS } from "./probLag.ts";

// Scanner « buts » : TOUS les matchs de foot en direct, scores lus chaque seconde chez
// 1xBet et betPawa, poussés en direct par 1win. À chaque but, suivi seconde par seconde
// des options déjà gagnées chez les trois sites pendant 75 s, puis enregistrement.
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const me = await base44.auth.me().catch(() => null);
  if (me && me.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  // Limite de durée : 170 s ici ; le scanner continu sur GitHub la relève (SCAN_MAX_S)
  const MAXS = Number(Deno.env.get("SCAN_MAX_S") || 170);
  const t0 = Date.now(), stopAt = t0 + Math.min(Number(body.seconds || 140), MAXS) * 1000;
  const runId = `${new Date(t0).toISOString()}`;
  const db = base44.asServiceRole.entities;

  const matches = new Map<number, any>();          // clé : identifiant 1xBet
  const byW = new Map<number, any>(), byB = new Map<string, any>();
  const byC = new Map<string, any>();
  let wList: any[] = [], bList: any[] = [], cList: any[] = [];
  const ticks = { x: 0, b: 0, w: 0, c: 0, win: 0 };
  const saved: any[] = [];
  const signals: any[] = [];
  let mkTicks = 0, mkMatches = 0, liveIds = new Set<number>();
  // Signaux « probabilités » en attente de résultat (cycles précédents)
  const pending = (await db.ProbLagSignal.filter({ status: "pending" }, { limit: 500 }).catch(() => ({ items: [] }))).items || [];
  const settle: Record<string, any> = {};
  const track = (id: number, sc: [number, number], min: number) => {
    for (const sig of pending) if (sig.xbet_id === id && !settle[sig.id]?.status) {
      const v = verdict(sig, sc, false);
      settle[sig.id] = { last_score: sc.join("-"), last_minute: min, ...(v ? { status: v, settled_at: new Date().toISOString() } : {}) };
    }
  };

  const onScore = (m: any, book: Book, sc: [number, number], at: number, minute?: number) => {
    const prev: [number, number] | undefined = m.sc[book];
    m.sc[book] = sc;
    for (const ev of m.events as GoalEv[]) if (ev.seen[book] == null && sc[0] >= ev.sc[0] && sc[1] >= ev.sc[1]) ev.seen[book] = at - ev.t0;
    const tot = sc[0] + sc[1];
    // top = plus haut total déjà affiché par un site : un site qui rattrape en retard n'est pas un nouveau but
    if (!prev) { m.top = Math.max(m.top ?? 0, tot); return; }
    const ptot = prev[0] + prev[1];
    // Annulation : seulement si 1xBet (référence) revient en arrière
    if (book === "x" && tot < ptot) {
      m.top = tot;
      for (const ev of m.events as GoalEv[]) if (ev.sc[0] + ev.sc[1] > tot && !ev.cancelled) {
        ev.cancelled = true;
        // Fiche déjà enregistrée : on met à jour la même case
        if ((ev as any).recId) db.GoalLagEvent.update((ev as any).recId, { cancelled: true, playable: false }).catch(() => null);
      }
    }
    if (tot > ptot && tot > (m.top ?? 0)) {
      m.top = tot;
      if (Date.now() >= stopAt) return; // scan terminé : on ne fait que finir les suivis en cours
      const ev = newGoal(prev, sc, book, at, minute ?? m.min);
      // Un site qui affichait DÉJÀ ce score n'est pas « en retard » : sinon sa cote d'une option gagnée passe pour jouable
      for (const k of ["x", "w", "b", "c"] as Book[]) { const o = m.sc[k]; if (k !== book && o && o[0] >= sc[0] && o[1] >= sc[1]) ev.seen[k] = 0; }
      m.events.push(ev);
    }
  };

  const link = (m: any) => {
    if (!m.w) { const w = wList.find((x) => !byW.has(x.id) && sameTeam(x.home, m.home) && sameTeam(x.away, m.away)); if (w) { m.w = w.id; m.wHome = w.home; byW.set(w.id, m); stream.add([w.id]); } }
    if (!m.b) { const b = bList.find((x) => !byB.has(x.id) && sameTeam(x.home, m.home) && sameTeam(x.away, m.away)); if (b) { m.b = b.id; byB.set(b.id, m); } }
    if (!m.c) { const c = cList.find((x) => !byC.has(x.id) && sameTeam(x.home, m.home) && sameTeam(x.away, m.away)); if (c) { m.c = c.id; byC.set(c.id, m); } }
  };

  const stream = new OnewinStream((id, sc, at) => { const m = byW.get(id); if (m) onScore(m, "w", sc, at); });
  stream.start();

  const cats = await listBetpawaCategories().catch(() => []);
  const foot = cats.find((c: any) => /^(football|soccer)$/i.test(c.name.trim()));
  const loadW = async () => {
    const pages = await Promise.all([0, 100, 200, 300].map((o) => fetchLiveMatches("football", o)));
    wList = pages.flat().filter((m) => !m.virtual);
    for (const m of matches.values()) link(m);
  };
  await loadW();

  // 1xBet : liste complète avec scores, chaque seconde
  // Lance fn chaque seconde pile, sans attendre la réponse précédente ; une réponse plus ancienne arrivée en retard est ignorée
  const every = async (ms: number, fn: (fresh: () => boolean) => Promise<void>) => {
    let seq = 0, last = 0;
    const runs: Promise<void>[] = [];
    while (Date.now() < stopAt) {
      const s = Date.now(), n = ++seq;
      runs.push(fn(() => { if (n < last) return false; last = n; return true; }).catch(() => {}));
      await sleep(Math.max(0, ms - (Date.now() - s)));
    }
    await Promise.all(runs);
  };

  const loopX = () => every(1000, async (fresh) => {
    {
      const list = await xbetList();
      if (!fresh()) return;
      const at = Date.now();
      ticks.x++;
      if (list.length) liveIds = new Set(list.map((g: any) => g.id));
      for (const g of list) {
        track(g.id, [g.sh, g.sa], g.min);
        let m = matches.get(g.id);
        if (!m) { m = { x: g.id, name: `${g.home} - ${g.away}`, home: g.home, away: g.away, league: g.league, sc: {}, events: [] }; matches.set(g.id, m); link(m); }
        m.min = g.min;
        onScore(m, "x", [g.sh, g.sa], at, g.min);
      }
    }
  });

  // betPawa : liste complète avec scores, chaque seconde
  const loopB = async () => !foot ? undefined : every(1000, async (fresh) => {
    {
      const l = await listBetpawaLive(foot.id).catch(() => null);
      if (!l || !fresh()) return;
      bList = l;
      const at = Date.now();
      ticks.b++;
      for (const e of bList) {
        const m = byB.get(e.id);
        const p = String(e.score || "").split("-").map(Number);
        if (m && p.length === 2 && p.every(Number.isFinite)) onScore(m, "b", [p[0], p[1]], at);
      }
      for (const m of matches.values()) if (!m.b) link(m);
    }
  });

  // Congobet : liste complète avec scores, chaque seconde
  const loopC = async () => {
    while (Date.now() < stopAt) {
      const s = Date.now();
      const l = await cbList().catch(() => null);
      if (l?.length) cList = l;
      const at = Date.now();
      ticks.c++;
      for (const e of cList) { const m = byC.get(e.id); if (m && e.score) onScore(m, "c", e.score, at); }
      for (const m of matches.values()) if (!m.c) link(m);
      // Liste Congobet lourde (tous les marchés inclus) : relevée toutes les 3 s pour rester sous la limite de calcul
      await sleep(Math.max(0, 3000 - (Date.now() - s)));
    }
  };

  // 1win : nouvelle liste toutes les 30 s (les scores arrivent en direct)
  const loopW = async () => { while (Date.now() < stopAt) { await sleep(30000); if (Date.now() < stopAt) { await loadW(); ticks.w++; } } };

  const line = (mk: any, lk: Set<string>, k: string): Line => mk?.[k] ? { odd: mk[k][0], locked: lk.has(k) } : null;
  const finish = async (m: any, ev: GoalEv, truncated: boolean) => {
    ev.done = true;
    const rec = toRecord(ev, m, runId, truncated);
    saved.push(rec);
    // Même but déjà noté il y a moins de 15 min (annulé puis redonné, ou vu au cycle précédent) : même case
    const since = new Date(Date.now() - 15 * 60e3).toISOString();
    const prev = await db.GoalLagEvent.filter({ match_label: rec.match_label, score_after: rec.score_after, created_date: { $gte: since } }, { limit: 1 }).catch(() => null);
    const old = prev?.items?.[0];
    const r = old ? await db.GoalLagEvent.update(old.id, rec).catch(() => null) : await db.GoalLagEvent.create(rec).catch(() => null);
    (ev as any).recId = old?.id || r?.id;
    // Deux scanners ont pu noter le même but au même instant : on garde la fiche la plus ancienne
    if (!old && r?.id) {
      const twins = (await db.GoalLagEvent.filter({ match_label: rec.match_label, score_after: rec.score_after, created_date: { $gte: since } }, { sort: "created_date", limit: 10 }).catch(() => null))?.items || [];
      if (twins.length > 1) {
        const keep = twins[0], best = twins.some((t: any) => t.playable);
        if (keep.id !== r.id) await db.GoalLagEvent.update(keep.id, { ...rec, playable: rec.playable && best }).catch(() => null);
        (ev as any).recId = keep.id;
        for (const t of twins.slice(1)) await db.GoalLagEvent.delete(t.id).catch(() => null);
      }
    }
  };

  // Suivi des buts : relevé des trois sites chaque seconde pendant 75 s
  // Après la fin du scan, les buts déjà ouverts sont suivis jusqu'au bout (75 s) : plus de « suivi coupé »
  const hardStop = Math.min(stopAt + WINDOW_MS, t0 + (MAXS + 8) * 1000);
  const loopWin = async () => {
    while (Date.now() < hardStop) {
      const s = Date.now();
      const open: [any, GoalEv][] = [];
      for (const m of matches.values()) for (const ev of m.events as GoalEv[]) if (!ev.done) open.push([m, ev]);
      if (Date.now() >= stopAt && !open.length) break;
      await Promise.all(open.map(async ([m, ev]) => {
        if (Date.now() - ev.t0 > WINDOW_MS) return finish(m, ev, false);
        const [x, b, c] = await Promise.all([xbetSnap(m.x), m.b ? bpSnap(m.b) : null, m.c ? cbSnap(m.c) : null]);
        const at = Date.now();
        if (x) onScore(m, "x", [x.sh, x.sa], at, x.min);
        if (b?.score) onScore(m, "b", b.score, at);
        if (c?.score) onScore(m, "c", c.score, at);
        const wl = new Set<string>(), wm = m.w ? wParse(stream.odds.get(m.w), m.wHome, wl) : null;
        sample(ev, at, {
          x: x ? { sc: m.sc.x, team: line(x.mk, x.locked, ev.teamKey), match: line(x.mk, x.locked, ev.matchKey) } : null,
          w: wm ? { sc: m.sc.w || null, team: line(wm, wl, ev.teamKey), match: line(wm, wl, ev.matchKey) } : null,
          b: b ? { sc: m.sc.b || null, team: line(b.mk, b.locked, ev.teamKey), match: line(b.mk, b.locked, ev.matchKey) } : null,
          c: c ? { sc: m.sc.c || null, team: line(c.mk, c.locked, ev.teamKey), match: line(c.mk, c.locked, ev.matchKey) } : null,
        });
      }));
      ticks.win++;
      await sleep(Math.max(0, 1000 - (Date.now() - s)));
    }
  };

  // Probabilités : marchés « buts » des matchs présents chez au moins un autre site, chaque seconde
  const loopMk = async () => {
    await sleep(1500);
    while (Date.now() < stopAt) {
      const s = Date.now();
      const list = [...matches.values()].filter((m) => m.w || m.b || m.c);
      mkMatches = Math.max(mkMatches, list.length);
      await Promise.all(list.map(async (m) => {
        const [x, b, c] = await Promise.all([xbetSnap(m.x), m.b ? bpSnap(m.b) : null, m.c ? cbSnap(m.c) : null]);
        if (!x) return;
        const wl = new Set<string>(), w = m.w ? wParse(stream.odds.get(m.w), m.wHome, wl) : null;
        step(m, { at: Date.now(), sc: [x.sh, x.sa], min: x.min, x: x.mk, xl: x.locked, w, wl, b: b?.mk || null, bl: b?.locked, c: c?.mk || null, cl: c?.locked }, signals);
      }));
      mkTicks++;
      await sleep(Math.max(0, 1000 - (Date.now() - s)));
    }
  };

  // Deux scanners séparés (chacun son propre serveur) pour garder le rythme d'1 s :
  // mode "buts" = retard au but, mode "proba" = probabilités en avance.
  const proba = body.mode === "proba";
  await Promise.all([loopX(), loopB(), loopC(), loopW(), proba ? loopMk() : loopWin()]);
  if (!proba) await loopWin(); // fin des suivis ouverts après l'arrêt des relevés
  stream.stop();
  for (const m of matches.values()) for (const p of m.pend || []) signals.push(p);
  const sigRecs = signals.map((p) => toSignal(p, runId));
  if (sigRecs.length) await db.ProbLagSignal.bulkCreate(sigRecs).catch(() => null);
  // Résultat : match disparu du direct après la 85e = terminé au dernier score ; disparu plus tôt depuis 3 h = annulé
  for (const sig of pending) {
    const u = settle[sig.id] || {};
    if (u.status || liveIds.has(sig.xbet_id)) continue;
    const min = u.last_minute ?? sig.last_minute, sc = String(u.last_score ?? sig.last_score).split("-").map(Number) as [number, number];
    if (min >= 85) settle[sig.id] = { ...u, status: verdict(sig, sc, true), settled_at: new Date().toISOString() };
    else if (Date.now() - new Date(sig.created_date).getTime() > 3 * 3600e3) settle[sig.id] = { ...u, status: "void", settled_at: new Date().toISOString() };
  }
  const upd = Object.entries(settle).map(([id, v]) => ({ id, ...v }));
  if (upd.length) await db.ProbLagSignal.bulkUpdate(upd).catch(() => null);
  // Suivi encore incomplet (limite serveur) : on n'enregistre pas un but à moitié observé
  // Dédoublonnage final : deux cycles qui se chevauchent ont pu créer la même fiche à quelques secondes d'écart
  const since = new Date(Date.now() - 20 * 60e3).toISOString();
  for (const k of new Set(saved.map((r) => `${r.match_label}|${r.score_after}`))) {
    const [label, score] = k.split("|");
    const twins = (await db.GoalLagEvent.filter({ match_label: label, score_after: score, created_date: { $gte: since } }, { sort: "created_date", limit: 10 }).catch(() => null))?.items || [];
    if (twins.length < 2) continue;
    const best = twins.find((t: any) => t.playable) || twins.reduce((a: any, t: any) => ((t.timeline?.length || 0) > (a.timeline?.length || 0) ? t : a));
    for (const t of twins) if (t.id !== best.id) await db.GoalLagEvent.delete(t.id).catch(() => null);
  }

  const all = [...matches.values()];
  const secs = (Date.now() - t0) / 1000;
  const summary = {
    matchs: all.length, avec1win: all.filter((m) => m.w).length, avecBetpawa: all.filter((m) => m.b).length, avecCongobet: all.filter((m) => m.c).length,
    releves1xbet: ticks.x, relevesBetpawa: ticks.b,
    rythme1xbet: ticks.x ? `${Math.round(secs / ticks.x * 10) / 10}s` : null,
    rythmeBetpawa: ticks.b ? `${Math.round(secs / ticks.b * 10) / 10}s` : null,
    buts: saved.length, jouables: saved.filter((r) => r.playable).length,
    matchsMarches: mkMatches, rythmeMarches: mkTicks ? `${Math.round(secs / mkTicks * 10) / 10}s` : null,
    signauxProba: sigRecs.length, resultatsMisAJour: upd.length,
    ...(proba ? { filtres: { ...STATS } } : {}),
  };
  await db.AppLog.create({ area: proba ? "scanner_proba" : "scanner_buts", action: "cycle", level: "info", ok: true, message: `${summary.matchs} matchs suivis, ${summary.buts} buts`, duration_ms: Date.now() - t0, details: summary }).catch(() => null);
  return Response.json({ ...summary, detail: saved.map((r) => `${r.match_label} ${r.score_after} premier ${r.first_book}`), signaux: sigRecs.map((r) => `${r.match_label} ${r.minute}' ${r.score} [${r.market_label}] 1xBet ${r.ref_prob_before}→${r.ref_prob_after}% | ${r.book} @${r.book_odd} (${r.book_prob}%) +${r.edge_pct}% ouvert ${r.open_s}s ${r.followed_s == null ? "pas suivi" : `suit en ${r.followed_s}s`}${r.goal_during ? " BUT" : ""}`) });
});