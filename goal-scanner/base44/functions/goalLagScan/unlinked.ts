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
  // Cas pièges : [nom A, nom B, doit être reconnu identique ?]
  const T: [string, string, boolean][] = [
    ["Tobol Kostanay Reserve YOUTH", "Tobol Kostanay II", true], ["Spartak 2 Moscow", "Spartak Moscow II", true],
    ["Sahdag", "Shahdag Qusar", true], ["FC Yelimay Reserve YOUTH", "Elimai II", true],
    ["Spartak Moscow", "Spartak Moscow II", false], ["Spartak 2 Moscow", "Spartak Moscow", false],
    ["Tobol Kostanay", "Tobol Kostanay II", false], ["Tobol Kostanay Reserve YOUTH", "Tobol Kostanay", false],
    ["Astana Youth", "Astana II", false], ["Astana U19", "Astana II", false], ["Zilina", "Zilina Women", false],
    ["Shakhtar Donetsk", "Shakhtar Donetsk II", false], ["Dinamo Moscow", "Spartak Moscow", false],
    ["Sevilla", "Sevilla Atletico", false], ["Real Madrid", "Real Madrid Castilla", false],
    ["Jong Ajax", "Ajax", false], ["Shabab Al Ahli", "Al Ahli", false], ["Yenisey", "Yeni Malatyaspor", false],
    ["Ararat Yerevan", "Ararat-Armenia", false], ["Lokomotiv 2 Plovdiv", "Lokomotiv Plovdiv", false],
  ];
  const out: any = { xbet: xl.length, tests_rates: T.filter(([a, b, w]) => sameTeam(a, b) !== w).map(([a, b, w]) => `${a} / ${b} attendu ${w}`) };
  out.paires = {};
  for (const [name, list] of Object.entries(books)) {
    const uniq = [...new Map(list.map((e: any) => [String(e.id), e])).values()];
    const miss = uniq.filter((e: any) => !xl.some((g: any) => sameTeam(e.home, g.home) && sameTeam(e.away, g.away)));
    // Chaque appariement : noms des deux côtés, score/minute des deux côtés, et matchs 1xBet multiples (ambigus)
    out.paires[name] = uniq.map((e: any) => {
      const g = xl.filter((x: any) => sameTeam(e.home, x.home) && sameTeam(e.away, x.away));
      if (!g.length) return null;
      return `${e.home} - ${e.away} (${e.score ?? "?"} ${e.minute ?? "?"}')  =  ${g.map((x: any) => `${x.home} - ${x.away} (${x.score ?? "?"} ${x.minute ?? "?"}')`).join(" | ")}${g.length > 1 ? "  ⚠️ AMBIGU" : ""}`;
    }).filter(Boolean);
    out[name] = {
      total: uniq.length, relies: uniq.length - miss.length,
      nonRelies: miss.map((e: any) => {
        const near = xl.find((g: any) => sameTeam(e.home, g.home) || sameTeam(e.away, g.away) || sameTeam(e.home, g.away));
        return `${e.home} - ${e.away}  ⇢  ${near ? `${near.home} - ${near.away} [${normTeam(e.home)}|${normTeam(near.home)}]` : "aucun chez 1xBet"}`;
      }),
    };
  }
  out.ambigus = Object.values(out.paires).flat().filter((p: any) => p.includes("AMBIGU"));
  out.paires_betPawa = out.paires.betPawa; delete out.paires;
  return out;
}