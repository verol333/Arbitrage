import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import { fetchLiveMatches, fetchOddsAndInfo } from "../../shared/onewinLiveWs.ts";
import { listBetpawaCategories, listBetpawaLive } from "../../shared/betpawaLive.ts";
import { sameTeam } from "../../shared/teamMatch.ts";

// Basket en OBSERVATION (aucune mise) : score lu chaque seconde chez 1xBet, 1win, betPawa, Congobet, Pinnacle.
// Pour chaque panier : premier site à l'afficher + retard de chacun des autres (s).
// Sert à choisir la marge : un panier ne fait gagner aucune option d'avance (les totaux du match restent
// loin du score), l'avantage vient des cotes restées anciennes chez le site en retard.
// Pour ménager les écritures : seuls les paniers avec un retard ≥ 2 s chez un site sont enregistrés (max 60 / cycle).
const H = { "user-agent": "Mozilla/5.0 Chrome/124", accept: "application/json" };
const PN = { "X-API-Key": "CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R", "User-Agent": "Mozilla/5.0", accept: "application/json" };
const CB = "https://hg-event-api-prod.sporty-tech.net/api/";
const CB_H = { accept: "application/json", "user-agent": "Mozilla/5.0 Chrome/120", origin: "https://www.congobet.net", referer: "https://www.congobet.net/sports" };
const FAKE = /virtu|cyber|esport|e-sport|ebasket|2k\d|simulat|\(.*\)/i;
const NAMES: Record<string, string> = { x: "1xBet", w: "1win", b: "betPawa", c: "Congobet", p: "Pinnacle" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok2 = (p: number[]) => p.length === 2 && p.every(Number.isFinite);

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const me = await base44.auth.me().catch(() => null);
  if (me && me.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const { seconds = 160 } = await req.json().catch(() => ({}));
  const db = base44.asServiceRole.entities;
  const t0 = Date.now(), stopAt = t0 + Math.min(seconds, 1800) * 1000, runId = new Date(t0).toISOString();

  const cats = await listBetpawaCategories().catch(() => []);
  const bCat = cats.find((c: any) => /basket/i.test(c.name))?.id;
  const wList = (await fetchLiveMatches("basket").catch(() => [])).filter((m) => !FAKE.test(`${m.home} ${m.away}`));
  const M = new Map<number, any>();
  const baskets: any[] = [];
  const ticks = { x: 0, w: 0, b: 0, c: 0, p: 0 };
  const find = (h: string, a: string) => [...M.values()].find((m) => sameTeam(m.home, h) && sameTeam(m.away, a));

  // Un total plus haut = panier ; un site qui affiche plus tard le même score (ou plus) « rattrape »
  // Vérifications anti-fausse alerte (leçon du tennis) :
  // 1) un site n'est relié au match que si son score est proche de celui de 1xBet (évite un mauvais appariement)
  // 2) le retard compté = dernière lecture RÉUSSIE où le site montrait encore l'ancien score (jamais un trou de lecture)
  // 3) un panier vu par un seul site, ou dont le score recule ensuite, est rejeté
  const mark = (m: any, k: string, sc: [number, number], t: number) => {
    const ref = m.sc.x;
    if (k !== "x" && !m.sc[k] && (!ref || Math.abs(ref[0] - sc[0]) + Math.abs(ref[1] - sc[1]) > 8)) return;
    const prev = m.sc[k]; m.sc[k] = sc;
    if (prev && sc[0] + sc[1] < prev[0] + prev[1]) for (const g of baskets) if (g.m === m && sc[0] + sc[1] < g.sc[0] + g.sc[1]) g.reverted = true;
    for (const g of baskets) {
      if (g.m !== m || g.seen[k] != null) continue;
      if (sc[0] >= g.sc[0] && sc[1] >= g.sc[1]) g.seen[k] = t; else g.stale[k] = t;
    }
    if (!prev || sc[0] + sc[1] <= prev[0] + prev[1] || sc[0] + sc[1] <= (m.top ?? 0)) { m.top = Math.max(m.top ?? 0, sc[0] + sc[1]); return; }
    m.top = sc[0] + sc[1];
    const seen: Record<string, number> = { [k]: t };
    for (const o of Object.keys(m.sc)) { const s = m.sc[o]; if (o !== k && s[0] >= sc[0] && s[1] >= sc[1]) seen[o] = t; }
    baskets.push({ m, sc, before: prev.join("-"), pts: sc[0] + sc[1] - prev[0] - prev[1], side: sc[0] > prev[0] ? "domicile" : "exterieur", seen, stale: {}, period: m.period });
  };
  const loop = async (ms: number, fn: () => Promise<void>) => { while (Date.now() < stopAt) { const t = Date.now(); await fn().catch(() => {}); await sleep(Math.max(0, ms - (Date.now() - t))); } };

  const loopX = () => loop(1000, async () => {
    const j = await fetch("https://1xbet.cg/service-api/LiveFeed/Get1x2_VZip?sports=3&count=1000&lng=en&mode=4&country=93&partner=159&getEmpty=true", { headers: H, signal: AbortSignal.timeout(4000) }).then((r) => r.json());
    if (!j?.Value) return;
    ticks.x++; const t = Date.now();
    for (const g of j.Value) {
      const home = g.O1E || g.O1, away = g.O2E || g.O2;
      if (FAKE.test(`${g.L} ${home} ${away}`)) continue;
      let m = M.get(g.I);
      if (!m) { m = { x: g.I, name: `${home} - ${away}`, home, away, league: g.LE || g.L, sc: {} }; M.set(g.I, m); }
      m.period = g.SC?.CP; m.min = Math.floor((g.SC?.TS || 0) / 60);
      mark(m, "x", [Number(g.SC?.FS?.S1 || 0), Number(g.SC?.FS?.S2 || 0)], t);
    }
  });
  const loopB = () => !bCat ? null : loop(1000, async () => {
    const l = await listBetpawaLive(bCat); if (!l) return;
    ticks.b++; const t = Date.now();
    for (const e of l) { const m = find(e.home, e.away); const p = String(e.score || "").split("-").map(Number); if (m && ok2(p)) { m.b = 1; mark(m, "b", [p[0], p[1]], t); } }
  });
  const loopW = () => !wList.length ? null : loop(1000, async () => {
    const { info } = await fetchOddsAndInfo(wList.map((m) => m.id), 3000, 800);
    if (!info.size) return;
    ticks.w++; const t = Date.now();
    for (const wm of wList) { const m = find(wm.home, wm.away), i: any = info.get(wm.id); if (m && i?.scoreHome != null) { m.w = 1; mark(m, "w", [i.scoreHome, i.scoreAway], t); } }
  });
  const loopC = () => loop(2000, async () => {
    const page = await fetch(`${CB}events/sports/live?offset=0&length=100`, { headers: CB_H, signal: AbortSignal.timeout(5000) }).then((r) => r.json());
    if (!Array.isArray(page)) return;
    ticks.c++; const t = Date.now();
    for (const e of page) { if (e.isVirtual) continue; const m = find(e.homeTeamName, e.awayTeamName), p = String(e.score || "").split(":").map(Number); if (m && ok2(p)) { m.c = 1; mark(m, "c", [p[0], p[1]], t); } }
  });
  const loopP = () => loop(1000, async () => {
    const a = await fetch("https://guest.api.arcadia.pinnacle.com/0.1/sports/4/matchups/live", { headers: PN, signal: AbortSignal.timeout(4000) }).then((r) => r.json());
    if (!Array.isArray(a)) return;
    ticks.p++; const t = Date.now(), done = new Set();
    for (const x of a) {
      const p = x.participants, id = x.parentId || x.id;
      if (done.has(id) || p?.[0]?.alignment !== "home" || x.units && x.units !== "Regular" || FAKE.test(`${x.league?.name} ${p[0].name} ${p[1].name}`)) continue;
      const s = [Number(p[0].state?.score), Number(p[1].state?.score)];
      const m = find(p[0].name, p[1].name);
      if (m && ok2(s)) { done.add(id); m.p = 1; mark(m, "p", [s[0], s[1]], t); }
    }
  });
  await Promise.all([loopX(), loopB(), loopW(), loopC()]); // Pinnacle ne donne pas le score au basket : non lu (loopP gardée pour le jour où il le donnera)

  // Retard de chaque site par rapport au premier ; on ne garde que les matchs suivis chez ≥ 2 sites
  // Retard garanti = dernière lecture où l'ancien score était encore affiché − première apparition
  const all = baskets.filter((g) => !g.reverted && Object.keys(g.seen).length >= 2).map((g) => {
    const books = ["x", "w", "b", "c", "p"].filter((k) => k === "x" || g.m[k]);
    const first = Math.min(...Object.values(g.seen) as number[]);
    const lag: Record<string, number | null> = Object.fromEntries(books.map((k) => [k, g.seen[k] == null ? null : g.stale[k] ? Math.max(0, Math.round((g.stale[k] - first) / 100) / 10) : 0]));
    return { g, books, first, lag, maxLag: Math.max(0, ...Object.values(lag).filter((v) => v != null) as number[]) };
  });
  const recs = all.filter((r) => r.maxLag >= 2).sort((a, b) => b.maxLag - a.maxLag).slice(0, 60).map(({ g, books, first, lag }) => ({
    sport: "basketball", run_id: runId, match_label: g.m.name, league: g.m.league, minute: g.m.min, score_before: g.before, score_after: g.sc.join("-"), scoring_side: g.side,
    detected_at: new Date(first).toISOString(), first_book: NAMES[Object.keys(g.seen).find((k) => g.seen[k] === first)!], books: books.map((k) => NAMES[k]),
    ...Object.fromEntries(Object.entries(lag).filter(([, v]) => v != null).map(([k, v]) => [`${k}_seen_s`, v])),
    playable: false, timeline: [`Panier de ${g.pts} pt${g.pts > 1 ? "s" : ""}${g.period ? `, période ${g.period}` : ""}`, ...books.map((k) => `${NAMES[k]} : ${lag[k] == null ? "pas encore affiché" : `+${lag[k]} s`}`)],
  }));
  if (recs.length) await db.GoalLagEvent.bulkCreate(recs).catch(() => null);

  // Bilan par site : nombre de fois premier + retard moyen quand il n'est pas premier
  const per: Record<string, any> = {};
  for (const k of ["x", "w", "b", "c", "p"]) {
    const v = all.filter((r) => r.lag[k] != null).map((r) => r.lag[k] as number);
    per[NAMES[k]] = { paniers: v.length, premier: v.filter((s) => s === 0).length, retardMoyen: v.length ? Math.round(v.reduce((a, s) => a + s, 0) / v.length * 10) / 10 : null };
  }
  const ms = [...M.values()];
  const summary = {
    matchs: ms.length, avec1win: ms.filter((m) => m.w).length, avecBetpawa: ms.filter((m) => m.b).length, avecCongobet: ms.filter((m) => m.c).length, avecPinnacle: ms.filter((m) => m.p).length,
    releves: ticks, paniers: all.length, enregistres: recs.length, parSite: per,
  };
  await db.AppLog.create({ area: "scanner_basket", action: "cycle", level: "info", ok: true, message: `${summary.matchs} matchs, ${summary.paniers} paniers`, duration_ms: Date.now() - t0, details: summary }).catch(() => null);
  return Response.json(summary);
});