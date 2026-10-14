import { sameTeam } from "../../shared/teamMatch.ts";
import { label } from "../../shared/liveMarkets.ts";
import { verdict } from "./probLag.ts";
import { bpSnap, cbSnap } from "../../shared/liveMarkets.ts";

// Mise automatique 1win des signaux « probabilités en avance » et « retard de but ».
// Filtre validé : avantage 15–45 %, cote < 2,5, avant la 60e minute. 100 F par pari.
// Capital, connexion et placement : base44/shared/probAutoExec.ts.
export const STAKE = 100;
const PAUSE = 25000, TRIES = 8; // 1 essai + 7 relances = 3 min
export const eligible = (p: any) => (p.bk === "w" || p.bk === "b") && p.edge >= 0.15 && p.edge <= 0.45 && p.odd >= 1.2 && p.odd < 2.5 && p.min < 60; // sous 1,20 : on passe

/** Identifiant 1win de la cote visée (mêmes règles de lecture que wParse). */
export function findOdd(groups: Record<string, any[]> | undefined, home: string, key: string, side: number) {
  if (!groups) return null;
  // Derbys au nom proche (« CSKA Sofia 1948 » / « CSKA Sofia ») : les deux noms ressemblent à l'équipe à domicile.
  // On retient comme domicile le nom identique, sinon le premier qui ressemble.
  const teams = Object.keys(groups).map((g) => g.trim()).filter((g) => / total$/i.test(g) && !/corner|card|half|yellow|foul|shot|offside/i.test(g)).map((g) => g.replace(/ total$/i, ""));
  const homeName = teams.find((t) => t.toLowerCase() === home.trim().toLowerCase()) || teams.find((t) => sameTeam(t, home));
  for (const [gn, list] of Object.entries(groups)) {
    const n = gn.trim().toLowerCase();
    if (key === "1X2" && /^(full time result|1x2|match result)$/.test(n) && list.length === 3) {
      const d = list.find((o) => /^draw$/i.test(o.name.trim()));
      const h = list.find((o) => o !== d && sameTeam(o.name, home));
      const a = list.find((o) => o !== d && o !== h);
      return [h, d, a][side] || null;
    }
    if (key === "BTTS" && /both teams to score/.test(n) && !/half/.test(n)) return list.find((o) => (side ? /^no$/i : /^yes$/i).test(o.name.trim())) || null;
    const [pre, ln] = key.split("_");
    if (!ln) continue;
    const isTot = n === "total", isTeam = / total$/.test(n) && !/corner|card|half|yellow|foul|shot|offside/.test(n);
    if (pre === "TOT" ? !isTot : !isTeam) continue;
    if (pre !== "TOT" && (gn.trim().replace(/ total$/i, "") === homeName) !== (pre === "ITH")) continue;
    const hit = list.find((o) => (side ? /^under/i : /^over/i).test(o.name) && parseFloat(o.name.replace(/[^\d.]/g, "")) === Number(ln));
    if (hit) return hit;
  }
  return null;
}

// Scanner GitHub (INGEST_URL défini) : l'exécution passe par goalLagIngest ; sur nos serveurs : directe.
const REMOTE = !!Deno.env.get("INGEST_URL");
const exec = () => import("../../shared/probAutoExec.ts");
const run = async (db: any, x: any) => REMOTE ? db.ProbAutoBet.autoPlace(x) : (await exec()).execBet(db, x);
const trace = (db: any, action: string, message: string, ok = true) =>
  db.AppLog.create({ area: "mise_auto_proba", action, level: ok ? "info" : "error", ok, message: message.slice(0, 2000), book: "1win" }).catch(() => null);

