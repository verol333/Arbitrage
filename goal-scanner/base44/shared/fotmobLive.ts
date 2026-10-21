import { sameTeam } from "./teamMatch.ts";

// FotMob (gratuit) : momentum minute par minute, tirs avec minute et xG.
const H = { "user-agent": "Mozilla/5.0 Chrome/120", accept: "application/json" };
let day = { key: "", at: 0, list: [] as any[] };

/** Retrouve l'identifiant FotMob d'un match à partir des noms d'équipes (liste du jour relue toutes les 10 min). */
export async function fotmobFind(home: string, away: string): Promise<number | null> {
  const key = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  if (day.key !== key || Date.now() - day.at > 10 * 60e3) {
    const j = await fetch(`https://www.fotmob.com/api/data/matches?date=${key}`, { headers: H, signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null);
    if (j?.leagues) day = { key, at: Date.now(), list: j.leagues.flatMap((l: any) => l.matches || []) };
  }
  // Les deux équipes doivent correspondre (une seule reliait des matchs sans rapport) et le statut féminin aussi
  const wom = (s: string) => /women|femin|\(w\)|ladies/i.test(s || "");
  const m = day.list.find((x: any) => sameTeam(x.home?.name, home) && sameTeam(x.away?.name, away) && wom(x.home?.name) === wom(home));
  return m?.id ?? null;
}

/** Momentum (+ = domicile) et tirs du match. null si FotMob ne couvre pas ce match. */
export async function fotmobDetails(id: number) {
  const j = await fetch(`https://www.fotmob.com/api/data/matchDetails?matchId=${id}`, { headers: H, signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null);
  if (!j?.content) return null;
  const homeId = j.general?.homeTeam?.id;
  const momentum = (j.content.momentum?.main?.data || []).map((d: any) => ({ m: Number(d.minute), v: Number(d.value) }));
  const shots = (j.content.shotmap?.shots || []).map((s: any) => ({
    m: Number(s.min) + Number(s.minAdded || 0), home: s.teamId === homeId, xg: Number(s.expectedGoals || 0), on: !!s.isOnTarget, goal: s.eventType === "Goal",
  }));
  return { momentum, shots, covered: momentum.length > 0 || shots.length > 0 };
}