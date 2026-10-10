import { sameTeam } from "../../shared/teamMatch.ts";
import { label } from "../../shared/liveMarkets.ts";
import { verdict } from "./probLag.ts";

// Mise automatique 1win des signaux « probabilités en avance » et « retard de but ».
// Filtre validé : avantage 15–45 %, cote < 2,5, avant la 60e minute. 100 F par pari.
// Capital, connexion et placement : base44/shared/probAutoExec.ts.
export const STAKE = 100;
export const eligible = (p: any) => p.bk === "w" && p.edge >= 0.15 && p.edge <= 0.45 && p.odd < 2.5 && p.min < 60;

/** Identifiant 1win de la cote visée (mêmes règles de lecture que wParse). */
export function findOdd(groups: Record<string, any[]> | undefined, home: string, key: string, side: number) {
  if (!groups) return null;
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
    if (pre !== "TOT" && sameTeam(gn.trim().replace(/ total$/i, ""), home) !== (pre === "ITH")) continue;
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

export function createAutoBet(db: any, stream: any, opts: { dry?: boolean } = {}) {
  let queue: Promise<any> = Promise.resolve();
  const results: any[] = [];
  const place = async (p: any) => {
    const m = p.m, source = p.source || "prob";
    const signal_key = source === "goal" ? `goal|${m.x}|${p.sc}` : `${m.x}|${p.key}|${p.side}|${p.min}`;
    const base = { signal_key, xbet_id: m.x, onewin_match_id: m.w, match_label: m.name, minute: p.min, score: p.sc, market_key: p.key,
      market_label: label(p.key, p.side), line: p.line, side: p.key === "1X2" ? ["1", "X", "2"][p.side] : p.key === "BTTS" ? ["oui", "non"][p.side] : p.side ? "moins" : "plus",
      edge_pct: Math.round(p.edge * 1000) / 10, odd: p.odd, stake: STAKE, last_score: p.sc, last_minute: p.min, source };
    const f = findOdd(stream.odds.get(m.w), m.wHome, p.key, p.side);
    const o = f ? { id: f.id, cf: f.cf, status: f.status } : null;
    await trace(db, "signal", `Signal ${source} retenu : ${m.name} ${p.min}' [${base.market_label}] @${p.odd}, cote 1win ${o ? `${o.cf} (état ${o.status})` : "absente"}${opts.dry ? " (à blanc)" : ""}`);
    const r = await run(db, { base, o, dry: !!opts.dry });
    results.push({ match: m.name, market: base.market_label, source, ...r });
  };
  const fail = (e: any) => trace(db, "erreur", String(e?.message || e), false);
  return {
    results,
    check: async () => {
      const c = await (await exec()).connect1win(db);
      return { ok: !!c.ok, reason: c.reason || null, balance: c.balance ?? null };
    },
    /** Signaux nés pendant ce tour : chacun est posé à la suite, sans bloquer le scanner. */
    scan(m: any) {
      for (const p of m.pend || []) {
        if (p.betTried || !eligible(p)) continue;
        p.betTried = true;
        queue = queue.then(() => place(p)).catch(fail);
      }
    },
    /** Retard de but : dès que 1win laisse ouverte une option déjà gagnée (but vu sur au moins 2 sites), on mise. */
    goal(m: any, ev: any) {
      if (ev.betTried || ev.cancelled || !m.w) return;
      if (Object.values(ev.seen || {}).filter((v) => v != null).length < 2) return;
      const k = ev.open.w_team ? "team" : ev.open.w_match ? "match" : null;
      if (!k) return;
      ev.betTried = true;
      const key = k === "team" ? ev.teamKey : ev.matchKey;
      const p = { source: "goal", m, key, side: 0, line: Number(key.split("_")[1]), odd: ev.open[`w_${k}`].odd, edge: 0, min: ev.minute, sc: ev.sc.join("-") };
      queue = queue.then(() => place(p)).catch(fail);
    },
    done: () => queue,
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