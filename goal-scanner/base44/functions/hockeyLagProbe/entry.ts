import { createClientFromRequest } from "../../../sdk-shim.ts";
import { fetchLiveMatches, fetchOddsAndInfo } from "../../shared/onewinLiveWs.ts";
import { listBetpawaCategories, listBetpawaLive } from "../../shared/betpawaLive.ts";
import { sameTeam } from "../../shared/teamMatch.ts";
import { xbetSnap, bpSnap, cbSnap, wParse } from "../../shared/liveMarkets.ts";
import { step, toSignal, verdict, STATS } from "../../shared/probLag.ts";

// Hockey sur glace en observation (aucune mise) :
// 1) retard au but : score lu chaque seconde chez 1xBet, 1win, betPawa et Congobet ;
// 2) probabilités : marchés 1X2 / totaux / totaux d'équipe / les deux marquent lus chaque seconde,
//    même moteur que le football (1xBet bouge, un autre site reste en retard).
const H = { "user-agent": "Mozilla/5.0 Chrome/124", accept: "application/json" };
const CB = "https://hg-event-api-prod.sporty-tech.net/api/";
const CB_H = { accept: "application/json", "user-agent": "Mozilla/5.0 Chrome/120", origin: "https://www.congobet.net", referer: "https://www.congobet.net/sports" };
const FAKE = /virtu|cyber|esport|e-sport|srl|simulat|subhockey|blast|replays|\+/i;
// Pseudo de joueur entre parenthèses = match e-sport (« Dallas Stars (toni) »)
export const isFake = (s: string) => FAKE.test(s) || /\((?!women|u\d|amateur|res)[^)]*\)/i.test(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NAMES: Record<string, string> = { x: "1xBet", w: "1win", b: "betPawa", c: "Congobet" };

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const me = await base44.auth.me().catch(() => null);
  if (me && me.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const { seconds = 160, mode } = await req.json().catch(() => ({}));
  if (mode === "audit") return Response.json(await (await import("./audit.ts")).audit());
  const db = base44.asServiceRole.entities;
  const t0 = Date.now(), stopAt = t0 + Math.min(seconds, 1800) * 1000, runId = new Date(t0).toISOString();

  const cats = await listBetpawaCategories().catch(() => []);
  const bCat = cats.find((c: any) => /hockey/i.test(c.name) && !/field|gazon/i.test(c.name))?.id;
  const wList = (await fetchLiveMatches("hockey").catch(() => [])).filter((m) => !isFake(`${m.home} ${m.away}`));
  const pending = (await db.ProbLagSignal.filter({ status: "pending", sport: "hockey" }, { limit: 200 }).catch(() => ({ items: [] }))).items || [];
  const settle: Record<string, any> = {};
  const M = new Map<number, any>();
  const goals: any[] = [], signals: any[] = [];
  const ticks = { x: 0, w: 0, b: 0, c: 0, mk: 0 };
  let liveIds = new Set<number>();
  const find = (h: string, a: string) => [...M.values()].find((m) => sameTeam(m.home, h) && sameTeam(m.away, a));

  // Score affiché par un site : un total plus haut qu'avant = but (le premier site ouvre la fiche)
  const mark = (m: any, k: string, sc: [number, number] | null, t: number) => {
    if (!sc) return;
    const prev = m.sc[k]; m.sc[k] = sc;
    if (!prev || sc[0] + sc[1] <= prev[0] + prev[1]) return;
    const key = sc.join("-");
    let g = goals.find((e) => e.m === m && e.score === key);
    if (!g) { g = { m, score: key, before: prev.join("-"), side: sc[0] > prev[0] ? "domicile" : "exterieur", min: m.min, seen: {} }; goals.push(g); }
    g.seen[k] ??= t;
  };

  const loopX = async () => { while (Date.now() < stopAt) {
    const t = Date.now();
    const j = await fetch("https://1xbet.cg/service-api/LiveFeed/Get1x2_VZip?sports=2&count=1000&lng=en&mode=4&country=93&partner=159&getEmpty=true", { headers: H, signal: AbortSignal.timeout(4000) }).then((r) => r.json()).catch(() => null);
    if (j?.Value) { ticks.x++; liveIds = new Set(j.Value.map((g: any) => g.I));
      for (const g of j.Value) {
        const home = g.O1E || g.O1, away = g.O2E || g.O2;
        if (isFake(`${g.L} ${home} ${away}`)) continue;
        let m = M.get(g.I);
        if (!m) { m = { x: g.I, name: `${home} - ${away}`, home, away, league: g.LE || g.L, sc: {}, lo: 3, hi: 57, span: 4.5 }; M.set(g.I, m); }
        m.min = Math.floor((g.SC?.TS || 0) / 60);
        const sc: [number, number] = [Number(g.SC?.FS?.S1 || 0), Number(g.SC?.FS?.S2 || 0)];
        mark(m, "x", sc, t);
        for (const s of pending) if (s.xbet_id === g.I && !settle[s.id]?.status) {
          const v = verdict(s, sc, false);
          settle[s.id] = { last_score: sc.join("-"), last_minute: m.min, ...(v ? { status: v, settled_at: new Date().toISOString() } : {}) };
        }
      } }
    await sleep(Math.max(0, 1000 - (Date.now() - t)));
  } };
  const loopB = async () => { if (!bCat) return; while (Date.now() < stopAt) {
    const t = Date.now();
    const l = await listBetpawaLive(bCat).catch(() => null);
    if (l) { ticks.b++; for (const e of l) { const m = find(e.home, e.away); const p = String(e.score || "").split("-").map(Number); if (!m) continue; m.b = e.id; if (p.length === 2 && p.every(Number.isFinite)) mark(m, "b", [p[0], p[1]], t); } }
    await sleep(Math.max(0, 1000 - (Date.now() - t)));
  } };
  // 1win : score et cotes dans le même relevé
  const loopW = async () => { if (!wList.length) return; while (Date.now() < stopAt) {
    const t = Date.now();
    const { info, odds } = await fetchOddsAndInfo(wList.map((m) => m.id), 3000, 800).catch(() => ({ info: new Map(), odds: new Map() }));
    if (info.size) { ticks.w++; for (const wm of wList) {
      const m = find(wm.home, wm.away); if (!m) continue;
      m.w = wm.id; m.wHome = wm.home; m.wOdds = odds.get(wm.id);
      const i: any = info.get(wm.id);
      if (i && i.scoreHome != null && i.scoreAway != null) mark(m, "w", [i.scoreHome, i.scoreAway], t);
    } }
    await sleep(Math.max(0, 1000 - (Date.now() - t)));
  } };
  const loopC = async () => { while (Date.now() < stopAt) {
    const t = Date.now();
    const page = await fetch(`${CB}events/sports/live?offset=0&length=100`, { headers: CB_H, signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => null);
    if (Array.isArray(page)) { ticks.c++;
      for (const e of page) {
        if (e.isVirtual || String(e.categoryPath || "").startsWith("/101/")) continue;
        const m = find(e.homeTeamName, e.awayTeamName), p = String(e.score || "").split(":").map(Number);
        if (!m) continue; m.c = String(e.id);
        if (p.length === 2 && p.every(Number.isFinite)) mark(m, "c", [p[0], p[1]], t);
      } }
    await sleep(Math.max(0, 2000 - (Date.now() - t)));
  } };
  // Probabilités : matchs présents chez au moins un autre site, chaque seconde
  const loopMk = async () => { await sleep(2000); while (Date.now() < stopAt) {
    const t = Date.now();
    await Promise.all([...M.values()].filter((m) => m.w || m.b || m.c).map(async (m) => {
      const [x, b, c] = await Promise.all([xbetSnap(m.x), m.b ? bpSnap(m.b) : null, m.c ? cbSnap(m.c) : null]);
      if (!x) return;
      const wl = new Set<string>(), w = m.w ? wParse(m.wOdds, m.wHome, wl) : null;
      step(m, { at: Date.now(), sc: [x.sh, x.sa], min: x.min, x: x.mk, xl: x.locked, w, wl, b: b?.mk || null, bl: b?.locked, c: c?.mk || null, cl: c?.locked }, signals);
    }));
    ticks.mk++;
    await sleep(Math.max(0, 1000 - (Date.now() - t)));
  } };
  await Promise.all([loopX(), loopB(), loopW(), loopC(), loopMk()]);
  for (const m of M.values()) for (const p of m.pend || []) signals.push(p);
  const sigRecs = signals.map((p) => ({ ...toSignal(p, runId), sport: "hockey" }));
  if (sigRecs.length) await db.ProbLagSignal.bulkCreate(sigRecs).catch(() => null);
  // Match disparu du direct : terminé au dernier score (55e passée) sinon annulé après 3 h
  for (const s of pending) {
    const u = settle[s.id] || {};
    if (u.status || liveIds.has(s.xbet_id)) continue;
    const min = u.last_minute ?? s.last_minute, sc = String(u.last_score ?? s.last_score).split("-").map(Number) as [number, number];
    if (min >= 55) settle[s.id] = { ...u, status: verdict(s, sc, true), settled_at: new Date().toISOString() };
    else if (Date.now() - new Date(s.created_date).getTime() > 3 * 3600e3) settle[s.id] = { ...u, status: "void", settled_at: new Date().toISOString() };
  }
  const upd = Object.entries(settle).map(([id, v]) => ({ id, ...v }));
  if (upd.length) await db.ProbLagSignal.bulkUpdate(upd).catch(() => null);

  // Retard de chaque site par rapport au premier qui affiche le but (en secondes)
  // Seuls les matchs présents chez au moins un autre site que 1xBet permettent de mesurer un retard
  const recs = goals.filter((g) => g.m.w || g.m.b || g.m.c).map((g) => {
    const first = Math.min(...Object.values(g.seen) as number[]);
    const fb = Object.entries(g.seen).find(([, v]) => v === first)![0];
    const books = ["x", "w", "b", "c"].filter((k) => k === "x" || g.m[k]);
    return {
      sport: "hockey", run_id: runId, match_label: g.m.name, league: g.m.league, minute: g.min, score_before: g.before, score_after: g.score, scoring_side: g.side,
      detected_at: new Date(first).toISOString(), first_book: NAMES[fb], books: books.map((k) => NAMES[k]),
      ...Object.fromEntries(Object.entries(g.seen).map(([k, v]) => [`${k}_seen_s`, Math.round(((v as number) - first) / 100) / 10])),
      playable: false, timeline: books.map((k) => `${NAMES[k]} : ${g.seen[k] == null ? "pas encore affiché" : `+${Math.round((g.seen[k] - first) / 100) / 10} s`}`),
    };
  });
  if (recs.length) await db.GoalLagEvent.bulkCreate(recs).catch(() => null);
  const all = [...M.values()];
  const summary = {
    matchs: all.length, avec1win: all.filter((m) => m.w).length, avecBetpawa: all.filter((m) => m.b).length, avecCongobet: all.filter((m) => m.c).length,
    liste1win: wList.length, categorieBetpawa: bCat ?? null, releves: ticks, buts: recs.length, signauxProba: sigRecs.length, filtreProba: { ...STATS }, resultatsMisAJour: upd.length,
  };
  await db.AppLog.create({ area: "scanner_hockey", action: "cycle", level: "info", ok: true, message: `${summary.matchs} matchs hockey, ${summary.buts} buts, ${summary.signauxProba} signaux`, duration_ms: Date.now() - t0, details: summary }).catch(() => null);
  return Response.json({ ...summary, buts_detail: recs.map((r) => `${r.match_label} ${r.score_after} premier ${r.first_book}`), signaux: sigRecs.map((r) => `${r.match_label} ${r.minute}' [${r.market_label}] ${r.book} @${r.book_odd} +${r.edge_pct}%`) });
});