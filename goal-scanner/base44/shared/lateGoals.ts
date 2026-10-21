// Profil « buts tardifs » d'un match, calculé avant de le surveiller :
// pour chaque équipe, ses 5 derniers matchs (FotMob) → combien ont eu un but après la 80e
// marqué par elle (scored) ou encaissé par elle (conceded).
const H = { "User-Agent": "Mozilla/5.0" };
const cache = new Map<number, any>();
const get = (id: number) => fetch(`https://www.fotmob.com/api/data/matchDetails?matchId=${id}`, { headers: H, signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null);

async function pastLate(matchId: number, teamId: number) {
  if (cache.has(matchId * 1e6 + teamId)) return cache.get(matchId * 1e6 + teamId);
  const j = await get(matchId);
  if (!j?.content) return null;
  const home = j.general?.homeTeam?.id === teamId;
  const late = (j.content.matchFacts?.events?.events || []).filter((e: any) => e.type === "Goal" && Number(e.time) >= 80);
  const r = { scored: late.some((e: any) => e.isHome === home), conceded: late.some((e: any) => e.isHome !== home) };
  cache.set(matchId * 1e6 + teamId, r);
  return r;
}

export async function lateProfile(fotmobId: number) {
  const j = await get(fotmobId);
  const forms = j?.content?.matchFacts?.teamForm;
  const ids = [j?.general?.homeTeam?.id, j?.general?.awayTeam?.id];
  if (!forms || !ids[0]) return null;
  const side = async (k: number) => {
    const past = (forms[k] || []).map((f: any) => Number(String(f.linkToMatch || "").split("#")[1])).filter(Boolean).slice(0, 5);
    const rs = (await Promise.all(past.map((m: number) => pastLate(m, ids[k])))).filter(Boolean);
    return { n: rs.length, scored: rs.filter((r: any) => r.scored).length, conceded: rs.filter((r: any) => r.conceded).length };
  };
  const [h, a] = await Promise.all([side(0), side(1)]);
  return { home: h, away: a };
}

/** Le match mérite une alerte si l'équipe qui pousse marque souvent tard,
 *  ou si son adversaire encaisse souvent tard (au moins 2 fois sur 5 cumulés). */
export function lateOk(p: any, side: string) {
  if (!p) return false;
  const push = side === "exterieur" ? p.away : p.home, other = side === "exterieur" ? p.home : p.away;
  return push.scored + other.conceded >= 2;
}