import { sameTeam } from "../../shared/teamMatch.ts";

// Options 1win rendues gagnantes par la statistique qui vient de bouger chez 1xBet
// (corner ou carton jaune n° `after` obtenu par `side`). Mi-temps ignorées.
export type Kind = "corner" | "carton_jaune";
export const PREFIX: Record<Kind, RegExp> = { corner: /^corners\./i, carton_jaune: /^yellow cards?\./i };

export function hasMarket(groups: Record<string, any[]> | undefined, kind: Kind) {
  return !!groups && Object.keys(groups).some((g) => PREFIX[kind].test(g.trim()));
}

/** before/after : [domicile, extérieur] chez 1xBet ; home/away : noms 1win. */
export function wonOptions(groups: Record<string, any[]> | undefined, kind: Kind, before: number[], after: number[], side: 0 | 1, home: string, away: string) {
  const out: { market: string; outcome: string; odd: number }[] = [];
  if (!groups) return out;
  const tot = after[0] + after[1], totB = before[0] + before[1];
  const team = side ? away : home;
  for (const [gn, list] of Object.entries(groups)) {
    const g = gn.trim();
    if (!PREFIX[kind].test(g) || /half|2nd|1st/i.test(g)) continue;
    const rest = g.replace(PREFIX[kind], "").trim();
    const open = list.filter((o) => o.status === 1 && o.cf >= 1.05);
    const over = (count: number, cBefore: number) => open.filter((o) => {
      if (!/^over/i.test(o.name)) return false;
      const l = parseFloat(o.name.replace(/[^\d.]/g, ""));
      return l >= cBefore && l < count; // gagnée par CE nouvel évènement
    });
    let hits: any[] = [];
    if (/^total$/i.test(rest)) hits = over(tot, totB);
    else if (/ total$/i.test(rest)) {
      const t = rest.replace(/ total$/i, "");
      const s = sameTeam(t, home) ? 0 : sameTeam(t, away) ? 1 : -1;
      if (s === side) hits = over(after[s], before[s]);
    } else if (/№|number|no\.?$/i.test(rest)) {
      hits = open.filter((o) => { const m = o.name.match(/^(\d+)\s+(.+)$/); return m && Number(m[1]) === tot && sameTeam(m[2], team); });
    } else if (/race to/i.test(rest)) {
      hits = open.filter((o) => { const m = o.name.match(/^(\d+)\s*-\s*(.+)$/); return m && Number(m[1]) === after[side] && sameTeam(m[2], team); });
    }
    for (const o of hits) out.push({ market: g, outcome: o.name, odd: o.cf });
  }
  return out;
}