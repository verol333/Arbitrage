import { fetchLiveMatches, fetchOddsAndInfo } from "../../shared/onewinLiveWs.ts";
import { listBetpawaCategories, listBetpawaLive } from "../../shared/betpawaLive.ts";
import { sameTeam } from "../../shared/teamMatch.ts";
import { xbetSnap, bpSnap, cbSnap, wParse } from "../../shared/liveMarkets.ts";

// Audit hockey sans mise : liaison des matchs entre sites + marchés lus chez chacun.
const H = { "user-agent": "Mozilla/5.0 Chrome/124", accept: "application/json" };
const CB = "https://hg-event-api-prod.sporty-tech.net/api/";
const CB_H = { accept: "application/json", "user-agent": "Mozilla/5.0 Chrome/120", origin: "https://www.congobet.net", referer: "https://www.congobet.net/sports" };
const FAKE = { test: (s: string) => /virtu|cyber|esport|e-sport|srl|simulat|subhockey|blast|replays|\+/i.test(s) || /\((?!women|u\d|amateur|res)[^)]*\)/i.test(s) };

export async function audit() {
  const j = await fetch("https://1xbet.cg/service-api/LiveFeed/Get1x2_VZip?sports=2&count=1000&lng=en&mode=4&country=93&partner=159&getEmpty=true", { headers: H }).then((r) => r.json()).catch(() => null);
  const xs = (j?.Value || []).filter((g: any) => !FAKE.test(`${g.L} ${g.O1} ${g.O2}`)).map((g: any) => ({ id: g.I, home: g.O1E || g.O1, away: g.O2E || g.O2, league: g.LE || g.L, sc: `${g.SC?.FS?.S1 || 0}-${g.SC?.FS?.S2 || 0}` }));
  const ws = (await fetchLiveMatches("hockey").catch(() => [])).filter((m: any) => !FAKE.test(`${m.home} ${m.away}`));
  const cats = await listBetpawaCategories().catch(() => []);
  const bCat = cats.find((c: any) => /hockey/i.test(c.name))?.id;
  const bs = bCat ? await listBetpawaLive(bCat).catch(() => []) : [];
  const cs: any[] = [], cbCats: Record<string, string> = {};
  for (let o = 0; o < 500; o += 100) {
    const page = await fetch(`${CB}events/sports/live?offset=${o}&length=100`, { headers: CB_H }).then((r) => r.json()).catch(() => null);
    if (!Array.isArray(page)) break;
    for (const e of page) { const k = String(e.categoryPath).split("/")[1]; cbCats[k] ||= String(e.sportName || e.categoryName || e.tournamentName || ""); cs.push({ id: String(e.id), home: e.homeTeamName, away: e.awayTeamName, cat: k, score: e.score }); }
    if (page.length < 100) break;
  }
  const pick = (l: any[], m: any) => l.filter((x) => sameTeam(x.home, m.home) && sameTeam(x.away, m.away));
  const links = xs.map((m: any) => ({ ...m, w: pick(ws, m), b: pick(bs, m), c: pick(cs, m) }));
  const linked = links.filter((l: any) => l.w.length || l.b.length || l.c.length).slice(0, 6);
  const wf = await fetchOddsAndInfo(linked.flatMap((l: any) => l.w.map((w: any) => w.id)), 3000, 800).catch(() => null);
  const markets = await Promise.all(linked.map(async (l: any) => {
    const [x, b, c] = await Promise.all([xbetSnap(l.id), l.b[0] ? bpSnap(l.b[0].id) : null, l.c[0] ? cbSnap(l.c[0].id) : null]);
    const wg: any = l.w[0] && wf?.odds.get(l.w[0].id);
    const w = wg ? wParse(wg, l.w[0].home) : null;
    return { match: `${l.home} - ${l.away}`, score: l.sc, x: x && Object.keys(x.mk), w: w && Object.keys(w), wGroups: wg && Object.keys(wg).slice(0, 30), b: b && Object.keys(b.mk), c: c && Object.keys(c.mk) };
  }));
  return {
    xbet: xs.length, win: ws.length, betpawa: bs.length, bCat: bCat ?? null, congobetCats: cbCats,
    liens: links.map((l: any) => `${l.home} - ${l.away} [${l.league}] w:${l.w.length} b:${l.b.length} c:${l.c.length}`),
    nonLies1win: ws.filter((w: any) => !xs.some((m: any) => sameTeam(m.home, w.home) && sameTeam(m.away, w.away))).map((w: any) => `${w.home} - ${w.away}`),
    markets,
  };
}