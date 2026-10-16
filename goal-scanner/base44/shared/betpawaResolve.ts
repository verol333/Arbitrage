// ═══════════════════════════════════════════════════════════════════
// BETPAWA — résolution d'une sélection réelle (selectionId + cote fraîche)
// à partir de l'ID de match, de la famille de marché et du libellé du scanner.
//
// Endpoint : GET /api/sportsbook/v4/events/{eventId}
// Réponse : { id, name, markets:[ { marketType:{ id, name },
//             row:[ { prices:[ { id, name, typeId, odds, handicap } ],
//                     specifier:{ total|hcp } } ] } ] }
// Le `price.id` est l'identifiant de sélection à envoyer au placement de pari.
//
// ⚠️ Le type de marché est déduit du LIBELLÉ (« Domicile ou Nul » = Double
// Chance) et la période de la FAMILLE (« 1MT … » = 1ère mi-temps) : la famille
// du scanner mélange les deux (« 1X2 — 2 + 1X ») et ne peut pas servir seule.
// ═══════════════════════════════════════════════════════════════════

import { BETPAWA_BY_HOST, DEFAULT_BETPAWA_COUNTRY } from "./betpawaCountries.ts";

// ⚠️ LES COTES SE LISENT SUR LE SITE OÙ LA MISE PARTIRA.
//
// betPawa ouvre et ferme ses prix PAR PAYS. On lisait le site du Congo puis on
// posait sur le site du compte : un prix ouvert au Congo pouvait être déjà
// retiré là-bas, et betPawa répondait « hors ligne » sur une cote que nous
// venions pourtant de voir affichée. Le bookmaker ne se contredisait pas —
// nous regardions le mauvais site.
const countryOf = (host?: string) => BETPAWA_BY_HOST[host || ""] || DEFAULT_BETPAWA_COUNTRY;

function headersFor(host?: string): Record<string, string> {
  const c = countryOf(host);
  const origin = `https://${c.host}`;
  return {
    accept: "application/json",
    devicetype: "web",
    origin,
    referer: `${origin}/`,
    "x-pawa-brand": c.brand,
    "x-pawa-language": c.lang,
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    cookie: `bp_country=${c.iso}`,
  };
}

export interface BetpawaSelection {
  selectionId: string;
  odds: number;
  eventId: string;
  market: string;
  label: string;
}

