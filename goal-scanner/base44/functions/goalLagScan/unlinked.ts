import { fetchLiveMatches } from "../../shared/onewinLiveWs.ts";
import { listBetpawaLive, listBetpawaCategories } from "../../shared/betpawaLive.ts";
import { sameTeam, normTeam } from "../../shared/teamMatch.ts";
import { xbetList, cbList } from "../../shared/liveMarkets.ts";

// Diagnostic : matchs des petits sites qu'aucun match 1xBet ne relie, avec le candidat 1xBet le plus proche
export async function unlinked() {
  const cats = await listBetpawaCategories().catch(() => []);
  const foot = cats.find((c: any) => /^(football|soccer)$/i.test(c.name.trim()));
  const [xl, wp, bl, cl] = await Promise.all([
    xbetList(),
    Promise.all([0, 100, 200, 300].map((o) => fetchLiveMatches("football", o))).then((p) => p.flat().filter((m: any) => !m.virtual)),
    foot ? listBetpawaLive(foot.id).catch(() => []) : [],
    cbList().catch(() => []),
  ]);
  const books: Record<string, any[]> = { "1win": wp, betPawa: bl, Congobet: cl };
  const out: any = { xbet: xl.length };
  for (const [name, list] of Object.entries(books)) {
    const uniq = [...new Map(list.map((e: any) => [String(e.id), e])).values()];
    const miss = uniq.filter((e: any) => !xl.some((g: any) => sameTeam(e.home, g.home) && sameTeam(e.away, g.away)));
    out[name] = {
      total: uniq.length, relies: uniq.length - miss.length,
      nonRelies: miss.map((e: any) => {
        const near = xl.find((g: any) => sameTeam(e.home, g.home) || sameTeam(e.away, g.away) || sameTeam(e.home, g.away));
        return `${e.home} - ${e.away}  ⇢  ${near ? `${near.home} - ${near.away} [${normTeam(e.home)}|${normTeam(near.home)}]` : "aucun chez 1xBet"}`;
      }),
    };
  }
  return out;
}