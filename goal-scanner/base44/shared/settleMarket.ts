// ═══════════════════════════════════════════════════════════════════
// Vérification d'une prédiction à partir du score final.
// Chaque code de marché produit par bookFeed.ts est déductible du score.
// Le sport compte : au basket les périodes sont des quart-temps (une
// mi-temps = 2 quart-temps), au tennis le score final est en SETS alors
// que les totaux du bookmaker portent sur les JEUX (somme des sets).
// Renvoie "won" | "lost", ou null quand le score disponible ne permet pas
// encore de trancher (données de période manquantes) : le match reste alors
// en attente et sera retenté — une prédiction n'est jamais « remboursée ».
// ═══════════════════════════════════════════════════════════════════

type Periods = Array<{ key?: number; name?: string; s1?: number; s2?: number }>;

// Familles statistiques produites par les lecteurs de cotes (ST_<FAM>_…).
// Les plus longues d'abord : « SHOTS_ON » doit être testé avant « SHOTS ».
export const STAT_FAMILY_CODES = ["YELLOW_CARDS", "SHOTS_ON", "GOALKICKS", "OFFSIDES", "THROWINS", "CORNERS", "FOULS", "SHOTS"];

function periodSum(periods: Periods, keys: number[]) {
  const found = (periods || []).filter((p) => keys.includes(Number(p.key)));
  if (!found.length) return null;
  return found.reduce(
    (acc, p) => ({ s1: acc.s1 + (Number(p.s1) || 0), s2: acc.s2 + (Number(p.s2) || 0) }),
    { s1: 0, s2: 0 },
  );
}

// Périodes correspondant à la « 1re / 2e mi-temps » selon le sport.
function halfKeys(sport: string, half: number) {
  if (sport === "basketball") return half === 1 ? [1, 2] : [3, 4];
  return [half];
}

export function settlePrediction(
  market: string,
  score: { s1: number; s2: number; periods?: Periods; stats?: Record<string, { s1: number; s2: number }> },
  sport = "football",
): "won" | "lost" | null {
  const code = String(market || "").toUpperCase();

  // ── Marchés statistiques (corners, tirs cadrés, fautes, dégagements…) ──
  // Le bookmaker publie le score officiel de chaque statistique : l'issue est
  // tranchée exactement comme un score de match, sur ces chiffres.
  // Le code est ST_<FAMILLE>_<marché intérieur> ; le marché intérieur suit la
  // même grammaire que le match (WIN_, DC_, OU_/OVER_, TT_, AH_, BTTS_), et se
  // tranche sur le compte de la statistique comme sur un score.
  if (code.startsWith("ST_")) {
    const body = code.slice(3);
    const fam = STAT_FAMILY_CODES.find((f) => body.startsWith(f + "_"));
    if (!fam) return null;
    const st = (score.stats || {})[fam];
    if (!st) return null;
    const inner = body.slice(fam.length + 1).replace(/^(OVER|UNDER)_/, "OU_$1_");
    return settlePrediction(inner, { s1: st.s1, s2: st.s2 });
  }

  const { s1, s2 } = score;
  const periods = score.periods || [];

  // Au tennis, les totaux et handicaps du bookmaker se comptent en jeux :
  // le score final (sets) ne suffit pas, il faut additionner les périodes.
  const games = sport === "tennis" ? periodSum(periods, [1, 2, 3, 4, 5]) : null;
  const totalUnits = sport === "tennis" ? (games ? games.s1 + games.s2 : null) : s1 + s2;

  const cmp = (value: number | null, lineStr: string, over: boolean): "won" | "lost" | null => {
    const l = parseFloat(lineStr);
    if (value == null || !isFinite(l)) return null;
    if (value === l) return "lost"; // ligne pleine atteinte : le seuil n'est pas franchi
    return (over ? value > l : value < l) ? "won" : "lost";
  };

  if (code === "WIN_HOME") return s1 > s2 ? "won" : "lost";
  if (code === "WIN_AWAY") return s2 > s1 ? "won" : "lost";
  if (code === "WIN_DRAW") return s1 === s2 ? "won" : "lost";
  if (code === "DC_1X") return s1 >= s2 ? "won" : "lost";
  if (code === "DC_X2") return s2 >= s1 ? "won" : "lost";
  if (code === "DC_12") return s1 !== s2 ? "won" : "lost";
  if (code === "BTTS_YES") return s1 > 0 && s2 > 0 ? "won" : "lost";
  if (code === "BTTS_NO") return s1 === 0 || s2 === 0 ? "won" : "lost";

  let m = code.match(/^OU_(OVER|UNDER)_(.+)$/);
  if (m) return cmp(totalUnits, m[2], m[1] === "OVER");

  // Total par équipe : TT_HOME_OVER_1.5 / TT_AWAY_UNDER_0.5
  m = code.match(/^TT_(HOME|AWAY)_(OVER|UNDER)_(.+)$/);
  if (m) return cmp(m[1] === "HOME" ? s1 : s2, m[3], m[2] === "OVER");

  // Marchés de mi-temps : le score de la période tranche le marché intérieur
  // (H1_OVER_1.5, H1_WIN_HOME, H1_DC_1X, H1_BTTS_YES, H1_AH_HOME_-0.5…).
  m = code.match(/^H([12])_(.+)$/);
  if (m) {
    const half = periodSum(periods, halfKeys(sport, Number(m[1])));
    if (!half) return null;
    const inner = m[2].replace(/^(OVER|UNDER)_/, "OU_$1_");
    return settlePrediction(inner, { s1: half.s1, s2: half.s2 }, sport);
  }

  m = code.match(/^AH_(HOME|AWAY)_(-?[\d.]+)$/);
  if (m) {
    const l = parseFloat(m[2]);
    if (!isFinite(l)) return null;
    // Tennis : au-delà de 2.5 le handicap porte sur les jeux, sinon sur les sets.
    const useGames = sport === "tennis" && Math.abs(l) > 2.5;
    if (useGames && !games) return null;
    const a = useGames ? games!.s1 : s1;
    const b = useGames ? games!.s2 : s2;
    const diff = m[1] === "HOME" ? a - b + l : b - a + l;
    if (diff === 0) return "lost"; // handicap pile atteint : pas franchi
    return diff > 0 ? "won" : "lost";
  }

  return null;
}