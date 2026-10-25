// Contexte d'un match (FotMob, gratuit), calculé une fois quand le match est suivi :
// classement et enjeu, favori, moyenne de buts du championnat, confrontations directes, forme récente.
const H = { "user-agent": "Mozilla/5.0 Chrome/120", accept: "application/json" };
const tables = new Map<string, any>();
const goals = (s: string) => String(s || "").split("-").map((x) => Number(x.trim()));

async function table(url: string) {
  if (!url) return null;
  if (!tables.has(url) || Date.now() - tables.get(url).at > 6 * 3600e3) {
    const b = new Uint8Array(await (await fetch(url, { headers: H, signal: AbortSignal.timeout(8000) })).arrayBuffer());
    let s: string;
    try { s = await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).text(); } catch { s = new TextDecoder().decode(b); }
    const rows = [...s.matchAll(/<t [^>]*id="(\d+)" p="(\d+)" w="(\d+)" d="(\d+)" l="(\d+)" g="(\d+)" c="(\d+)"/g)]
      .map((m, i) => ({ id: +m[1], pos: i + 1, pts: +m[2], pl: +m[3] + +m[4] + +m[5], gf: +m[6], ga: +m[7] }));
    tables.set(url, { at: Date.now(), rows });
  }
  return tables.get(url).rows as any[];
}

export async function matchContext(fotmobId: number) {
  const j = await fetch(`https://www.fotmob.com/api/data/matchDetails?matchId=${fotmobId}`, { headers: H, signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null);
  if (!j?.content) return null;
  const hid = Number(j.general?.homeTeam?.id), aid = Number(j.general?.awayTeam?.id), c = j.content;
  const out: any = {};
  // Classement, favori, enjeu, moyenne de buts du championnat
  const rows = await table(c.table?.url).catch(() => null);
  if (rows?.length) {
    const n = rows.length, th = rows.find((r) => r.id === hid), ta = rows.find((r) => r.id === aid);
    const played = rows.reduce((s, r) => s + r.pl, 0) / 2;
    out.league_avg_goals = played ? +(rows.reduce((s, r) => s + r.gf, 0) / played).toFixed(2) : null;
    const team = (t: any) => t && t.pl ? {
      pos: t.pos, of: n, ppg: +(t.pts / t.pl).toFixed(2), gpm: +((t.gf + t.ga) / t.pl).toFixed(2),
      gap_top: rows[0].pts - t.pts, gap_drop: t.pts - rows[Math.max(0, n - 4)].pts, played: t.pl,
    } : null;
    out.home = team(th); out.away = team(ta);
    if (out.home && out.away) {
      const d = out.home.ppg - out.away.ppg;
      out.fav = d >= 0.5 ? "domicile" : d <= -0.5 ? "exterieur" : null;
      // Enjeu : en course pour le titre (≤ 6 pts du 1er) ou menacé (≤ 3 pts de la zone rouge)
      for (const t of [out.home, out.away]) t.stake = t.gap_top <= 6 ? "titre" : t.gap_drop <= 3 ? "maintien" : "aucun";
    }
  }
  // Confrontations directes
  const h2h = (c.h2h?.matches || []).filter((m: any) => m.status?.finished).slice(0, 10).map((m: any) => goals(m.status.scoreStr));
  if (h2h.length) out.h2h = { n: h2h.length, avg_goals: +(h2h.reduce((s: number, g: number[]) => s + g[0] + g[1], 0) / h2h.length).toFixed(2), wins: c.h2h.summary };
  // Forme : buts marqués / encaissés sur les 5 derniers matchs
  const form = c.matchFacts?.teamForm || [];
  const f = (k: number, id: number) => {
    const ms = (form[k] || []).slice(0, 5).map((x: any) => x.tooltipText).filter(Boolean);
    if (!ms.length) return null;
    const sc = ms.reduce((s: number, t: any) => s + Number(t.homeTeamId === id ? t.homeScore : t.awayScore), 0);
    const co = ms.reduce((s: number, t: any) => s + Number(t.homeTeamId === id ? t.awayScore : t.homeScore), 0);
    return { n: ms.length, scored: +(sc / ms.length).toFixed(2), conceded: +(co / ms.length).toFixed(2) };
  };
  out.form = { home: f(0, hid), away: f(1, aid) };
  return out;
}

/** Photo à la 85e : situation du favori, qui pousse (momentum 70e–85e), cartons rouges. */
export function snap85(ctx: any, sc: [number, number], fm: any, sample: any) {
  const mo = (fm?.momentum || []).filter((x: any) => x.m >= 70 && x.m < 85).map((x: any) => x.v);
  const mom = mo.length ? +(mo.reduce((s: number, v: number) => s + v, 0) / mo.length).toFixed(1) : null;
  const fav = ctx?.fav;
  let fav_state = null;
  if (fav) { const [fg, og] = fav === "domicile" ? sc : [sc[1], sc[0]]; fav_state = fg < og ? "mene" : fg === og ? "egalite" : "devant"; }
  const fav_push = fav && mom != null ? (fav === "domicile" ? mom : -mom) > 20 : null;
  // Changements offensifs entre la 70e et la 85e (entrée d'un joueur plus offensif que celui qui sort)
  const late = (fm?.subs || []).filter((x: any) => x.m >= 70 && x.m < 85 && x.delta > 0);
  const off_subs = { domicile: late.filter((x: any) => x.home).length, exterieur: late.filter((x: any) => !x.home).length };
  return { score: sc.join("-"), goals: sc[0] + sc[1], mom_70_85: mom, fav_state, fav_push, red: sample?.rc ?? null, off_subs, added_time: fm?.added90 ?? null };
}