// Suivi d'un but : qui l'affiche en premier, puis seconde par seconde, chez chaque site,
// l'état des deux options déjà gagnées (total de l'équipe qui a marqué, total du match).
export const BOOKS = ["x", "w", "b", "c"] as const;
export type Book = typeof BOOKS[number];
export const NAMES: Record<Book, string> = { x: "1xBet", w: "1win", b: "betPawa", c: "Congobet" };
export const WINDOW_MS = 75000;
// Temps réel mesuré de notre mise auto en direct (médiane des paris placés sur 1win et betPawa) :
// une fenêtre plus courte ne laisse pas le temps au robot de poser le pari.
export const PLACE_S = 18;

export type Line = { odd: number; locked: boolean } | null;
export type GoalEv = {
  key: string; sc: [number, number]; before: string; side: "H" | "A"; t0: number; first: Book; minute: number;
  seen: Partial<Record<Book, number>>; teamKey: string; matchKey: string;
  open: Record<string, { s: number; odd: number }>; timeline: string[]; cancelled: boolean; done: boolean;
};

export function newGoal(prev: [number, number], sc: [number, number], book: Book, at: number, minute: number): GoalEv {
  const side = sc[0] > prev[0] ? "H" : "A";
  const n = side === "H" ? sc[0] : sc[1], g = sc[0] + sc[1];
  return {
    key: sc.join("-"), sc, before: prev.join("-"), side, t0: at, first: book, minute, seen: { [book]: 0 },
    teamKey: `IT${side}_${n - 0.5}`, matchKey: `TOT_${g - 0.5}`, open: {}, timeline: [], cancelled: false, done: false,
  };
}

const fmt = (l: Line) => !l ? "fermé (retiré)" : l.locked ? "fermé (suspendu)" : `OUVERT @${l.odd}`;

/** Un relevé : pour chaque site, score affiché + état des deux options gagnées. */
export function sample(ev: GoalEv, at: number, st: Record<Book, { sc: [number, number] | null; team: Line; match: Line } | null>) {
  const t = Math.round((at - ev.t0) / 100) / 10;
  const parts: string[] = [];
  for (const b of BOOKS) {
    const s = st[b];
    if (!s) continue;
    for (const [k, l] of [["team", s.team], ["match", s.match]] as const) {
      // Jouable = le site n'a PAS encore affiché le but, et l'option déjà gagnée est
      // affichée, non bloquée, à une cote ≥ 1,05. Dès qu'elle se ferme une fois, la fenêtre est finie.
      const id = `${b}_${k}`;
      // L'option reste gagnée même après que le site affiche le but : on compte tant qu'elle est ouverte.
      // Seul un site qui affichait DÉJÀ le score au moment du but (vu à 0 s, hors premier site) est exclu.
      const isOpen = !(ev.seen[b] === 0 && b !== ev.first) && b !== ev.first && !!l && !l.locked && l.odd >= 1.05;
      const o = ev.open[id];
      // from = 1re seconde vue jouable, s = dernière seconde vue jouable (fenêtre = s − from)
      if (isOpen && !o) ev.open[id] = { from: t, s: t, odd: l!.odd, closed: false } as any;
      else if (isOpen && o && !(o as any).closed) o.s = t;
      else if (!isOpen && o) (o as any).closed = true;
    }
    parts.push(`${NAMES[b]} ${s.sc ? s.sc.join("-") : "?"} équipe ${fmt(s.team)} match ${fmt(s.match)}`);
  }
  if (ev.timeline.length < 90) ev.timeline.push(`+${t}s | ${parts.join(" | ")}`);
}

export function toRecord(ev: GoalEv, m: any, runId: string, truncated: boolean) {
  const r: any = {
    run_id: runId, match_label: m.name, league: m.league, minute: ev.minute, score_before: ev.before, score_after: ev.key,
    scoring_side: ev.side === "H" ? "domicile" : "exterieur", detected_at: new Date(ev.t0).toISOString(),
    first_book: NAMES[ev.first], books: BOOKS.filter((b) => b === "x" || m[b]).map((b) => NAMES[b]),
    team_line: `Plus de ${ev.teamKey.split("_")[1]}`, match_line: `Plus de ${ev.matchKey.split("_")[1]}`,
    cancelled: ev.cancelled, truncated, timeline: ev.timeline, playable: false,
  };
  // But confirmé = au moins deux sites l'ont affiché ; sinon c'est une erreur de score d'un site
  const confirmed = BOOKS.filter((b) => ev.seen[b] != null).length >= 2;
  for (const b of BOOKS) {
    if (ev.seen[b] != null) r[`${b}_seen_s`] = Math.round(ev.seen[b]! / 100) / 10;
    for (const k of ["team", "match"]) {
      const o = ev.open[`${b}_${k}`];
      if (o) { const f = (o as any).from; r[`${b}_${k}_from_s`] = f; const dur = Math.round((o.s - f) * 10) / 10; r[`${b}_${k}_open_s`] = dur; r[`${b}_${k}_odd`] = o.odd; if (!ev.cancelled && confirmed && dur >= PLACE_S) r.playable = true; }
    }
  }
  return r;
}