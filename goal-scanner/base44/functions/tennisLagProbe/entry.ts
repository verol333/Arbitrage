import { createClientFromRequest } from "../../../sdk-shim.ts";

// Tennis en observation (aucune mise) : 1xBet sert de référence. À chaque jeu gagné chez 1xBet,
// on regarde chaque seconde chez betPawa les options déjà gagnées (totaux de jeux du match,
// du joueur, du set, plus de 2.5 sets, vainqueur du set terminé) et combien de temps elles restent ouvertes.
const XH = { "user-agent": "Mozilla/5.0 Chrome/124", accept: "application/json" };
const BH = { accept: "application/json", devicetype: "web", origin: "https://cg.betpawa.com", "x-pawa-brand": "betpawa-congobrazzaville", "x-pawa-language": "fr", "user-agent": "Mozilla/5.0 Chrome/151", cookie: "bp_country=CG" };
const BP = "https://cg.betpawa.com/api/sportsbook/v4";
const FAKE = /virtu|cyber|esport|simulat|setka|\(/i;
const FOLLOW = 45e3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toks = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3);
const bpSurname = (s: string) => toks(s.split("/")[0].split(",")[0]);
const samePlayer = (x: string, b: string) => { const k = bpSurname(b), t = new Set(toks(x.split("/")[0])); return k.length > 0 && k.every((w) => t.has(w)); };

type St = { sets: [number, number][]; sw: [number, number] };
const games = (s: St) => s.sets.reduce((a, v) => [a[0] + v[0], a[1] + v[1]], [0, 0]);
const label = (s: St) => s.sets.map((v) => v.join("-")).join(" ");

// Option déjà gagnée dans l'état s ? (index 0 = Plus de / joueur 1)
function wonIdx(name: string, line: number, s: St): number | null {
  const g = games(s);
  if (/^Total Games - Over\/Under - FT/.test(name)) return g[0] + g[1] > line ? 0 : null;
  if (/^Games Over\/Under Home - FT/.test(name)) return g[0] > line ? 0 : null;
  if (/^Games Over\/Under Away - FT/.test(name)) return g[1] > line ? 0 : null;
  let m = name.match(/^Total Games - Over\/Under - (\d)S/);
  if (m) { const v = s.sets[Number(m[1]) - 1]; return v && v[0] + v[1] > line ? 0 : null; }
  if (/^Total Sets - Over\/Under/.test(name)) return line === 2.5 && s.sw[0] === 1 && s.sw[1] === 1 ? 0 : null;
  m = name.match(/^Moneyline - (\d)S/);
  if (m) { const n = Number(m[1]); if (s.sw[0] + s.sw[1] < n) return null; const v = s.sets[n - 1]; return v ? (v[0] > v[1] ? 0 : 1) : null; }
  return null;
}

