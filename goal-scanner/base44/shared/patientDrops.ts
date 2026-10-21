import { sameMatch } from "./soloDrops.ts";

// Chutes « patientes » (observation, administrateur) : chute de cote détectée à partir de la 50e minute,
// puis on attend que « match plus de X,5 » (X = buts actuels) atteigne 1.40 chez le même site.
// Chute normale (1 but annoncé) : 5 min de patience, un but pendant l'attente = manqué.
// Chute forte (2 buts ou plus annoncés) : 10 min, un but pendant l'attente = on passe à la ligne suivante.
const KEY = /^TOT_\d+\.5$/;
const NAME: Record<string, string> = { x: "1xBet", w: "1win", b: "betPawa", c: "Congobet", y: "Yellowbet", p: "Pinnacle", s: "SBOBET", u: "Unibet", o: "SportyBet", t: "22Bet" };
const TARGET = 1.4, MIN_START = 50, STOP_MIN = 88;
type Snap = { at: number; min?: number | null; sc: [number, number]; mk: Record<string, number[]>; lk?: Set<string> };

export async function createPatient(db: any) {
  const recs: any[] = (await db.PatientDrop.filter({ status: { $in: ["watching", "signal"] } }, { limit: 300 }).catch(() => ({ items: [] }))).items || [];
  // Matchs déjà joués ces 4 dernières heures : servent seulement à éviter un 2e signal sur le même match
  const done: any[] = (await db.PatientDrop.filter({ status: { $in: ["won", "lost"] }, created_date: { $gte: new Date(Date.now() - 4 * 3600e3).toISOString() } }, { limit: 300 }).catch(() => ({ items: [] }))).items || [];
  recs.push(...done);
  const dirty = new Set<string>(), seen = new Set<string>();
  const odd = (s: Snap, k: string) => (s.mk[k] && !s.lk?.has(k) ? s.mk[k][0] : null);
  const iso = (t: number) => new Date(t).toISOString();
  const clean = ({ _tmp, id, created_date, updated_date, created_by_id, created_by, is_sample, ...d }: any) => d;

  function track(r: any, s: Snap) {
    const g = s.sc[0] + s.sc[1];
    r.last_score = s.sc.join("-"); r.last_seen_at = iso(s.at); if (s.min != null) r.last_minute = s.min;
    seen.add(r.id || r._tmp); if (r.id) dirty.add(r.id);
    if (r.status === "signal") {
      if (g > r.line) { r.status = "won"; r.settled_at = iso(s.at); return r; }
      return null;
    }
    if (r.status !== "watching") return null;
    // Un but avant la prise de cote = la chute annonçait ce but : ce n'est plus une opportunité
    if (g !== r.goals) { r.status = "missed"; r.settled_at = iso(s.at); return null; }
    if ((s.min ?? 0) >= STOP_MIN || s.at > Date.parse(r.deadline_at)) { r.status = "expired"; r.settled_at = iso(s.at); return null; }
    const o = odd(s, `TOT_${r.line}`);
    if (!o) return null;
    r.last_odd = o; r.best_odd = Math.max(r.best_odd || 0, o);
    if (o < TARGET) return null;
    if (recs.some((x) => x !== r && x.status === "signal" && sameMatch(x.match_label, r.match_label))) { r.status = "void"; r.settled_at = iso(s.at); return null; }
    Object.assign(r, { status: "signal", signal_odd: o, signal_minute: s.min ?? null, signal_score: s.sc.join("-"), signal_at: iso(s.at), wait_s: Math.round((s.at - Date.parse(r.start_at)) / 1000) });
    return r;
  }

  async function save(r: any) {
    const id = r.id, data = clean(r);
    if (id) { dirty.delete(id); return db.PatientDrop.update(id, data).catch(() => null); }
    // Deux machines du scanner se chevauchent quelques minutes : on revérifie en base juste avant de créer
    const since = new Date(Date.now() - 4 * 3600e3).toISOString();
    const live: any[] = (await db.PatientDrop.filter({ status: { $in: ["watching", "signal", "won", "lost"] }, created_date: { $gte: since } }, { limit: 300 }).catch(() => ({ items: [] }))).items || [];
    if (live.some((x) => sameMatch(x.match_label, r.match_label))) { r.status = "void"; return; }
    const c = await db.PatientDrop.create(data).catch(() => null);
    if (c?.id) { r.id = c.id; seen.add(c.id); }
  }

  /** À chaque relevé d'un site. `hist` = relevés des 3 dernières minutes de ce match. */
  function feed(bk: string, e: any, s: Snap, hist: Snap[]) {
    const ev = String(e.id);
    const mine = recs.filter((r) => r.book === bk && r.event_id === ev && (r.status === "watching" || r.status === "signal"));
    for (const r of mine) { const hit = track(r, s); if (hit) save(hit); }
    if (mine.length || s.min == null || s.min < MIN_START || s.min >= STOP_MIN - 5) return;
    const g = s.sc[0] + s.sc[1];
    const base = hist.find((o) => s.at - o.at >= 50000 && s.at - o.at <= 120000);
    if (!base || hist.some((o) => o.sc[0] + o.sc[1] !== g)) return;
    const tk = Object.keys(s.mk).filter((k) => KEY.test(k));
    if (tk.length && tk.filter((k) => s.lk?.has(k)).length * 2 >= tk.length) return;
    const label = `${e.home} - ${e.away}`;
    // Un seul signal par match, même si plusieurs sites montrent la chute
    if (recs.some((r) => ["watching", "signal", "won", "lost"].includes(r.status) && sameMatch(r.match_label, label))) return;
    for (const k of tk.sort((a, b) => parseFloat(a.slice(4)) - parseFloat(b.slice(4)))) {
      const ln = parseFloat(k.slice(4));
      // Pari = toujours « plus de X,5 » basé sur le score en cours (X = buts actuels), jamais la ligne de la chute
      const bet = g + 0.5;
      if (ln < bet) continue;
      const o0 = odd(base, k), o1 = odd(s, k);
      if (!o0 || !o1 || o0 > 4.5 || 1 - o1 / o0 < 0.15) continue;
      const need = Math.round(ln - g + 0.5), kind = need >= 2 ? "forte" : "normale";
      const r: any = {
        _tmp: `${bk}|${ev}|${s.at}`, book: bk, book_name: NAME[bk] || bk, event_id: ev, match_label: label, league: e.league || "",
        kind, drop_text: `Plus de ${ln} : ${o0} → ${o1}`, start_minute: s.min, start_score: s.sc.join("-"), start_at: iso(s.at),
        deadline_at: iso(s.at + (kind === "forte" ? 10 : 5) * 60e3), goals: g, line: bet, status: "watching",
      };
      recs.push(r);
      track(r, s);
      save(r);
      return;
    }
  }

  /** Fin de cycle : règlement des matchs disparus du direct + enregistrement des suivis. */
  async function finish() {
    const now = Date.now();
    for (const r of recs) {
      if (!r.id || seen.has(r.id)) continue;
      const age = now - Date.parse(r.last_seen_at || r.start_at);
      if (r.status === "watching" && now > Date.parse(r.deadline_at)) { r.status = "expired"; r.settled_at = iso(now); dirty.add(r.id); }
      else if (r.status === "signal" && (((r.last_minute ?? 0) >= 85 && age > 10 * 60e3) || ((r.last_minute ?? 0) >= 70 && age > 25 * 60e3))) { r.status = "lost"; r.settled_at = iso(now); dirty.add(r.id); }
      else if (r.status === "signal" && age > 3 * 3600e3) { r.status = "void"; r.settled_at = iso(now); dirty.add(r.id); }
    }
    const upd = recs.filter((r) => r.id && dirty.has(r.id)).map((r) => ({ id: r.id, ...clean(r) }));
    if (upd.length) await db.PatientDrop.bulkUpdate(upd).catch(() => null);
  }
  return { feed, finish };
}