const seenKeys = new Set<string>();
// Sens d'un pari : +1 = parie sur des buts, −1 = parie contre, 0 = neutre (1X2)
const dir = (key: string, side: string) => {
  if (/^(TOT|ITH|ITA)_/.test(key)) return side === "plus" ? 1 : -1;
  if (key === "BTTS") return side === "oui" ? 1 : -1;
  if (key === "CSH" || key === "CSA") return side === "non" ? 1 : -1;
  return 0;
};
export function createAutoBet(db: any, stream: any, opts: { dry?: boolean } = {}) {
  const tasks: Promise<any>[] = [];
  const results: any[] = [];
  const place = async (p: any) => {
    const m = p.m, source = p.source || "prob";
    const bp = p.bk === "b", cb = p.bk === "c", book = bp ? "betpawa" : cb ? "congobet" : "1win";
    const signal_key = (source === "goal" ? `goal|${m.x}|${p.sc}${p.extra || cb ? `|${p.key}` : ""}` : `${m.x}|${p.key}|${p.side}|${p.min}`) + (bp ? "|bp" : cb ? "|cb" : "");
    const base = { signal_key, book, xbet_id: m.x, onewin_match_id: m.w, match_label: m.name, minute: p.min, score: p.sc, market_key: p.key,
      market_label: label(p.key, p.side), line: p.line, side: p.key === "1X2" || /^GOAL/.test(p.key) ? ["1", "X", "2"][p.side] : ["BTTS", "CSH", "CSA"].includes(p.key) ? ["oui", "non"][p.side] : p.side ? "moins" : "plus",
      edge_pct: Math.round(p.edge * 1000) / 10, odd: p.odd, stake: STAKE, last_score: p.sc, last_minute: p.min, source };
    // Même signal vu deux fois (but relu en double) : une seule série de tentatives.
    if (seenKeys.has(signal_key)) return;
    seenKeys.add(signal_key);
    // Pas de paris contradictoires sur un même match (ex. « plus de 1.5 » puis « moins de 2.5 »).
    const d = dir(p.key, base.side);
    if (d) {
      const prev = await db.ProbAutoBet.filter({ xbet_id: m.x, status: "placed" }, { limit: 20, fields: ["market_key", "side"] }).then((r: any) => r.items).catch(() => []);
      if (prev.some((b: any) => dir(b.market_key, b.side) === -d)) return;
    }
    // Refus (cote fermée, marché bloqué…) : relance avec la cote relue à chaque essai.
    // Probabilités : toutes les 25 s pendant 3 min, tant que la cote reste proche de celle du signal.
    // Retard de but : la fenêtre ne dure que quelques secondes, relance toutes les 2 s pendant 12 s.
    let r: any;
    const goal = source === "goal";
    const tries = goal ? 6 : TRIES, pause = goal ? 2000 : PAUSE;
    for (let i = 0; i < tries; i++) {
      // But remis en doute pendant les relances (1xBet revient à l'ancien score) : on arrête tout de suite
      if (p.ev && (p.ev.cancelled || !p.ev.xRemoved)) { r = { step: "annule", reason: "but remis en doute chez 1xBet" }; break; }
      let o: any = null;
      if (cb) {
        const s = await cbSnap(m.c).catch(() => null);
        const id = s?.ids?.[p.key]?.[p.side], cf = s?.mk?.[p.key]?.[p.side];
        if (id && cf) o = { id: id.it, bt: id.bt, ev: Number(m.c), cf, status: s!.locked.has(p.key) ? 0 : 1 };
      } else if (bp) {
        const s = await bpSnap(m.b).catch(() => null);
        const id = s?.ids?.[p.key]?.[p.side], cf = s?.mk?.[p.key]?.[p.side];
        if (id && cf) o = { id, cf, status: s!.locked.has(p.key) ? 0 : 1 };
      } else {
        const f = findOdd(stream.odds.get(m.w), m.wHome, p.key, p.side);
        o = f ? { id: f.id, cf: f.cf, status: f.status } : null;
      }
      if (o && !p.odd) base.odd = p.odd = o.cf; // option ajoutée (BTTS, clean sheet) : cote lue au premier relevé
      if (o && o.cf < 1.05) o = null; // cote ridicule : le site a déjà vu le but
      if (o && !goal && o.cf < 1.2) o = null; // probabilités : jamais sous 1,20, même si la cote a baissé depuis le signal
      // La cote a trop baissé : l'avantage a disparu (probabilités : dès le 1er essai, le site a déjà corrigé)
      if (o && i && !cb && o.cf < p.odd * 0.95) o = null; // la cote a trop baissé : l'avantage a disparu
      // betPawa retire la ligne dès qu'il a vu le but : absente = il a déjà réagi, inutile d'insister ni de noter un échec
      if (bp && !o) { r = { step: "ferme_betpawa" }; break; }
      await trace(db, "signal", `Signal ${source} ${i ? `relance ${i}/${tries - 1}` : "retenu"} : ${m.name} ${p.min}' [${base.market_label}] @${p.odd}, cote lue chez ${bp ? "betPawa" : "1win"} ${o ? `${o.cf} (état ${o.status})` : "absente"}${opts.dry ? " (à blanc)" : ""}`);
      r = await run(db, { base, o, dry: !!opts.dry, final: i === tries - 1 });
      if (!["cote", "refus", "connexion"].includes(r?.step)) break;
      if (i < tries - 1) await new Promise((s) => setTimeout(s, pause));
    }
    results.push({ match: m.name, market: base.market_label, source, ...r });
  };
  const fail = (e: any) => trace(db, "erreur", String(e?.message || e), false);
  return {
    results,
    check: async () => {
      const x = await exec();
      const [c, b] = await Promise.all([x.connect1win(db), x.connectBook(db, "betpawa")]);
      return { ok: !!c.ok, reason: c.reason || null, balance: c.balance ?? null, betpawa: { ok: !!b.ok, reason: b.reason || null, balance: b.balance ?? null, pays: b.country || null } };
    },
    /** Signaux nés pendant ce tour : chacun est posé à la suite, sans bloquer le scanner. */
    scan(m: any) {
      for (const p of m.pend || []) {
        if (p.betTried || !eligible(p)) continue;
        p.betTried = true;
        tasks.push(place(p).catch(fail)); // en parallèle : les 3 min de relance ne bloquent pas les autres signaux
      }
    },
    /** Retard de but : dès que 1win laisse ouverte une option déjà gagnée (but vu sur au moins 2 sites), on mise. */
    goal(m: any, ev: any) {
      // On ne mise que si 1xBet a RETIRÉ l'option déjà gagnée (but validé chez lui).
      // Option seulement suspendue = but en doute (VAR, erreur) : on attend.
      if (ev.cancelled || !ev.xRemoved) return;
      ev.betTried ||= {};
      // Chaque site (1win, betPawa) est misé séparément ; total équipe ET total match misés en même temps.
      for (const [bk, id] of [["w", m.w], ["b", m.b]] as const) for (const k of ["team", "match"] as const) {
        const tk = `${bk}_${k}`;
        if (ev.betTried[tk] || !id || !ev.open[tk]) continue;
        ev.betTried[tk] = true;
        const key = k === "team" ? ev.teamKey : ev.matchKey;
        const p = { ev, source: "goal", bk, m, key, side: 0, line: Number(key.split("_")[1]), odd: ev.open[`${bk}_${k}`].odd, edge: 0, min: ev.minute, sc: ev.sc.join("-") };
        tasks.push(place(p).catch(fail));
      }
      // Options supplémentaires déjà gagnées, misées tant que le site affiche encore l'ancien score :
      // BTTS oui (la 2e équipe vient d'ouvrir son compteur) et « n'encaisse pas : non » (betPawa).
      const [h, a] = ev.sc, first = ev.side === "H" ? h === 1 : a === 1;
      const extra: [string, number][] = [];
      if (first && h > 0 && a > 0) extra.push(["BTTS", 0]);
      if (first) extra.push([ev.side === "H" ? "CSA" : "CSH", 1]);
      for (const [bk, id] of [["w", m.w], ["b", m.b]] as const) {
        if (!id || ev.seen?.[bk] != null) continue;
        for (const [key, side] of extra) {
          if (key !== "BTTS" && bk === "w") continue; // 1win : clean sheet non lu
          const tk = `${bk}_${key}`;
          if (ev.betTried[tk]) continue;
          ev.betTried[tk] = true;
          tasks.push(place({ ev, source: "goal", extra: true, bk, m, key, side, line: 0, odd: 0, edge: 0, min: ev.minute, sc: ev.sc.join("-") }).catch(fail));
        }
      }
      // Congobet : toutes les options gagnées par ce but sont misées en même temps, quelle que soit la durée d'ouverture.
      // Total match, total de l'équipe, BTTS oui (2e équipe qui ouvre son compteur), « qui va marquer le n-ième but ».
      if (m.c && !ev.betTried.c) {
        ev.betTried.c = true;
        const opts: [string, number][] = [[ev.teamKey, 0], [ev.matchKey, 0], [`GOAL${h + a}`, ev.side === "H" ? 0 : 2]];
        if (first && h > 0 && a > 0) opts.push(["BTTS", 0]);
        for (const [key, side] of opts) tasks.push(place({ ev, source: "goal", bk: "c", m, key, side, line: /_/.test(key) ? Number(key.split("_")[1]) : 0, odd: 0, edge: 0, min: ev.minute, sc: ev.sc.join("-") }).catch(fail));
      }
    },
    done: () => Promise.all(tasks),
  };
}

/** Règlement des paris ouverts, avec les mêmes règles que les signaux. */
export async function loadOpenBets(db: any) {
  return (await db.ProbAutoBet.filter({ status: "placed" }, { limit: 100 }).catch(() => ({ items: [] }))).items || [];
}
export function settleBet(b: any, sc: [number, number], final: boolean) {
  const v = verdict(b, sc, final);
  const out: any = { last_score: sc.join("-") };
  if (v) Object.assign(out, { status: v, settled_at: new Date().toISOString(), profit: v === "won" ? Math.round(b.stake * (b.odd - 1)) : v === "lost" ? -b.stake : 0 });
  return out;
}