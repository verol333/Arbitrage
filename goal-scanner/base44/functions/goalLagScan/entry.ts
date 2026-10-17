import { createClientFromRequest } from "../../../sdk-shim.ts";
// appariement des équipes : version du 16/10
import { fetchLiveMatches, fetchOddsAndInfo } from "../../shared/onewinLiveWs.ts";
import { listBetpawaLive, listBetpawaCategories } from "../../shared/betpawaLive.ts";
import { sameTeam } from "../../shared/teamMatch.ts";
import { sleep, xbetList, xbetSnap, bpSnap, wParse, cbList, cbSnap } from "../../shared/liveMarkets.ts";
import { OnewinStream } from "./onewinStream.ts";
import { type Book, type GoalEv, type Line, BOOKS, newGoal, sample, toRecord, WINDOW_MS } from "./tracker.ts";
import { step, toSignal, verdict, STATS } from "./probLag.ts";
import { createSolo } from "../../shared/soloDrops.ts";
import { fetchOddsAndInfo as wBatch } from "../../shared/onewinLiveWs.ts";
import { createAutoBet, loadOpenBets, settleBet } from "./autoBet.ts";
import { sampleInc, incRecord, INC_MS } from "./incidents.ts";
import { ybList, ybSnap } from "../../shared/yellowbetLive.ts";
import { pnList, pnMarkets, pnSnap } from "../../shared/pinnacleLive.ts";
import { sbList } from "../../shared/sbobetLive.ts";

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
  // Contrôle de la connexion 1win de la mise auto, sans miser
  if (body.mode === "betcheck") return Response.json(await createAutoBet(db, { odds: new Map() }).check());
  if (body.mode === "audit") return Response.json(await (await import("./audit.ts")).audit(db, Number(body.limit || 12)).catch((e: any) => ({ erreur: String(e?.stack || e) })));
  if (body.mode === "h1check") return Response.json(await (await import("./h1check.ts")).h1check(Number(body.limit || 4)).catch((e: any) => ({ erreur: String(e?.stack || e) })));
  if (body.mode === "unlinked") return Response.json(await (await import("./unlinked.ts")).unlinked().catch((e: any) => ({ erreur: String(e?.stack || e) })));
  if (body.mode === "solocheck") {
    const T = (mk: any) => Object.keys(mk || {}).filter((k) => /^TOT_\d+\.5$/.test(k)).length;
    const out: any = {};
    const pl = await pnList().catch((e) => String(e)), pm = await pnMarkets().catch(() => null);
    out.pinnacle = Array.isArray(pl) ? { matchs: pl.length, marches: !!pm, avecTotaux: pm ? pl.filter((e: any) => T(pnSnap(pm, e.kids || []).mk)).length : 0, ex: pl[0] && { sc: pl[0].score, mk: pm && pnSnap(pm, pl[0].kids || []).mk } } : pl;
    const { sbList } = await import("../../shared/sbobetLive.ts");
    const sl = await sbList().catch((e) => String(e));
    out.sbobet = Array.isArray(sl) ? { matchs: sl.length, avecTotaux: sl.filter((e: any) => T(e.mk)).length, ex: sl[0] && { sc: sl[0].score, mk: sl[0].mk } } : sl;
    const cl = await cbList().catch((e) => String(e));
    out.congobet = Array.isArray(cl) ? { matchs: cl.length, ex: cl[0] && { id: cl[0].id, sc: cl[0].score } } : cl;
    if (Array.isArray(cl) && cl[0]) { const c = await cbSnap(cl[0].id).catch((e) => String(e)); out.congobet.snap = typeof c === "string" ? c : { sc: c?.score, tot: T(c?.mk) }; }
    const yl = await ybList().catch((e) => String(e));
    out.yellowbet = Array.isArray(yl) ? { matchs: yl.length } : yl;
    return Response.json(out);
  }
  if (body.mode === "sbcheck") {
    const { sbList } = await import("../../shared/sbobetLive.ts");
    const out: any[] = [];
    const r0 = await fetch("https://www.sbobet.com/euro/live-betting/football", { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124" } }).catch((e) => String(e) as any);
    const t0 = typeof r0 === "string" ? r0 : await r0.text();
    out.push({ status: r0?.status, len: t0.length, debut: t0.slice(0, 300), oev: t0.includes("'oev'"), site: t0.includes("setToken('site'") });
    for (let i = 0; i < 3; i++) { const t = Date.now(); const l = await sbList().catch((e) => String(e)); out.push({ ms: Date.now() - t, n: Array.isArray(l) ? l.length : l, avecTotaux: Array.isArray(l) ? l.filter((e) => Object.keys(e.mk).length).length : 0, ex: Array.isArray(l) ? l.slice(0, 3).map((e) => `${e.home} - ${e.away} ${e.score.join("-")} ${JSON.stringify(e.mk)}`) : null }); }
    return Response.json(out);
  }
  if (body.mode === "selftest") return Response.json(await (await import("./selfTest.ts")).selfTest(db).catch((e: any) => ({ erreur: String(e?.stack || e) })));
  // Essai à blanc du chemin complet (capital → cote → connexion 1win) sur un signal passé, sans miser
  if (body.mode === "replay") {
    const { execBet } = await import("../../shared/probAutoExec.ts");
    const sigs = (await db.ProbLagSignal.filter({ book: "1win", edge_pct: { $gte: 15, $lte: 45 }, book_odd: { $lt: 2.5 }, minute: { $lt: 60 } }, { sort: "-created_date", limit: Number(body.limit || 5) })).items;
    const out = [];
    for (const s of sigs) out.push({ match: s.match_label, market: s.market_label, ...(await execBet(db, { dry: true, o: { id: "test", cf: s.book_odd, status: 1 },
      base: { signal_key: `replay|${s.id}`, source: "prob", xbet_id: s.xbet_id, match_label: s.match_label, minute: s.minute, score: s.score, market_key: s.market_key, market_label: s.market_label, odd: s.book_odd } })) });
    return Response.json({ replay: out });
  }

  const matches = new Map<number, any>();          // clé : identifiant 1xBet
  const byW = new Map<number, any>(), byB = new Map<string, any>();
  const byC = new Map<string, any>(), byY = new Map<string, any>(), byP = new Map<string, any>(), byS = new Map<string, any>();
  let sList: any[] = [];
  let wList: any[] = [], bList: any[] = [], cList: any[] = [], yList: any[] = [], pList: any[] = [];
  const ticks = { x: 0, b: 0, w: 0, c: 0, y: 0, p: 0, s: 0, win: 0 };
  const saved: any[] = [];
  const signals: any[] = [];
  let sent = 0, mkTicks = 0, mkMatches = 0, liveIds = new Set<number>();
  // Signaux « probabilités » en attente de résultat (cycles précédents)
  const pending = (await db.ProbLagSignal.filter({ status: "pending", sport: { $ne: "hockey" } }, { limit: 500 }).catch(() => ({ items: [] }))).items || [];
  const settle: Record<string, any> = {};
  // Chutes de cote : chaque site surveille tous ses propres matchs (aucune liaison entre sites)
  const solo = createSolo(signals, pending, settle);
  let xAll: any[] = [];
  // Paris automatiques 1win encore ouverts
  const openBets = body.mode === "proba" ? await loadOpenBets(db) : [];
  const betSettle: Record<string, any> = {};
  const cancelAsked = new Set<number>();
  const track = (id: number, sc: [number, number], min: number, cp?: number) => {
    for (const b of openBets) if (b.xbet_id === id && !betSettle[b.id]?.status) {
      // But du pari annulé (score revenu sous celui du pari) : pari sorti du bilan + cash-out, un but plus tard ne compte pas
      const bs = String(b.score || "").split("-").map(Number);
      if (b.source === "goal" && bs.length === 2 && (sc[0] < bs[0] || sc[1] < bs[1])) {
        betSettle[b.id] = { status: "void", profit: 0, last_score: sc.join("-"), last_minute: min, settled_at: new Date().toISOString(), error: `But annulé : score revenu à ${sc.join("-")} (pari à ${b.score}) — cash-out demandé` };
        if (!cancelAsked.has(id)) { cancelAsked.add(id); autoBet.cancel({ x: id, w: 1, name: b.match_label }, { sc: bs, betTried: { any: true } }); }
        continue;
      }
      // Option 1re mi-temps : dès que la 1re période est finie, réglée sur le dernier score vu en 1re MT (un but de 2e MT ne compte pas)
      if (/^H1/.test(b.market_key) && cp != null && cp !== 1) {
        const h1 = String(betSettle[b.id]?.last_score ?? b.last_score).split("-").map(Number) as [number, number];
        betSettle[b.id] = { ...settleBet(b, h1, true), last_minute: min };
      } else betSettle[b.id] = { ...settleBet(b, sc, false), last_minute: min };
    }
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
    // Annulation : seulement si 1xBet (référence) revient en arrière sur DEUX relevés de suite.
    // Ses deux sources (liste + fiche du match) se contredisent parfois une seconde : ce n'est pas un but refusé.
    // « En arrière » = une des deux équipes perd un but, même si le total reste égal (but attribué à l'autre équipe : 0-1 → 1-0)
    const back = sc[0] < prev[0] || sc[1] < prev[1];
    if (book === "x") m.xLow = back ? (m.xLow || 0) + 1 : 0;
    // 1er relevé en arrière : ignoré (on garde le score précédent pour comparer au relevé suivant)
    if (book === "x" && back && m.xLow < 2) { m.sc[book] = prev; return; }
    // But fantôme : affiché par UN seul site (aucun autre ne l'a vu), puis ce site revient en arrière sur 2 relevés de suite → annulé
    if (book !== "x") {
      (m.low ||= {})[book] = back ? (m.low[book] || 0) + 1 : 0;
      if (back && m.low[book] >= 2) for (const ev of m.events as GoalEv[]) if (!ev.cancelled && ev.first === book && (ev.sc[0] > sc[0] || ev.sc[1] > sc[1]) && Object.keys(ev.seen).every((k) => k === book)) {
        ev.cancelled = true;
        m.top = Math.min(m.top ?? tot, tot);
        if ((ev as any).recId) db.GoalLagEvent.update((ev as any).recId, { cancelled: true, playable: false }).catch(() => null);
        autoBet.cancel(m, ev);
      }
    }
    if (book === "x" && back) {
      m.top = Math.min(m.top ?? tot, tot);
      for (const ev of m.events as GoalEv[]) if ((ev.sc[0] > sc[0] || ev.sc[1] > sc[1]) && !ev.cancelled) {
        ev.cancelled = true;
        // Fiche déjà enregistrée : on met à jour la même case
        if ((ev as any).recId) db.GoalLagEvent.update((ev as any).recId, { cancelled: true, playable: false }).catch(() => null);
        autoBet.cancel(m, ev); // paris 1win déjà posés sur ce but : cash-out au montant proposé par 1win
      }
    }
    if (tot > ptot && tot > (m.top ?? 0)) {
      m.top = tot;
      if (Date.now() >= stopAt) return; // scan terminé : on ne fait que finir les suivis en cours
      const ev = newGoal(prev, sc, book, at, minute ?? m.min);
      // Totaux 1re MT seulement si 1xBet indique la 1re période (la minute seule se trompe : 45' au début de la 2e MT, 46'+ dans le temps additionnel)
      if (m.cp !== 1) { ev.h1TeamKey = ""; ev.h1MatchKey = ""; }
      else if (!ev.h1MatchKey) { const g = sc[0] + sc[1], n = sc[ev.side === "H" ? 0 : 1]; ev.h1TeamKey = `H1IT${ev.side}_${n - 0.5}`; ev.h1MatchKey = `H1TOT_${g - 0.5}`; }
      // Un site qui affichait DÉJÀ ce score n'est pas « en retard » : sinon sa cote d'une option gagnée passe pour jouable
      for (const k of ["x", "w", "b", "c", "y", "p"] as Book[]) { const o = m.sc[k]; if (k !== book && o && o[0] >= sc[0] && o[1] >= sc[1]) ev.seen[k] = 0; }
      m.events.push(ev);
    }
  };

  const link = (m: any) => {
    if (!m.w) { const w = wList.find((x) => !byW.has(x.id) && sameTeam(x.home, m.home) && sameTeam(x.away, m.away)); if (w) { m.w = w.id; m.wHome = w.home; byW.set(w.id, m); stream.add([w.id]); } }
    if (!m.b) { const b = bList.find((x) => !byB.has(x.id) && sameTeam(x.home, m.home) && sameTeam(x.away, m.away)); if (b) { m.b = b.id; byB.set(b.id, m); } }
    if (!m.c) { const c = cList.find((x) => !byC.has(x.id) && sameTeam(x.home, m.home) && sameTeam(x.away, m.away)); if (c) { m.c = c.id; byC.set(c.id, m); } }
    if (!m.y) { const y = yList.find((x) => !byY.has(x.id) && sameTeam(x.home, m.home) && sameTeam(x.away, m.away)); if (y) { m.y = y.id; byY.set(y.id, m); } }
    // Pinnacle : mêmes équipes, même catégorie (U20, réserve, féminines) ET même score que 1xBet au moment du lien.
    // Un mauvais lien ferait croire à un but : on préfère ne pas lier.
    if (!m.p && m.sc.x) {
      // Catégorie lue dans équipes + championnat (Pinnacle met « U20 » dans le championnat, 1xBet dans les équipes).
      // Lien si les deux équipes concordent, ou une seule équipe + même score.
      const ok = (x: any) => !byP.has(x.id) && cat(`${x.home} ${x.away} ${x.league}`) === cat(`${m.home} ${m.away} ${m.league}`) && x.score[0] === m.sc.x[0] && x.score[1] === m.sc.x[1];
      const p = pList.find((x) => ok(x) && sameTeam(x.home, m.home) && sameTeam(x.away, m.away))
        || pList.find((x) => ok(x) && (sameTeam(x.home, m.home) || sameTeam(x.away, m.away)));
      if (p) { m.p = p.id; m.pKids = p.kids; byP.set(p.id, m); }
    }
    // SBOBET (chutes de cote seulement) : les DEUX équipes, même catégorie et même score que 1xBet
    if (!m.s && m.sc.x) {
      const s = sList.find((x) => !byS.has(x.id) && cat(`${x.home} ${x.away}`) === cat(`${m.home} ${m.away}`) && x.score[0] === m.sc.x[0] && x.score[1] === m.sc.x[1] && sameTeam(x.home, m.home) && sameTeam(x.away, m.away));
      if (s) { m.s = s.id; byS.set(s.id, m); }
    }
  };
  const cat = (s: string) => [/\bu-?\d{2}\b|youth/i, /\b(ii|b|reserves?)\b/i, /\b(women|w|femenino|feminin|ladies)\b/i].map((r) => (r.test(s) ? 1 : 0)).join("");

  const stream = new OnewinStream((id, sc, at) => { const m = byW.get(id); if (m) onScore(m, "w", sc, at); });
  stream.start();
  const autoBet = createAutoBet(db, stream, { dry: !!body.dry });

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
      if (list.length) { liveIds = new Set(list.map((g: any) => g.id)); xAll = list; }
      for (const g of list) {
        track(g.id, [g.sh, g.sa], g.min, g.cp);
        let m = matches.get(g.id);
        if (!m) { m = { x: g.id, name: `${g.home} - ${g.away}`, home: g.home, away: g.away, league: g.league, sc: {}, events: [] }; matches.set(g.id, m); link(m); }
        m.min = g.min; m.cp = g.cp;
        onScore(m, "x", [g.sh, g.sa], at, g.min);
        // Penalty / carton rouge : on note l'heure, une chute de cote juste après n'est pas un vrai signal
        const ev = `${g.rc?.join("-") || ""}|${g.pen?.join("-") || ""}`;
        if (m.evKey !== undefined && m.evKey !== ev) m.incAt = at;
        m.evKey = ev;
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

  // Yellowbet : liste en direct avec scores toutes les 3 s (observation seule)
  const loopY = async () => {
    while (Date.now() < stopAt) {
      const s = Date.now();
      const l = await ybList().catch(() => null);
      if (l?.length) { yList = l; ticks.y++; }
      const at = Date.now();
      for (const e of yList) { const m = byY.get(e.id); if (m && e.score) onScore(m, "y", e.score, at); }
      for (const m of matches.values()) if (!m.y) link(m);
      await sleep(Math.max(0, 3000 - (Date.now() - s)));
    }
  };

  // Pinnacle : liste en direct avec scores chaque seconde (observation seule, ~20 ms par lecture)
  const loopP = () => every(1000, async (fresh) => {
    const l = await pnList();
    if (!l || !fresh()) return;
    pList = l; ticks.p++;
    const at = Date.now();
    for (const e of pList) { const m = byP.get(e.id); if (!m) continue; m.pKids = e.kids; m.pMode = e.modes.join(" / "); onScore(m, "p", e.score, at); }
    for (const m of matches.values()) if (!m.p) link(m);
  });

  // SBOBET : matchs en direct + totaux de buts (~1,5 s par lecture), pour les chutes de cote uniquement
  const loopS = () => every(5000, async (fresh) => {
    const l = await sbList().catch(() => null);
    if (!l || !fresh()) return;
    sList = l; ticks.s++;
    const at = Date.now();
    for (const e of l) solo.feed("s", e, { at, sc: e.score, mk: e.mk, lk: e.locked });
    for (const e of sList) { const m = byS.get(e.id); if (m) { m.sb = e; m.sc.s = e.score; } }
    for (const m of matches.values()) if (!m.s) link(m);
  });

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
      // Pinnacle : tous les marchés en une seule lecture par seconde
      const pm = open.some(([m]) => m.p) ? await pnMarkets() : null;
      await Promise.all(open.map(async ([m, ev]) => {
        if (Date.now() - ev.t0 > WINDOW_MS) return finish(m, ev, false);
        const p = pm && m.p ? pnSnap(pm, m.pKids || []) : null;
        // 1win : relevé neuf à chaque seconde (le flux continu garde les options retirées en mémoire = cotes figées)
        const [x, b, c, wf, y] = await Promise.all([xbetSnap(m.x), m.b ? bpSnap(m.b) : null, m.c ? cbSnap(m.c) : null, m.w ? fetchOddsAndInfo([m.w], 2500, 600).catch(() => null) : null, m.y ? ybSnap(m.y).catch(() => null) : null]);
        const at = Date.now();
        if (y?.score?.every(Number.isFinite)) onScore(m, "y", y.score, at);
        if (x) onScore(m, "x", [x.sh, x.sa], at, x.min);
        if (b?.score) onScore(m, "b", b.score, at);
        if (c?.score) onScore(m, "c", c.score, at);
        const wl = new Set<string>(), wm = m.w && wf ? wParse(wf.odds.get(m.w) as any, m.wHome, wl) : null;
        // But validé par 1xBet : il a RETIRÉ l'option déjà gagnée (réglée), pas seulement suspendue (VAR / doute).
        // Un relevé isolé peut tomber pendant un trou du flux 1xBet : on exige deux relevés de suite
        // « score avec le but + option retirée ». Si 1xBet remet l'ancien score, le but est en doute : on bloque.
        const xGoal = !!x && x.sh + x.sa >= ev.sc[0] + ev.sc[1];
        const xOk = xGoal && Object.keys(x!.mk).length > 0 && !x!.mk[ev.matchKey];
        // RAPIDITÉ (2026-10-14) : on n'attend plus que 1xBet règle l'option (souvent 10 s de « suspendu »).
        // But retenu dès que 1xBet affiche le score ET qu'un 2e site l'affiche aussi — ou que 1xBet a retiré l'option.
        // RÈGLE (2026-10-15) : un seul site qui affiche le but suffit, mise immédiate sans autre confirmation.
        // Seul un but annulé (score revenu en arrière) arrête la mise.
        void xOk;
        (ev as any).xRemoved = !ev.cancelled;
        queueMicrotask(() => autoBet.goal(m, ev));
        sample(ev, at, {
          x: x ? { sc: m.sc.x, team: line(x.mk, x.locked, ev.teamKey), match: line(x.mk, x.locked, ev.matchKey) } : null,
          w: wm ? { sc: m.sc.w || null, team: line(wm, wl, ev.teamKey), match: line(wm, wl, ev.matchKey), h1team: line(wm, wl, ev.h1TeamKey), h1match: line(wm, wl, ev.h1MatchKey) } : null,
          b: b ? { sc: m.sc.b || null, team: line(b.mk, b.locked, ev.teamKey), match: line(b.mk, b.locked, ev.matchKey), h1team: line(b.mk, b.locked, ev.h1TeamKey), h1match: line(b.mk, b.locked, ev.h1MatchKey) } : null,
          c: c ? { sc: m.sc.c || null, team: line(c.mk, c.locked, ev.teamKey), match: line(c.mk, c.locked, ev.matchKey), h1team: line(c.mk, c.locked, ev.h1TeamKey), h1match: line(c.mk, c.locked, ev.h1MatchKey) } : null,
          y: y ? { sc: m.sc.y || null, team: line(y.mk, y.locked, ev.teamKey), match: line(y.mk, y.locked, ev.matchKey), h1team: line(y.mk, y.locked, ev.h1TeamKey), h1match: line(y.mk, y.locked, ev.h1MatchKey) } : null,
          p: p ? { sc: m.sc.p || null, team: line(p.mk, p.locked, ev.teamKey), match: line(p.mk, p.locked, ev.matchKey), h1team: line(p.mk, p.locked, ev.h1TeamKey), h1match: line(p.mk, p.locked, ev.h1MatchKey) } : null,
        });
      }));
      ticks.win++;
      await sleep(Math.max(0, 1000 - (Date.now() - s)));
    }
  };

  // Penalty / carton rouge : observation seule, relevé des trois sites chaque seconde pendant 60 s
  let incSaved = 0;
  const loopInc = async () => {
    const end = Math.min(stopAt + INC_MS, t0 + (MAXS + 8) * 1000);
    while (Date.now() < end) {
      const s = Date.now();
      const open: [any, any][] = [];
      for (const m of matches.values()) for (const inc of m.inc || []) if (!inc.done) open.push([m, inc]);
      if (Date.now() >= stopAt && !open.length) break;
      await Promise.all(open.map(async ([m, inc]) => {
        if (Date.now() - inc.t0 > INC_MS) {
          inc.done = true;
          if (inc.q.w.some(Boolean) || inc.q.b.some(Boolean)) { incSaved++; await db.IncidentLagEvent.create(incRecord(inc, m, runId)).catch(() => null); }
          return;
        }
        const [x, b, wf] = await Promise.all([xbetSnap(m.x), m.b ? bpSnap(m.b) : null, m.w ? fetchOddsAndInfo([m.w], 2500, 600).catch(() => null) : null]);
        const wl = new Set<string>(), wm = m.w && wf ? wParse(wf.odds.get(m.w) as any, m.wHome, wl) : null;
        sampleInc(inc, Date.now(), { x: x ? { mk: x.mk, lk: x.locked } : null, w: wm ? { mk: wm, lk: wl } : null, b: b ? { mk: b.mk, lk: b.locked } : null });
      }));
      await sleep(Math.max(0, 1000 - (Date.now() - s)));
    }
  };

  // Probabilités : marchés « buts » des matchs présents chez au moins un autre site, chaque seconde
  const loopMk = async () => {
    await sleep(1500);
    while (Date.now() < stopAt) {
      const s = Date.now();
      const list = [...matches.values()].filter((m) => m.w || m.b || m.c || m.y || m.p || m.s);
      mkMatches = Math.max(mkMatches, list.length);
      // Pinnacle : tous ses marchés en une lecture par seconde (chutes de cote)
      const pm = list.some((m) => m.p) ? await pnMarkets().catch(() => null) : null;
      await Promise.all(list.map(async (m) => {
        const p = pm && m.p ? pnSnap(pm, m.pKids || []) : null;
        const [x, b, c, y] = await Promise.all([xbetSnap(m.x), m.b ? bpSnap(m.b) : null, m.c ? cbSnap(m.c) : null, m.y ? ybSnap(m.y).catch(() => null) : null]);
        if (!x) return;
        if (y?.score?.every(Number.isFinite)) m.sc.y = y.score;
        const wl = new Set<string>(), w = m.w ? wParse(stream.odds.get(m.w), m.wHome, wl) : null;
        step(m, { at: Date.now(), sc: [x.sh, x.sa], min: x.min, x: x.mk, xl: x.locked, w, wl, b: b?.mk || null, bl: b?.locked, c: c?.mk || null, cl: c?.locked, y: y?.mk || null, yl: y?.locked, p: p?.mk || null, pl: p?.locked, s: m.sb?.mk || null, sl: m.sb?.locked } as any, signals);
        autoBet.scan(m);
      }));
      mkTicks++;
      // Envoi immédiat des signaux terminés (sans attendre la fin du cycle)
      if (signals.length > sent) { const batch = signals.slice(sent); sent = signals.length; db.ProbLagSignal.bulkCreate(batch.map((p) => toSignal(p, runId))).catch(() => null); }
      await sleep(Math.max(0, 1000 - (Date.now() - s)));
    }
  };

  // Chutes de cote : chaque site relit en boucle les marchés de TOUS ses matchs en direct (toutes les ~2 s)
  const soloLoop = async (bk: string, list: () => any[], snap: (e: any) => Promise<any>, conc: number) => {
    await sleep(2000);
    while (Date.now() < stopAt) {
      const s = Date.now(), l = list();
      let i = 0;
      await Promise.all(Array.from({ length: conc }, async () => {
        while (i < l.length && Date.now() < stopAt) {
          const e = l[i++];
          const sn = await snap(e).catch(() => null);
          if (sn?.sc?.every(Number.isFinite)) solo.feed(bk, e, sn);
        }
      }));
      await sleep(Math.max(0, 2000 - (Date.now() - s)));
    }
  };
  const bpSc = (v: any) => { const p = String(v || "").split("-").map(Number); return p.length === 2 ? p as [number, number] : null; };
  const soloAll = () => [
    soloLoop("x", () => xAll, async (e) => { const x = await xbetSnap(e.id); return x && { at: Date.now(), min: x.min, sc: [x.sh, x.sa], mk: x.mk, lk: x.locked }; }, 15),
    soloLoop("b", () => bList, async (e) => { const b = await bpSnap(e.id); const m = parseInt(e.minute); return b && { at: Date.now(), min: Number.isFinite(m) ? m : null, sc: b.score || bpSc(e.score), mk: b.mk, lk: b.locked }; }, 10),
    soloLoop("c", () => cList, async (e) => { const c = await cbSnap(e.id); return c && { at: Date.now(), sc: c.score || e.score, mk: c.mk, lk: c.locked }; }, 6),
    soloLoop("y", () => yList, async (e) => { const y = await ybSnap(e.id); return y && { at: Date.now(), sc: y.score || e.score, mk: y.mk, lk: y.locked }; }, 6),
    // 1win : lots de 40 matchs par connexion
    soloLoop("w", () => { const out = []; for (let i = 0; i < wList.length; i += 40) out.push({ id: `lot${i}`, home: "", away: "", lot: wList.slice(i, i + 40) }); return out; }, async (g) => {
      const r = await wBatch(g.lot.map((x: any) => x.id), 4000, 800);
      const at = Date.now();
      for (const x of g.lot) {
        const inf = r.info.get(x.id), o = r.odds.get(x.id);
        if (!o || inf?.scoreHome == null || inf?.scoreAway == null) continue;
        const lk = new Set<string>();
        solo.feed("w", x, { at, min: inf.minute, sc: [inf.scoreHome, inf.scoreAway], mk: wParse(o as any, x.home, lk), lk });
      }
      return null;
    }, 3),
    // Pinnacle : tous les marchés en une lecture
    soloLoop("p", () => [{ id: "all", home: "", away: "" }], async () => {
      const pm = await pnMarkets(); const at = Date.now();
      if (pm) for (const e of pList) { const p = pnSnap(pm, e.kids || []); solo.feed("p", e, { at, sc: e.score, mk: p.mk, lk: p.locked }); }
      return null;
    }, 1),
  ];

  // Deux scanners séparés (chacun son propre serveur) pour garder le rythme d'1 s :
  // mode "buts" = retard au but, mode "proba" = probabilités en avance.
  const proba = body.mode === "proba";
  await Promise.all([loopX(), loopB(), loopC(), loopW(), loopY(), loopP(), proba ? loopMk() : loopWin(), proba ? null : loopInc(), proba ? loopS() : null, ...(proba ? soloAll() : [])]);
  if (!proba) await loopWin(); // fin des suivis ouverts après l'arrêt des relevés
  await autoBet.done(); // les relances lisent encore les cotes 1win en direct
  stream.stop();
  for (const m of matches.values()) for (const p of m.pend || []) signals.push(p);
  const sigRecs = signals.map((p) => toSignal(p, runId));
  if (sigRecs.length > sent) await db.ProbLagSignal.bulkCreate(sigRecs.slice(sent)).catch(() => null);
  // Résultat : match disparu du direct après la 85e = terminé au dernier score ; disparu plus tôt depuis 3 h = annulé
  for (const sig of pending) {
    const u = settle[sig.id] || {};
    if (u.status || liveIds.has(sig.xbet_id) || solo.isLive(sig)) continue;
    const min = u.last_minute ?? sig.last_minute, sc = String(u.last_score ?? sig.last_score).split("-").map(Number) as [number, number];
    const age = Date.now() - new Date(sig.created_date).getTime();
    if (min >= 85 || (sig.book === "Chute" && age > 2 * 3600e3)) settle[sig.id] = { ...u, status: verdict(sig, sc, true), settled_at: new Date().toISOString() };
    else if (Date.now() - new Date(sig.created_date).getTime() > 3 * 3600e3) settle[sig.id] = { ...u, status: "void", settled_at: new Date().toISOString() };
  }
  await autoBet.done();
  for (const b of openBets) {
    const u = betSettle[b.id] || {};
    if (u.status || liveIds.has(b.xbet_id)) continue;
    const min = u.last_minute ?? b.last_minute, sc = String(u.last_score ?? b.last_score).split("-").map(Number) as [number, number];
    if (min >= 85 || (/^H1/.test(b.market_key) && min > 50)) betSettle[b.id] = settleBet(b, sc, true);
    else if (Date.now() - new Date(b.created_date).getTime() > 3 * 3600e3) betSettle[b.id] = { status: "void", profit: 0, settled_at: new Date().toISOString() };
  }
  const bUpd = Object.entries(betSettle).map(([id, v]) => { const { last_minute, ...rest } = v; return { id, ...rest, ...(last_minute != null ? { last_minute } : {}) }; });
  if (bUpd.length) await db.ProbAutoBet.bulkUpdate(bUpd).catch(() => null);
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
    avecYellowbet: all.filter((m) => m.y).length, listeYellowbet: yList.length, relevesYellowbet: ticks.y,
    avecPinnacle: all.filter((m) => m.p).length, listePinnacle: pList.length, relevesPinnacle: ticks.p,
    avecSbobet: all.filter((m) => m.s).length, listeSbobet: sList.length, relevesSbobet: ticks.s,
    releves1xbet: ticks.x, relevesBetpawa: ticks.b,
    rythme1xbet: ticks.x ? `${Math.round(secs / ticks.x * 10) / 10}s` : null,
    rythmeBetpawa: ticks.b ? `${Math.round(secs / ticks.b * 10) / 10}s` : null,
    buts: saved.length, incidents: incSaved, jouables: saved.filter((r) => r.playable).length,
    matchsMarches: mkMatches, rythmeMarches: mkTicks ? `${Math.round(secs / mkTicks * 10) / 10}s` : null,
    signauxProba: sigRecs.length, chutesMatchsSuivis: solo.count(), chutes: sigRecs.filter((r) => r.book === "Chute").length, resultatsMisAJour: upd.length,
    ...(proba ? { filtres: { ...STATS } } : {}),
  };
  await db.AppLog.create({ area: proba ? "scanner_proba" : "scanner_buts", action: "cycle", level: "info", ok: true, message: `${summary.matchs} matchs suivis, ${summary.buts} buts`, duration_ms: Date.now() - t0, details: summary }).catch(() => null);
  return Response.json({ ...summary, miseAuto: autoBet.results, detail: saved.map((r) => `${r.match_label} ${r.score_after} premier ${r.first_book}`), signaux: sigRecs.map((r) => `${r.match_label} ${r.minute}' ${r.score} [${r.market_label}] 1xBet ${r.ref_prob_before}→${r.ref_prob_after}% | ${r.book} @${r.book_odd} (${r.book_prob}%) +${r.edge_pct}% ouvert ${r.open_s}s ${r.followed_s == null ? "pas suivi" : `suit en ${r.followed_s}s`}${r.goal_during ? " BUT" : ""}`) });
});