function bpState(e: any): St | null {
  const P = e?.results?.participantPeriodResults;
  if (!Array.isArray(P) || P.length < 2) return null;
  const side = (t: string) => P.find((p: any) => p.participant?.type === t)?.periodResults || [];
  const h = side("HOME"), a = side("AWAY");
  const sets: [number, number][] = [];
  for (const p of h) if (/_SET$/.test(p.period?.slug || "")) { const q = a.find((x: any) => x.period?.id === p.period.id); sets.push([Number(p.result) || 0, Number(q?.result) || 0]); }
  const ft = (arr: any[]) => Number(arr.find((x: any) => x.period?.slug === "FULL_TIME_EXCLUDING_OVERTIME")?.result) || 0;
  return { sets, sw: [ft(h), ft(a)] };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const me = await base44.auth.me().catch(() => null);
  if (me && me.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const { seconds = 110 } = await req.json().catch(() => ({}));
  const db = base44.asServiceRole.entities;
  const t0 = Date.now(), stopAt = t0 + Math.min(seconds, 1800) * 1000, endAt = stopAt + FOLLOW, runId = new Date(t0).toISOString();
  const M = new Map<number, any>();
  const evs: any[] = [];
  const ticks = { x: 0, b: 0 };

  const loopX = async () => { while (Date.now() < endAt) {
    const t = Date.now();
    const j = await fetch("https://1xbet.cg/service-api/LiveFeed/Get1x2_VZip?sports=4&count=1000&lng=en&mode=4&country=93&partner=159&getEmpty=true", { headers: XH, signal: AbortSignal.timeout(4000) }).then((r) => r.json()).catch(() => null);
    if (j?.Value) { ticks.x++; for (const g of j.Value) {
      const home = g.O1E || g.O1, away = g.O2E || g.O2;
      if (!home || !away || FAKE.test(`${g.L} ${home} ${away}`)) continue;
      const ps = g.SC?.PS || [];
      if (!ps.length) continue;
      const st: St = { sets: ps.map((p: any) => [Number(p.Value?.S1) || 0, Number(p.Value?.S2) || 0]), sw: [Number(g.SC?.FS?.S1) || 0, Number(g.SC?.FS?.S2) || 0] };
      let m = M.get(g.I);
      if (!m) { M.set(g.I, { name: `${home} - ${away}`, home, league: g.L, x: st, bAt: {} }); continue; }
      const p = games(m.x), n = games(st), pt = p[0] + p[1], nt = n[0] + n[1];
      if (nt < pt) for (const e of evs) if (e.m === m && t - e.at < FOLLOW && nt < e.total) e.cancelled = true;
      if (nt > pt && t < stopAt && !evs.some((e) => e.m === m && e.total === nt && t - e.at < FOLLOW)) {
        const set = st.sw[0] + st.sw[1] > m.x.sw[0] + m.x.sw[1];
        const bAt = m.bAt[nt];
        evs.push({ m, at: t, total: nt, kind: set ? "set" : "jeu", before: m.x, after: st, bSeen: bAt ? (bAt - t) / 1000 : null, opts: new Map(), tl: [] });
      }
      m.x = st;
    } }
    await sleep(Math.max(0, 1000 - (Date.now() - t)));
  } };

  let cat: string | null = null, lastList = 0;
  const loopB = async () => { while (Date.now() < endAt) {
    const t = Date.now();
    if (t - lastList > 10e3) {
      lastList = t;
      if (!cat) { const c = await fetch(`${BP}/categories/list`, { headers: BH }).then((r) => r.json()).catch(() => null); cat = (c?.onlyMeta || []).map((x: any) => x.category).find((x: any) => /^tennis$/i.test(x?.name || ""))?.id || null; }
      if (cat) {
        const q = { queries: [{ query: { eventType: "LIVE", categories: [String(cat)], zones: {} }, skip: 0, take: 100 }] };
        const l = await fetch(`${BP}/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`, { headers: BH, signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => null);
        for (const e of l?.responses?.[0]?.responses || []) {
          const [bh, ba] = (e.participants || []).sort((a: any, b: any) => a.position - b.position).map((p: any) => p.name);
          if (!bh || !ba) continue;
          for (const m of M.values()) if (!m.b && samePlayer(m.home, bh) && samePlayer(m.name.split(" - ")[1] || "", ba)) m.b = String(e.id);
        }
      }
    }
    const linked = [...M.values()].filter((m) => m.b);
    await Promise.all(linked.map(async (m) => {
      const e = await fetch(`${BP}/events/${m.b}`, { headers: BH, signal: AbortSignal.timeout(3500) }).then((r) => r.json()).catch(() => null);
      const s = bpState(e); if (!s) return;
      const now = Date.now(), g = games(s), tot = g[0] + g[1];
      if (!m.bAt[tot]) m.bAt[tot] = now;
      for (const ev of evs) {
        if (ev.m !== m || now - ev.at > FOLLOW || ev.cancelled) continue;
        const sec = Math.round((now - ev.at) / 1000);
        if (ev.bSeen == null && tot >= ev.total) ev.bSeen = (now - ev.at) / 1000;
        const open: string[] = [];
        for (const mk of e.markets || []) {
          const name = String(mk.marketType?.name || "");
          for (const r of mk.row || []) {
            const line = Number(r.specifier?.total ?? r.prices?.[0]?.handicap);
            const i = wonIdx(name, line, ev.after);
            if (i == null || wonIdx(name, line, ev.before) === i) continue;
            const pr = r.prices?.[i];
            if (!pr || !(Number(pr.odds) > 1) || mk.suspended || r.suspended || pr.suspended) continue;
            const key = `${mk.marketType?.displayName || name}|${pr.name}${isNaN(line) ? "" : " " + line}`;
            const o = ev.opts.get(key) || { from: sec, last: sec, odd: Number(pr.odds) };
            o.last = sec; ev.opts.set(key, o); open.push(`${pr.name}${isNaN(line) ? "" : " " + line}@${pr.odds}`);
          }
        }
        if (ev.tl.length < 60) ev.tl.push(`${sec}s bP ${label(s)}${open.length ? " ouvert: " + open.slice(0, 4).join(", ") : ""}`);
      }
    }));
    ticks.b++;
    await sleep(Math.max(0, 1000 - (Date.now() - t)));
  } };

  // Chaque jeu est enregistré dès la fin de son suivi de 45 s (pas d'attente de fin de cycle)
  let saved = 0, playable = 0;
  const flush = async (all = false) => {
    const done = evs.filter((e) => !e.saved && (all || Date.now() - e.at > FOLLOW + 1500));
    done.forEach((e) => (e.saved = true));
    const recs = done.filter((e) => e.m.b).map((e) => toRec(e, runId));
    if (recs.length) await db.TennisLagEvent.bulkCreate(recs).catch((e: any) => console.error("écriture", e));
    saved += recs.length; playable += recs.filter((r) => r.playable).length;
  };
  const loopF = async () => { while (Date.now() < endAt) { await sleep(5000); await flush(); } };
  await Promise.all([loopX(), loopB(), loopF()]);
  await flush(true);
  return Response.json({ matches: M.size, linked: [...M.values()].filter((m) => m.b).length, events: saved, playable, ticks });
});

function toRec(e: any, runId: string) {
  {
    const options = [...e.opts.entries()].map(([k, o]: any) => { const [market, outcome] = k.split("|"); return { market, outcome, odd: o.odd, from_s: o.from, open_s: o.last - o.from + 1 }; });
    const best = options.reduce((a, o) => Math.max(a, o.open_s), 0);
    return {
      run_id: runId, match_label: e.m.name, league: e.m.league, kind: e.kind,
      score_before: label(e.before), score_after: label(e.after), detected_at: new Date(e.at).toISOString(),
      first_book: e.bSeen != null && e.bSeen < 0 ? "betPawa" : "1xBet", b_seen_s: e.bSeen == null ? undefined : Math.round(e.bSeen * 10) / 10,
      options, options_count: options.length, best_open_s: best, best_odd: options.reduce((a, o) => Math.max(a, o.odd), 0) || undefined,
      playable: !e.cancelled && best >= 3, cancelled: !!e.cancelled, timeline: e.tl,
    };
  }
}