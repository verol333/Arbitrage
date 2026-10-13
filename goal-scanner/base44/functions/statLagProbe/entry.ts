import { createClientFromRequest } from "../../../sdk-shim.ts";
import { fetchLiveMatches, fetchOddsAndInfo } from "../../shared/onewinLiveWs.ts";
import { sameOpponents, sameTeam } from "../../shared/teamMatch.ts";
import { H, sleep } from "../../shared/liveMarkets.ts";
import { OnewinStream } from "../../shared/onewinStream.ts";
import { hasMarket, wonOptions } from "./won.ts";
type Kind = "corner" | "carton_jaune";

// Relevé à blanc (AUCUNE mise) : chaque fois que 1xBet compte un corner ou un carton jaune,
// on suit 1win pendant 60 s et on note les options déjà gagnées qu'il laisse ouvertes.
const FAKE = /alternat|virtu|cyber|fifa|esport|e-sport|penalt|short|2x2|3x3|4x4|5x5|rush|student|\blfl\b|special|statist|player|joueur|\(sub\)|\bsub\b/i;
const STAT: Record<Kind, number> = { corner: 70, carton_jaune: 26 };
const WINDOW = 60000;

async function xbetStats() {
  const j = await fetch("https://1xbet.cg/service-api/LiveFeed/Get1x2_VZip?sports=1&count=1000&lng=en&mode=4&country=93&partner=159&getEmpty=true", { headers: H, signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => null);
  return (j?.Value || []).filter((g: any) => !FAKE.test(g.L || "") && !FAKE.test(`${g.O1E || g.O1} ${g.O2E || g.O2}`)).map((g: any) => {
    const st = g.SC?.ST?.[0]?.Value || [];
    const v = (id: number) => { const s = st.find((x: any) => x.ID === id); return s ? [Number(s.S1 || 0), Number(s.S2 || 0)] : null; };
    return { id: g.I, home: g.O1E || g.O1, away: g.O2E || g.O2, league: g.LE || g.L || "", min: Math.floor((g.SC?.TS || 0) / 60), corner: v(70), carton_jaune: v(26) };
  });
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const me = await base44.auth.me().catch(() => null);
  if (me && me.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const db = base44.asServiceRole.entities;
  const run_id = crypto.randomUUID().slice(0, 8), t0 = Date.now(), stopAt = t0 + Number(body.seconds || 135) * 1000;
  const stream = new OnewinStream(() => {});
  stream.start();
  const pairs = new Map<number, any>(); // id 1xBet → { w, wHome, wAway, swap }
  const last = new Map<string, number[]>(); // `${id}|${kind}` → compteur précédent
  const open: any[] = [], done: any[] = [];
  const st = { ticks: 0, xbet: 0, paired: 0, w_corner: new Set<number>(), w_card: new Set<number>() };
  let xb: any[] = [], lastPair = 0;

  const pair = async () => {
    const wl = (await Promise.all([0, 100].map((o) => fetchLiveMatches("football", o)))).flat().filter((m) => !m.virtual);
    for (const x of xb) {
      if (pairs.has(x.id)) continue;
      const w = wl.find((m) => sameOpponents(m.home, m.away, x.home, x.away));
      if (w) pairs.set(x.id, { w: w.id, wHome: w.home, wAway: w.away, swap: !sameTeam(w.home, x.home) });
    }
    stream.add([...pairs.values()].map((p) => p.w));
  };
  const close = (e: any, truncated = false) => {
    e.truncated = truncated;
    e.options = Object.values(e.opts).map((o: any) => ({ ...o, open_s: Math.round((o.to - o.from_ms) / 100) / 10, from_s: Math.round(o.from_ms / 100) / 10, to: undefined, from_ms: undefined }));
    e.playable = e.options.some((o: any) => o.open_s >= 2);
    done.push(e);
  };

  while (Date.now() < stopAt) {
    const tick = Date.now();
    xb = await xbetStats();
    if (xb.length) { st.ticks++; st.xbet = xb.length; }
    if (tick - lastPair > 60000) { lastPair = tick; await pair(); st.paired = pairs.size; }
    for (const x of xb) {
      const p = pairs.get(x.id);
      if (!p) continue;
      const g = stream.odds.get(p.w);
      if (hasMarket(g, "corner")) st.w_corner.add(p.w);
      if (hasMarket(g, "carton_jaune")) st.w_card.add(p.w);
      for (const kind of ["corner", "carton_jaune"] as Kind[]) {
        const cur = x[kind] as number[] | null, k = `${x.id}|${kind}`, prev = last.get(k);
        if (!cur) continue;
        // Compteur revenu en arrière : annulé tant qu'il n'est pas revenu (le dernier relevé fait foi).
        for (const e of open) if (e.key === k) e.cancelled = cur[0] + cur[1] < e.after[0] + e.after[1];
        // On garde le plus haut compteur vu : un aller-retour 4 → 3 → 4 n'ouvre pas un second évènement.
        if (prev && cur[0] + cur[1] < prev[0] + prev[1]) continue;
        last.set(k, cur);
        if (!prev || cur[0] + cur[1] !== prev[0] + prev[1] + 1) continue; // un seul évènement à la fois, net
        // Seuls comptent les matchs où 1win propose ce marché (1xBet le compte déjà) : sinon rien à jouer.
        if (!hasMarket(g, kind)) continue;
        const side = (cur[0] > prev[0] ? 0 : 1) as 0 | 1;
        open.push({ key: k, x, p, kind, before: prev, after: cur, side, at: tick, opts: {}, timeline: [], has: hasMarket(g, kind), cancelled: false });
      }
    }
    // Relevé 1win NEUF chaque seconde : le flux continu garde en mémoire les options retirées (cotes figées = faux « ouvert »)
    const ids = [...new Set(open.map((e) => e.p.w))];
    const fresh = ids.length ? await fetchOddsAndInfo(ids, 2500, 600).catch(() => null) : null;
    for (const e of [...open]) {
      const dt = tick - e.at;
      const g = fresh?.odds.get(e.p.w);
      e.has ||= hasMarket(g, e.kind);
      // 1win range ses équipes peut-être dans l'autre ordre que 1xBet
      const sw = (a: number[]) => e.p.swap ? [a[1], a[0]] : a;
      const won = e.cancelled ? [] : wonOptions(g, e.kind, sw(e.before), sw(e.after), (e.p.swap ? 1 - e.side : e.side) as 0 | 1, e.p.wHome, e.p.wAway);
      for (const o of won) {
        const id = `${o.market}|${o.outcome}`;
        e.opts[id] ||= { market: o.market, outcome: o.outcome, odd: o.odd, from_ms: dt };
        e.opts[id].to = dt;
      }
      e.timeline.push(`${Math.round(dt / 1000)}s ${won.length ? won.map((o) => `${o.outcome}@${o.odd}`).join(", ") : "-"}`);
      if (dt >= WINDOW) { open.splice(open.indexOf(e), 1); close(e); }
    }
    await sleep(Math.max(0, 1000 - (Date.now() - tick))); // relevé à la seconde
  }
  stream.stop();
  for (const e of open) close(e, true);

  const recs = done.map((e) => ({
    run_id, kind: e.kind, match_label: `${e.x.home} - ${e.x.away}`, league: e.x.league, minute: e.x.min,
    side: e.side ? "exterieur" : "domicile", count_before: e.before.join("-"), count_after: e.after.join("-"),
    detected_at: new Date(e.at).toISOString(), w_has_market: e.has, playable: e.playable && !e.cancelled,
    options: e.options, cancelled: e.cancelled, truncated: e.truncated, timeline: e.timeline.slice(0, 65),
  }));
  if (recs.length) await db.StatLagEvent.bulkCreate(recs);
  const summary = { run_id, seconds: Math.round((Date.now() - t0) / 1000), ticks: st.ticks, xbet_matches: st.xbet, paired: st.paired,
    w_corner_markets: st.w_corner.size, w_card_markets: st.w_card.size, events: recs.length, with_market: recs.filter((r) => r.w_has_market).length, playable: recs.filter((r) => r.playable).length };
  await db.AppLog.create({ area: "stat_lag", action: "cycle", level: "info", ok: true, book: "1win",
    message: `Relevé corners/cartons : ${summary.paired} matchs reliés, ${summary.w_corner_markets} avec corners chez 1win, ${summary.w_card_markets} avec cartons, ${summary.events} évènements, ${summary.playable} jouables`, details: summary }).catch(() => null);
  return Response.json({ ...summary, sample: recs.slice(0, 5) });
});