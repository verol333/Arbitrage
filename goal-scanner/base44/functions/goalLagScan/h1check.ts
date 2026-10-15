import { xbetList, bpSnap, cbList, cbSnap, wParse } from "../../shared/liveMarkets.ts";
import { listBetpawaLive, listBetpawaCategories } from "../../shared/betpawaLive.ts";
import { fetchLiveMatches, fetchOddsAndInfo } from "../../shared/onewinLiveWs.ts";
import { ybList, ybSnap } from "../../shared/yellowbetLive.ts";
import { sameTeam } from "../../shared/teamMatch.ts";

// Contrôle sans écriture : matchs en 1re MT, marchés « 1re mi-temps » lus chez chaque site (clés reconnues + noms bruts)
export async function h1check(limit = 4) {
  const x = (await xbetList()).filter((g: any) => g.cp === 1).slice(0, 40);
  const cats = await listBetpawaCategories().catch(() => []);
  const foot = cats.find((c: any) => /^(football|soccer)$/i.test(c.name.trim()));
  const [w, b, c, y] = await Promise.all([
    Promise.all([0, 100, 200].map((o) => fetchLiveMatches("football", o))).then((p) => p.flat()).catch(() => []),
    foot ? listBetpawaLive(foot.id).catch(() => []) : [], cbList().catch(() => []), ybList().catch(() => []),
  ]);
  const find = (l: any[], g: any) => l.find((e) => sameTeam(e.home, g.home) && sameTeam(e.away, g.away));
  const h1 = (mk: any) => Object.keys(mk || {}).filter((k) => k.startsWith("H1"));
  const out: any[] = [];
  for (const g of x) {
    const mw = find(w, g), mb = find(b, g), mc = find(c, g), my = find(y, g);
    if (!mw && !mb && !mc && !my) continue;
    const r: any = { match: `${g.home} - ${g.away}`, minute: g.min, score: `${g.sh}-${g.sa}` };
    if (mw) { const f = await fetchOddsAndInfo([mw.id], 2500, 600).catch(() => null); const gr = f?.odds.get(mw.id) as any;
      r.w = { cles: h1(wParse(gr, mw.home)), noms: Object.keys(gr || {}).filter((n) => /half/i.test(n)).slice(0, 15) }; }
    if (mb) { const dbg: any[] = []; const s = await bpSnap(mb.id, dbg); r.b = { cles: h1(s.mk), noms: dbg.map((d) => d.name).filter((n) => /half|1st|mi-temps/i.test(n)).slice(0, 15), exemple: dbg.filter((d) => /total/i.test(d.name) && /half|1st/i.test(d.name)).slice(0, 2) }; }
    if (mc) { const s = await cbSnap(mc.id); r.c = { cles: h1(s?.mk) }; }
    if (my) { const s = await ybSnap(my.id).catch(() => null); r.y = { cles: h1(s?.mk) }; }
    out.push(r);
    if (out.length >= limit) break;
  }
  return { matchs1reMT: x.length, controle: out };
}