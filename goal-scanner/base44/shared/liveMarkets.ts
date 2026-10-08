import { sameTeam } from "./teamMatch.ts";

// Lecture des marchés live (temps réglementaire uniquement) chez 1xBet, betPawa et 1win.
// Clés : 1X2, BTTS, TOT_<ligne> (match), ITH_<ligne> / ITA_<ligne> (total individuel).
export type Mk = Record<string, number[]>;
export const H = { Accept: "application/json", "User-Agent": "Mozilla/5.0 Chrome/120" };
const BP_H: Record<string, string> = {
  accept: "application/json", devicetype: "web", origin: "https://cg.betpawa.com",
  "x-pawa-brand": "betpawa-congobrazzaville", "x-pawa-language": "fr", cookie: "bp_country=CG",
  "user-agent": "Mozilla/5.0 Chrome/151",
};
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Football réel uniquement : ni virtuel, ni e-sport, ni formats spéciaux, ni « équipe vs joueur ».
const FAKE = /alternat|virtu|cyber|fifa|esport|e-sport|penalt|short|2x2|3x3|4x4|5x5|rush|student|\blfl\b|special|statist|player|joueur/i;

/** Tous les matchs de foot en direct chez 1xBet, avec score et minute (un seul appel). */
export async function xbetList() {
  const j = await fetch("https://1xbet.cg/service-api/LiveFeed/Get1x2_VZip?sports=1&count=1000&lng=en&mode=4&country=93&partner=159&getEmpty=true", { headers: H, signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => null);
  return (j?.Value || [])
    .filter((g: any) => !FAKE.test(g.L || "") && !FAKE.test(`${g.O1E || g.O1} ${g.O2E || g.O2}`))
    .map((g: any) => ({
      id: g.I as number, home: g.O1E || g.O1, away: g.O2E || g.O2, league: g.LE || g.L || "",
      sh: Number(g.SC?.FS?.S1 || 0), sa: Number(g.SC?.FS?.S2 || 0), min: Math.floor((g.SC?.TS || 0) / 60),
    }));
}

export async function xbetSnap(id: number) {
  const j = await fetch(`https://1xbet.cg/service-api/LiveFeed/GetGameZip?id=${id}&lng=en&country=93&partner=159&GroupEvents=true&grMode=4&marketType=1&countevents=250`, { headers: H, signal: AbortSignal.timeout(4000) }).then((r) => r.json()).catch(() => null);
  const v = j?.Value;
  if (!v) return null;
  const mk: Mk = {};
  const locked = new Set<string>();
  for (const g of v.GE || []) {
    const flat = (g.E || []).flat();
    if (g.G === 1) { const o = [1, 2, 3].map((t) => flat.find((e: any) => e.T === t)?.C); if (o.every(Boolean)) mk["1X2"] = o; }
    if (g.G === 17) for (const ov of flat.filter((e: any) => e.T === 9)) {
      const un = flat.find((e: any) => e.T === 10 && e.P === ov.P);
      if (un) { mk[`TOT_${ov.P}`] = [ov.C, un.C]; if (ov.B) locked.add(`TOT_${ov.P}`); }
    }
    if (g.G === 15 || g.G === 62) {
      const [to, tu, side] = g.G === 15 ? [11, 12, "H"] : [13, 14, "A"];
      for (const ov of flat.filter((e: any) => e.T === to)) {
        const un = flat.find((e: any) => e.T === tu && e.P === ov.P);
        if (un) { mk[`IT${side}_${ov.P}`] = [ov.C, un.C]; if (ov.B) locked.add(`IT${side}_${ov.P}`); }
      }
    }
    if (g.G === 19) { const y = flat.find((e: any) => e.T === 180)?.C, n = flat.find((e: any) => e.T === 181)?.C; if (y && n) mk.BTTS = [y, n]; }
  }
  const fs = v.SC?.FS || {};
  return { mk, locked, sh: fs.S1 || 0, sa: fs.S2 || 0, min: Math.floor((v.SC?.TS || 0) / 60) };
}

function bpScore(j: any): [number, number] | null {
  const rows = j?.results?.participantPeriodResults;
  if (!Array.isArray(rows)) return null;
  const v = ["HOME", "AWAY"].map((s) => {
    const r = rows.find((x: any) => String(x?.participant?.type || "").toUpperCase() === s);
    const p = (r?.periodResults || []).find((p: any) => /FULL_TIME/i.test(p?.period?.slug || "") && /SCO/i.test(p?.type || "SCORE"));
    return p ? Number(p.result) : NaN;
  });
  return v.every((n) => !isNaN(n)) ? [v[0], v[1]] : null;
}

export async function bpSnap(id: string, dbg: any[] = []) {
  const j = await fetch(`https://cg.betpawa.com/api/sportsbook/v4/events/${id}`, { headers: BP_H, signal: AbortSignal.timeout(4000) }).then((r) => r.json()).catch(() => null);
  const mk: Mk = {};
  const locked = new Set<string>();
  for (const m of j?.markets || []) {
    const name = String(m?.marketType?.name || "").trim();
    if (/half|mi-temps|corner|card|carton/i.test(name)) continue;
    for (const row of m.row || []) {
      const p = (row.prices || []).map((x: any) => Number(x.odds));
      const susp = !!(m.suspended || row.suspended || (row.prices || []).some((x: any) => x.suspended));
      let key = "";
      if (/^1x2 - ft$/i.test(name) && p.length === 3) key = "1X2";
      // betPawa code la ligne ×4 : handicap 6 = 1.5 buts
      else if (/^total score over\/under - ft$/i.test(name) && p.length === 2 && row.handicap != null) key = `TOT_${Number(row.handicap) / 4}`;
      else if (/^total score over\/under - ft - (home|away) team$/i.test(name) && p.length === 2 && row.handicap != null) key = `IT${/home/i.test(name) ? "H" : "A"}_${Number(row.handicap) / 4}`;
      else if (/^both teams to score - ft$/i.test(name) && p.length === 2) key = "BTTS";
      if (key) { mk[key] = p; if (susp) locked.add(key); }
    }
    if (dbg.length < 60) dbg.push({ name, row: (m.row || []).slice(0, 2).map((r: any) => ({ h: r.handicap, p: (r.prices || []).map((x: any) => `${x.name}:${x.odds}`) })) });
  }
  return { mk, locked, score: bpScore(j) };
}

/** 1win : `locked` reçoit les marchés dont l'issue « Plus » n'est pas au statut ouvert (1). */
export function wParse(groups: Record<string, any[]> | undefined, home: string, locked?: Set<string>): Mk {
  const mk: Mk = {};
  if (!groups) return mk;
  for (const [gn, list] of Object.entries(groups)) {
    const n = gn.trim().toLowerCase();
    const ok = list.filter((o) => o.status === 1 || o.status === 0 || !o.status);
    const lines = (prefix: string, all: any[]) => {
      for (const ov of all.filter((o) => /^over/i.test(o.name))) {
        const line = parseFloat(ov.name.replace(/[^\d.]/g, ""));
        const un = all.find((o) => /^under/i.test(o.name) && parseFloat(o.name.replace(/[^\d.]/g, "")) === line);
        if (un && !isNaN(line)) { mk[`${prefix}_${line}`] = [ov.cf, un.cf]; if (locked && ov.status !== 1) locked.add(`${prefix}_${line}`); }
      }
    };
    if (/^(full time result|1x2|match result)$/.test(n) && ok.length === 3) {
      const d = ok.find((o) => /^draw$/i.test(o.name.trim()));
      const h = ok.find((o) => o !== d && sameTeam(o.name, home));
      const a = ok.find((o) => o !== d && o !== h);
      if (d && h && a) mk["1X2"] = [h.cf, d.cf, a.cf];
    } else if (n === "total") lines("TOT", locked ? list : ok);
    else if (/ total$/.test(n) && !/corner|card|half|yellow|foul|shot|offside/.test(n)) {
      lines(sameTeam(gn.trim().replace(/ total$/i, ""), home) ? "ITH" : "ITA", locked ? list : ok);
    } else if (/both teams to score/.test(n) && !/half/.test(n)) {
      const y = ok.find((o) => /^yes$/i.test(o.name.trim())), no = ok.find((o) => /^no$/i.test(o.name.trim()));
      if (y && no) mk.BTTS = [y.cf, no.cf];
    }
  }
  return mk;
}

// ── Congobet (Sporty-Tech) ──
const CB = "https://hg-event-api-prod.sporty-tech.net/api/";
const CB_H = { accept: "application/json", "user-agent": "Mozilla/5.0 Chrome/120", origin: "https://www.congobet.net", referer: "https://www.congobet.net/sports" };
const cbScore = (s: unknown): [number, number] | null => { const p = String(s || "").split(":").map(Number); return p.length === 2 && p.every(Number.isFinite) ? [p[0], p[1]] : null; };

/** Matchs de foot (catégorie 101) en direct chez Congobet, avec score. */
export async function cbList() {
  const out: any[] = [];
  for (let o = 0; o < 500; o += 100) {
    const page = await fetch(`${CB}events/sports/live?offset=${o}&length=100`, { headers: CB_H, signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => null);
    if (!Array.isArray(page)) break;
    for (const e of page) if (String(e.categoryPath || "").split("/").filter(Boolean)[0] === "101" && !e.isVirtual && !FAKE.test(`${e.homeTeamName} ${e.awayTeamName}`))
      out.push({ id: String(e.id), home: e.homeTeamName, away: e.awayTeamName, score: cbScore(e.score) });
    if (page.length < 100) break;
  }
  return out;
}

/** Un match Congobet : score + 1X2, BTTS, totaux match et par équipe (bloqué = marché ou sélection fermé). */
export async function cbSnap(id: string) {
  const j = await fetch(`${CB}events/${id}`, { headers: CB_H, signal: AbortSignal.timeout(4000) }).then((r) => r.json()).catch(() => null);
  if (!j) return null;
  const mk: Mk = {}, locked = new Set<string>();
  for (const bt of j.eventBetTypes || []) {
    const name = String(bt.name || "").trim(), its = bt.eventBetTypeItems || [];
    const shut = !bt.bettingAllowed || its.some((i: any) => !i.bettingAllowed || !(Number(i.odds) > 1));
    const put = (k: string, o: number[]) => { mk[k] = o; if (shut) locked.add(k); };
    const ou = () => { const ov = its.find((i: any) => /^>/.test(i.shortName || i.name)), un = its.find((i: any) => /^</.test(i.shortName || i.name)); return ov && un ? { line: parseFloat(String(ov.shortName || ov.name).replace(/[^\d.]/g, "")), o: [Number(ov.odds), Number(un.odds)] } : null; };
    if (name === "Résultat du match" && its.length === 3) put("1X2", its.map((i: any) => Number(i.odds)));
    else if (name === "Les deux équipes marquent" && its.length === 2) put("BTTS", its.map((i: any) => Number(i.odds)));
    else if (name === "Nombre de buts") { const r = ou(); if (r && Number.isFinite(r.line)) put(`TOT_${r.line}`, r.o); }
    else if (/^Total de /.test(name)) { const r = ou(); if (r && Number.isFinite(r.line)) put(`IT${sameTeam(name.slice(9), j.homeTeamName) ? "H" : "A"}_${r.line}`, r.o); }
  }
  return { mk, locked, score: cbScore(j.score) };
}

export const fair = (o: number[]) => { const s = o.reduce((a, c) => a + 1 / c, 0); return o.map((c) => 1 / c / s); };
export const label = (k: string, i: number) => k === "1X2" ? ["1", "X", "2"][i] : k === "BTTS" ? ["BTTS oui", "BTTS non"][i] : `${k.startsWith("ITH") ? "Dom. " : k.startsWith("ITA") ? "Ext. " : "Match "}${i ? "moins" : "plus"} de ${k.split("_")[1]}`;