function norm(s: unknown): string {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

/** Extrait la ligne numérique (« Plus de 2.5 » → 2.5). */
function lineOf(s: string): number | null {
  const m = String(s).replace(",", ".").match(/-?\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(",", ".")) : null;
}

/** Type de marché déduit du libellé de la sélection + noms betPawa acceptés. */
const LABEL_RULES: Array<{ re: RegExp; market: RegExp; names: string[]; line?: boolean; hcp?: boolean }> = [
  { re: /^(oui|yes|gg)$/i, market: /both teams to score/i, names: ["oui", "yes"] },
  { re: /^(non|no|ng)$/i, market: /both teams to score/i, names: ["non", "no"] },
  { re: /^(1x|1 ou x|dom\.? ou nul|domicile ou nul)$/i, market: /double chance/i, names: ["1x", "1 ou x", "domicile ou nul"] },
  { re: /^(x2|x ou 2|nul ou ext\.?\w*)$/i, market: /double chance/i, names: ["x2", "x ou 2", "nul ou exterieur"] },
  { re: /^(12|1 ou 2|dom\.? ou ext\.?\w*)$/i, market: /double chance/i, names: ["12", "1 ou 2", "domicile ou exterieur"] },
  { re: /(pair|even)/i, market: /odd\/even/i, names: ["pair", "even"] },
  { re: /(impair|odd)/i, market: /odd\/even/i, names: ["impair", "odd"] },
  { re: /(plus de|over|\+\s*\d)/i, market: /total score over\/under/i, names: ["plus de", "over"], line: true },
  { re: /(moins de|under)/i, market: /total score over\/under/i, names: ["moins de", "under"], line: true },
  // Handicap : le prix porte lui-même son handicap signé (+0.5 / -0.5) et se
  // nomme « 1 » ou « 2 » → le côté vient du libellé, la ligne du prix.
  { re: /^(dom\.?|domicile|home)\s*[+-]/i, market: /handicap/i, names: ["1"], line: true, hcp: true },
  { re: /^(ext\.?\w*|away)\s*[+-]/i, market: /handicap/i, names: ["2"], line: true, hcp: true },
  { re: /^(1|domicile|home)$/i, market: /^1x2/i, names: ["1"] },
  { re: /^(x|nul|draw)$/i, market: /^1x2/i, names: ["x", "nul"] },
  { re: /^(2|exterieur|extérieur|away)$/i, market: /^1x2/i, names: ["2"] },
];

/** Lit le détail complet d'un match betPawa (null si indisponible). */
export async function fetchBetpawaEventDetail(eventId: string | number, host?: string) {
  const res = await fetch(`https://${countryOf(host).host}/api/sportsbook/v4/events/${eventId}`, {
    headers: headersFor(host),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  return await res.json().catch(() => null);
}

/**
 * Résout la sélection betPawa à jouer, avec sa cote fraîche.
 * Renvoie { ok:false } si le marché ou la sélection n'est pas disponible.
 */
export async function resolveBetpawaSelection(
  eventId: string | number,
  family: string,
  legLabel: string,
  priceId?: string | number,
  host?: string,
): Promise<
  | { ok: true; selection: BetpawaSelection }
  | { ok: false; code: string; reason: string }
> {
  const event = await fetchBetpawaEventDetail(eventId, host);
  if (!event || !Array.isArray(event.markets)) {
    return { ok: false, code: "event_unavailable", reason: `betPawa : match ${eventId} introuvable ou fermé` };
  }

  // ── Voie prioritaire : l'identifiant de sélection relevé par le scanner.
  // Il supprime toute interprétation de libellé (source de refus injustifiés)
  // et la cote est relue fraîche dans le détail du match.
  if (priceId) {
    const wantedId = String(priceId);
    for (const m of event.markets) {
      for (const row of m.row || []) {
        for (const p of row.prices || []) {
          if (String(p?.id) !== wantedId) continue;
          const odds = Number(p.odds);
          if (!Number.isFinite(odds) || odds <= 1) {
            return { ok: false, code: "market_closed", reason: "betPawa : sélection suspendue à l'instant — aucune mise engagée" };
          }
          // ⚠️ 18/09/2026 — CAUSE DES 3 DÉCOUVERTS YELLOWBET. betPawa continue de
          // publier la cote d'un prix qu'il a SUSPENDU (`suspended: true`) : la
          // sélection était résolue « jouable » à 2.05, YellowBet engagé, puis
          // betPawa refusait FOB_OFFLINE_PRICES. Le drapeau est lu ici : la
          // sélection est déclarée fermée AVANT qu'un franc ne parte ailleurs.
          if (p?.suspended === true) {
            return { ok: false, code: "market_closed", reason: "betPawa : sélection suspendue (cote affichée mais non jouable) — aucune mise engagée" };
          }
          return {
            ok: true,
            selection: {
              selectionId: wantedId,
              odds,
              eventId: String(event.id),
              market: String(m?.marketType?.name || ""),
              label: String(p.name || ""),
            },
          };
        }
      }
    }
    return { ok: false, code: "selection_gone", reason: "betPawa : la sélection n'est plus proposée sur ce match" };
  }

  const label = String(legLabel || "").trim();
  const rule = LABEL_RULES.find((r) => r.re.test(label));
  if (!rule) {
    return { ok: false, code: "unsupported_market", reason: `betPawa : sélection « ${family} / ${label} » non reconnue` };
  }

  // Période : 1ère mi-temps si la famille le dit, sinon temps réglementaire.
  const firstHalf = /(1mt|mt1|mi-?temps 1|1ere mi|1st half|\bht\b|1h)/i.test(family);
  const periodOk = (name: string) =>
    firstHalf ? /(1st half|- ht|\bht\b|1h)/i.test(name) : !/(1st half|- ht|\bht\b|2nd half)/i.test(name);

  // Équipe visée pour les totaux par équipe (« Total Équipe 1 »).
  const teamSide = /(equipe 1|team 1|domicile|home)/i.test(family) ? "home"
    : /(equipe 2|team 2|exterieur|extérieur|away)/i.test(family) ? "away" : null;
  const teamOk = (name: string) =>
    teamSide === "home" ? /home team/i.test(name)
      : teamSide === "away" ? /away team/i.test(name)
        : !/(home team|away team)/i.test(name);

  const line = rule.line ? (lineOf(label) ?? lineOf(family)) : null;
  const wanted = rule.names.map(norm);

  const markets = event.markets.filter((m: any) => {
    const name = String(m?.marketType?.name || "");
    return rule.market.test(name) && periodOk(name) && teamOk(name);
  });
  if (!markets.length) {
    return {
      ok: false,
      code: "market_unavailable",
      reason: `betPawa : marché « ${family} / ${label} » absent de ce match à l'instant`,
    };
  }

  for (const m of markets) {
    for (const row of m.row || []) {
      if (line !== null) {
        const rowLine = Number(row?.specifier?.total ?? row?.specifier?.hcp ?? row?.prices?.[0]?.handicap);
        if (!Number.isFinite(rowLine) || rowLine !== line) continue;
      }
      for (const p of row.prices || []) {
        const names = [p.name, p.displayName].map(norm);
        if (!wanted.some((w) => names.some((n) => n === w || n.startsWith(w)))) continue;
        const odds = Number(p.odds);
        if (!Number.isFinite(odds) || odds <= 1) continue;
        // Prix suspendu par betPawa : cote affichée mais refusée à la pose.
        if (p?.suspended === true) {
          return { ok: false, code: "market_closed", reason: "betPawa : sélection suspendue (cote affichée mais non jouable) — aucune mise engagée" };
        }
        return {
          ok: true,
          selection: {
            selectionId: String(p.id),
            odds,
            eventId: String(event.id),
            market: String(m?.marketType?.name || ""),
            label: String(p.name || ""),
          },
        };
      }
    }
  }

  return {
    ok: false,
    code: "market_unavailable",
    reason: `betPawa : sélection « ${label} » (${family}) indisponible ou suspendue à l'instant`,
  };
}