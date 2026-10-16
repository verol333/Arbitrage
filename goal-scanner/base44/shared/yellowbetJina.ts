// ═══════════════════════════════════════════════════════════════════
// YELLOWBET — PONT D'EXÉCUTION « DEPUIS L'INTÉRIEUR DU SITE ».
//
// PROBLÈME : yellowbet.cg est verrouillé géographiquement par Cloudflare.
// Toute requête partie de nos serveurs reçoit un 403 « accès restreint »,
// quels que soient les en-têtes envoyés (X-Forwarded-For inclus) : le refus
// se joue sur l'IP source, avant lecture des en-têtes.
//
// SOLUTION VÉRIFIÉE : on demande à un navigateur distant d'OUVRIR yellowbet.cg,
// puis d'exécuter nos requêtes DEPUIS la page elle-même. Pour YellowBet, c'est
// un visiteur ordinaire qui navigue sur son propre site : même origine, mêmes
// cookies, IP acceptée. Les requêtes passent — connexion comprise.
//
// Tests réels :
//   GET  /services/evapi/event/GetSportsTree      → 200, 36 726 caractères
//   POST /services/clapi/api/.../LoginUser        → 200, « Mauvaises références »
//                                                   (refus métier = le POST arrive)
//
// Les requêtes d'une même séquence partagent la page : les cookies posés par
// la connexion sont automatiquement présents sur les requêtes suivantes. Un
// seul aller-retour suffit donc pour « se connecter puis lire le solde ».
// ═══════════════════════════════════════════════════════════════════

import { relayRun, relayConfigured } from "./yellowbetRelay.ts";

const READER = "https://r.jina.ai/";
// Lecture du compte (solde, bonus) une fois connecté — capturé en F12.
const KEEPALIVE_PATH = "/services/clapi/api/dynamic/execute/Sport/GetKeepAlive";

// En-têtes que le site attend sur son API interne (relevés en F12).
const YB_HEADERS = {
  "content-type": "application/json",
  accept: "*, application/json",
  channelid: "4",
  terminal: "yellowbet.cg",
  brandid: "122",
  language: "fr",
};

export interface YbRequest {
  path: string;                 // ex: "/services/clapi/api/Authentication/LoginUser"
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>; // surcharge ponctuelle (ex: channelid web)
  useToken?: boolean;           // joint le jeton renvoyé par la connexion (Authorization + Token)
  tokenBodyField?: string;      // recopie aussi le jeton dans le corps sous ce champ (ex: userToken)
  retryIfNull?: string;         // rejoue la requête (3 essais) tant que ce champ de la réponse est vide
  fromPrev?: Record<string, string>; // recopie dans le corps des champs de la réponse précédente : { champCorps: "chemin.reponse" }
  skipIfPrevNull?: string;      // saute la requête si ce champ de la réponse précédente est vide
  delayMs?: number;             // attente fixe avant la requête
  delayFromPrev?: string;       // attente (ms) lue dans la réponse précédente — ex: "timeout" (délai live imposé par YellowBet)
}

export interface YbResponse {
  status: number;
  json: Record<string, any> | null;
  text: string;
}

/**
 * Exécute une séquence de requêtes à l'intérieur de yellowbet.cg.
 * Les requêtes s'enchaînent dans l'ordre et partagent la même session de page.
 */
export async function ybRun(requests: YbRequest[], apiKey: string, pageUrl = "https://yellowbet.cg/"): Promise<
  { success: true; results: YbResponse[] } | { success: false; error: string; detail?: string }
> {
  // Voie principale : notre relais gratuit (aucune clé à renouveler, réponse en
  // quelques centaines de millisecondes). Le lecteur Jina ne sert plus que de
  // secours si le relais n'est pas configuré ou tombe.
  const viaRelay = await relayRun(requests);
  if (viaRelay) {
    return {
      success: true,
      results: viaRelay.map((r) => {
        let json: Record<string, any> | null = null;
        try { json = JSON.parse(r.text); } catch (_e) { /* réponse non JSON */ }
        return { status: r.status, json, text: r.text };
      }),
    };
  }

  if (!apiKey) return { success: false, error: "jina_key_missing" };

  // Le script est exécuté dans la page. Il dépose son résultat encodé en base64
  // dans un élément dédié : l'encodage protège le JSON de la mise en forme
  // appliquée par le lecteur lors de l'extraction du texte.
  const script = `(async()=>{
    const put=(s)=>{const d=document.createElement('div');d.id='alve-yb';d.textContent=s;document.body.appendChild(d);};
    const reqs=${JSON.stringify(requests)};
    const H=${JSON.stringify(YB_HEADERS)};
    const out=[];let token='';let prev=null;
    const get=(o,p)=>{let v=o;for(const k of p.split('.')){v=v==null?null:v[k];}return v;};
    for(const q of reqs){
      try{
        if(q.skipIfPrevNull&&get(prev,q.skipIfPrevNull)==null){out.push({status:0,text:'SKIPPED'});continue;}
        const wait=Math.max(Number(q.delayMs)||0,q.delayFromPrev?(Number(get(prev,q.delayFromPrev))||0):0);
        if(wait>0)await new Promise(res=>setTimeout(res,Math.min(wait+300,20000)));
        const hd=Object.assign({},H,q.headers||{});
        if(q.useToken&&token){hd.authorization='Bearer '+token;hd.token=token;}
        const init={method:q.method||'GET',headers:hd,credentials:'include'};
        let body=q.body;
        if(q.tokenBodyField&&token&&body&&typeof body==='object'){body=Object.assign({},body);body[q.tokenBodyField]=token;}
        if(q.fromPrev&&body&&typeof body==='object'){body=Object.assign({},body);for(const k in q.fromPrev){body[k]=get(prev,q.fromPrev[k]);}}
        if(body!==undefined&&body!==null)init.body=JSON.stringify(body);
        let r,txt;
        for(let t=0;t<3;t++){
          r=await fetch(q.path,init);
          txt=await r.text();
          if(!q.retryIfNull)break;
          let j=null;try{j=JSON.parse(txt);}catch(e){}
          if(get(j,q.retryIfNull)!=null)break;
          await new Promise(res=>setTimeout(res,900));
        }
        prev=null;try{prev=JSON.parse(txt);if(prev&&typeof prev.token==='string'&&prev.token)token=prev.token;}catch(e){}
        out.push({status:r.status,text:txt.slice(0,6000)});
      }catch(e){out.push({status:0,text:'FETCH_ERROR: '+String(e)});}
    }
    const bytes=new TextEncoder().encode(JSON.stringify(out));let hex='';
    for(let i=0;i<bytes.length;i++){hex+=bytes[i].toString(16).padStart(2,'0');}
    put('L'+bytes.length+'Z'+hex);
  })();`;

  // Le lecteur distant altère parfois le texte extrait (caractères perdus) :
  // la longueur annoncée en tête permet de le détecter et de rejouer.
  let last: { success: false; error: string; detail?: string } = { success: false, error: "bridge_empty" };
  for (const key of jinaKeys(apiKey)) {
    let switchKey = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await ybBridgeOnce(script, key, pageUrl);
      if (r.success) return r;
      last = r;
      // Clé épuisée ou invalide : on passe à la clé de secours.
      if (r.error === "jina_balance_empty" || r.error === "jina_key_invalid") { switchKey = true; break; }
      if (r.error !== "bridge_unreadable" && r.error !== "bridge_empty") return r;
    }
    if (!switchKey) break;
  }
  return last;
}

/** Clé principale puis clé de secours (JINA_API_KEY_2), sans doublon ni vide. */
function jinaKeys(primary: string): string[] {
  const backup = Deno.env.get("JINA_API_KEY_2") || "";
  return [...new Set([primary, backup].filter(Boolean))];
}

async function ybBridgeOnce(script: string, apiKey: string, pageUrl: string): Promise<
  { success: true; results: YbResponse[] } | { success: false; error: string; detail?: string }
> {
  const res = await fetch(READER, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      "x-engine": "browser",
      "x-wait-for-selector": "#alve-yb",
      "x-target-selector": "#alve-yb",
      "x-return-format": "text",
      "x-no-cache": "true",
      "x-timeout": "50",
    },
    body: JSON.stringify({ url: pageUrl, injectPageScript: script }),
    signal: AbortSignal.timeout(110000),
  });

  const wrapper = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = wrapper?.name || wrapper?.message || `HTTP ${res.status}`;
    // Solde de jetons épuisé / clé invalide : à distinguer d'un refus YellowBet.
    if (res.status === 402) return { success: false, error: "jina_balance_empty", detail: msg };
    if (res.status === 401) return { success: false, error: "jina_key_invalid", detail: msg };
    return { success: false, error: "bridge_failed", detail: String(msg).slice(0, 200) };
  }

  // Format « L<octets>Z<hex> » : seul [0-9a-f] compte dans la partie hex, toute
  // mise en forme ajoutée par le lecteur est ignorée ; la longueur annoncée
  // révèle une extraction tronquée ou altérée.
  const raw = String(wrapper?.data?.text ?? "");
  const m = raw.match(/L(\d+)Z/);
  if (!m) return { success: false, error: "bridge_empty", detail: raw.slice(0, 120) };
  const expected = Number(m[1]);
  const encoded = raw.slice(m.index! + m[0].length).toLowerCase().replace(/[^0-9a-f]/g, "");
  if (encoded.length !== expected * 2) {
    return { success: false, error: "bridge_unreadable", detail: `attendu ${expected * 2} hex, reçu ${encoded.length}` };
  }

  let parsed: { status: number; text: string }[];
  try {
    const bytes = new Uint8Array(expected);
    for (let i = 0; i < expected; i++) bytes[i] = parseInt(encoded.substr(i * 2, 2), 16);
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch (_e) {
    return { success: false, error: "bridge_unreadable", detail: "json" };
  }

  return {
    success: true,
    results: parsed.map((r) => {
      let json: Record<string, any> | null = null;
      try { json = JSON.parse(r.text); } catch (_e) { /* réponse non JSON */ }
      return { status: r.status, json, text: r.text };
    }),
  };
}

// ═══════════════════════════════════════════════════════════════════
// LECTURE DES COTES (anonyme, sans clé) — l'API publique evapi est lisible
// via le lecteur simple ; GetEvents accepte un filtre `eventIds`.
// ═══════════════════════════════════════════════════════════════════
const EV_BASE = "https://yellowbet.cg/services/evapi/event";

// Avec clé : quota confortable. Sans clé : quota par IP vite épuisé (429) → on
// réessaie brièvement.
export async function ybReadJson(url: string, apiKey = ""): Promise<Record<string, any> | null> {
  // Lecture par le relais quand il est en place : instantanée et sans quota.
  if (relayConfigured()) {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const res = await relayRun([{ path, method: "GET" }]);
    const text = res?.[0]?.text;
    if (text) { try { return JSON.parse(text); } catch (_e) { /* réponse non JSON */ } }
  }

  const keys = apiKey ? jinaKeys(apiKey) : [""];
  for (const key of keys) {
    const headers: Record<string, string> = { accept: "application/json", "x-return-format": "text", "x-cache-tolerance": "20" };
    if (key) headers.authorization = `Bearer ${key}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(READER + url, { headers, signal: AbortSignal.timeout(30000) }).catch(() => null);
      if (r && r.status === 429) { await new Promise((res) => setTimeout(res, 1500 * (attempt + 1))); continue; }
      // Clé épuisée (402) ou invalide (401) : clé de secours.
      if (r && (r.status === 402 || r.status === 401)) break;
      if (!r || !r.ok) return null;
      const w = await r.json().catch(() => null);
      const text = w?.data?.text ?? w?.data?.content;
      try { return JSON.parse(text); } catch (_e) { return null; }
    }
  }
  return null;
}

/** Sélection YellowBet telle que le site l'attend dans placebetsport. */
export interface YbSelection {
  eventId: number | string;
  betTypeId: number | string;
  oddKey: string;
  betTypeName?: string;
  homeName?: string;
  awayName?: string;
  gameTime?: string | null;
  isLive?: boolean;
  oddName?: string;
  oddDisplayName?: string;
  price: number;
}

/**
 * Relit la cote fraîche d'une sélection (match + marché + issue) dans le flux
 * public. Renvoie aussi le statut d'événement pour détecter une suspension.
 */
export async function readYellowbetOdds(
  eventId: number | string,
  betTypeId: number | string,
  oddKey: string,
  apiKey = "",
  want: { line?: number | null; name?: string } = {},
): Promise<
  { ok: true; price: number; event: Record<string, any>; market: string; label: string; line: number | null }
  | { ok: false; code: string; reason: string }
> {
  // ⚠️ 18/09/2026 — CAUSE DES MISES QUI NE PARTENT PAS. Cette lecture portait
  // `betTypeIds=-1`, filtre qui ne renvoie que les 8 marchés « vedette » de
  // l'événement (FT 1X2, Under/Over, Double Chance, GG/NG, HT 1X2…) sur les
  // 121 réellement ouverts. Mesuré sur l'événement 372513884 : 8 marchés avec
  // le filtre, 121 sans, prix RIGOUREUSEMENT identiques sur les 8 communs.
  // Conséquence : toute sélection hors de ces 8 marchés (Both Team to Score,
  // Draw No Bet, clean sheet, corners, totaux d'une mi-temps…) était déclarée
  // « marché indisponible ou suspendu » alors qu'elle était ouverte et jouable
  // — d'où l'abandon systématique avant la pose, et les paris manuels qui,
  // eux, passaient sans problème. Le filtre est donc retiré : on lit le
  // catalogue complet de l'événement.
  const j = await ybReadJson(`${EV_BASE}/GetEvents?take=5&eventTypeId=0&skip=0&eventIds=${eventId}`, apiKey);
  const ev = (j?.data || []).find((e: any) => String(e.id) === String(eventId));
  if (!ev) return { ok: false, code: "event_not_found", reason: "YellowBet : match introuvable dans le flux (terminé ou retiré)" };
  const bt = (ev.bts || []).find((b: any) => String(b.id) === String(betTypeId));
  if (!bt) return { ok: false, code: "market_unavailable", reason: "YellowBet : marché indisponible ou suspendu à l'instant" };
  // ⚠️ IDENTIFICATION DE L'ISSUE — deux pièges relevés le 17/09/2026 :
  //   • la casse diffère entre le flux et le coupon (« Over » vs « over ») ;
  //   • une MÊME clé d'issue se répète sur toutes les lignes d'un marché de
  //     totaux (« o » pour +0.5, +1.5, +2.5…). Sans la ligne, on prenait la
  //     première trouvée : mauvaise ligne, donc mauvais pari.
  // On exige donc la ligne quand elle est connue, et on accepte le libellé
  // comme second critère de reconnaissance.
  const eq = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
  const lineOfOdd = (o: any) => [o?.l, o?.sbv, o?.sp, o?.hc].map((v: any) => parseFloat(v)).find((v: number) => Number.isFinite(v)) ?? null;
  const wantLine = Number.isFinite(want.line as number) ? Number(want.line) : null;
  const candidates = (bt.odds || []).filter((o: any) => eq(o.id, oddKey) || (want.name && (eq(o.n, want.name) || eq(o.dn, want.name))));
  const odd = wantLine == null
    ? candidates[0]
    : candidates.find((o: any) => lineOfOdd(o) === wantLine);
  const price = parseFloat(odd?.p);
  if (!odd || !Number.isFinite(price) || price <= 1) return { ok: false, code: "market_unavailable", reason: "YellowBet : issue indisponible ou suspendue à l'instant" };
  // Noms RÉELS lus dans le flux (jamais ceux mis en cache par le scanner) :
  // c'est ce qui permet au contrôle de conformité de vérifier que l'identifiant
  // désigne bien le marché et l'issue affichés. Sans eux, il était aveugle.
  return {
    ok: true, price, event: ev,
    market: String(bt.n || bt.name || bt.betTypeName || ""),
    label: String(odd.dn || odd.n || odd.name || oddKey),
    line: [odd.l, odd.sbv, bt.sbv, odd.b, bt.b].map((v: any) => parseFloat(v)).find((v: number) => Number.isFinite(v)) ?? null,
  };
}

/** Corps de placebetsport (format capturé et validé par le bookmarklet de réservation). */
export function ybBetBody(s: YbSelection, stake: number) {
  const key = `E${s.eventId}B${s.betTypeId}O${s.oddKey}`;
  const selection = {
    key, eventId: Number(s.eventId), eventStatus: 0, betStatus: 0, betTypeId: Number(s.betTypeId),
    betTypeName: s.betTypeName || "", homeName: s.homeName || "", awayName: s.awayName || "",
    gameTime: s.gameTime || null, isLive: !!s.isLive, isVirtual: false,
    oddKey: String(s.oddKey), oddName: s.oddName || String(s.oddKey), oddDisplayName: s.oddDisplayName || String(s.oddKey),
    oddPrice: Number(s.price), oldOddPrice: null, order: 1, hasTCO: true,
    sourceModule: "popular_event_carousel", source: "", sourceRef: "", totalStake: stake,
  };
  return {
    language: "fr", acceptOddsChanges: true, BetBuilderModel: { BetBuilderEvents: [] }, bonusIds: [],
    isBooking: false, rows: [{ amount: stake, selectionKeys: [key] }], selections: [selection], totalStake: stake,
  };
}

/**
 * Place un pari simple : connexion + pose dans la MÊME session de page (le
 * navigateur distant est neuf à chaque appel, la connexion doit donc être
 * rejouée). Un pari n'est confirmé que si le site renvoie un numéro.
 */
export async function placeYellowbetJina(userName: string, password: string, s: YbSelection, stake: number, apiKey: string): Promise<
  { success: true; ticketId: string; ticket: Record<string, any>; appliedOdds: number | null; balance: number | null }
  | { success: false; error: string; detail?: string; ticket?: Record<string, any> | null }
> {
  const run = await ybRun([
    {
      path: "/services/clapi/api/Authentication/LoginUser", method: "POST",
      body: { userName, password, phoneCountryCode: "+242", registrationType: 2, isPrePaid: false },
    },
    // 1) placebetsport ne fait que PRÉ-VALIDER le coupon : il renvoie un
    //    timeoutGuid (et un code-barres provisoire) sans rien débiter.
    { path: "/services/clapi/api/Bet/placebetsport", method: "POST", body: ybBetBody(s, stake), headers: { channelid: "1" }, useToken: true, tokenBodyField: "userToken" },
    // 2) executeorder CONFIRME l'ordre avec ce timeoutGuid : c'est lui qui
    //    débite le solde et renvoie le numéro de ticket (capturé en F12).
    //    ⚠️ DÉLAI LIVE — mesuré le 17/09/2026 : sur un match en cours,
    //    placebetsport renvoie `timeout: 8000` (ms). Confirmer avant la fin de
    //    ce délai est refusé net : « Live time delay not met » (NoPermission),
    //    ordre jamais exécuté, solde intact. C'était la cause des deux jambes
    //    YellowBet refusées de l'après-midi (1win resté seul engagé). Le relais
    //    attend donc ce délai avant de confirmer.
    //    ⚠️ 17/09/2026, 19h43 — le découvert s'est reproduit : l'attente lue
    //    dans la réponse (`delayFromPrev`) n'a PAS été appliquée par le relais,
    //    la confirmation est partie trop tôt et YellowBet a répondu « Live time
    //    delay not met » alors que 1win était déjà engagé (950 F nus).
    //    L'attente est donc désormais IMPOSÉE en dur sur toute sélection live
    //    (`delayMs`, seul mécanisme d'attente vérifié bout en bout côté relais),
    //    `delayFromPrev` ne servant plus qu'à allonger le délai si le site
    //    en demande davantage.
    { path: "/services/clapi/api/bet/executeorder", method: "POST", body: { acceptOddsChanges: true }, headers: { channelid: "1" }, useToken: true, fromPrev: { timeoutGuid: "timeoutGuid" }, skipIfPrevNull: "timeoutGuid", delayMs: s.isLive ? 9000 : 0, delayFromPrev: "timeout" },
    { path: KEEPALIVE_PATH, method: "POST", body: { parameters: {} }, useToken: true, retryIfNull: "userInfo.balance" },
  ], apiKey, "https://yellowbet.cg/fr/authentication/login");
  if (!run.success) return { success: false, error: run.error, detail: run.detail };

  const [lg, bet, exec, ka] = run.results;
  if (!lg?.json?.isSuccessfull) {
    const desc = lg?.json?.result?.errorDescription || "login_rejected";
    return { success: false, error: /mauvaise/i.test(String(desc)) ? "bad_credentials" : String(desc) };
  }
  const j = bet?.json;
  if (!j) return { success: false, error: "bet_unreadable", detail: (bet?.text || "").slice(0, 300) };
  // Refus MÉTIER (isBusinessLogicError) : le validateur YellowBet a dit non
  // AVANT toute écriture — la pré-validation ne débite jamais, et une
  // confirmation refusée n'exécute pas l'ordre (solde vérifié inchangé le
  // 17/09/2026 : 1 522 F avant et après « Bet type odd was not found »).
  // Le libellé le dit explicitement pour que le moteur classe ce refus comme
  // CERTAIN et lance la couverture, au lieu de le traiter comme ambigu.
  const refusal = (desc: string) => `YellowBet a refusé le pari (${desc}) — rien n'est engagé chez lui`;
  if (!j.placedSuccessfully || !j.timeoutGuid) {
    const desc = String(j?.result?.errorDescription || j?.errorDescription || j?.message || "bet_rejected");
    return { success: false, error: j?.result?.isBusinessLogicError || j?.isSuccessfull === false ? refusal(desc) : desc, ticket: j };
  }
  const x = exec?.json;
  if (!x) return { success: false, error: "confirm_unreadable", detail: (exec?.text || "").slice(0, 300), ticket: j };
  const num = x.orderNumber ?? x.transactionId ?? null;
  if (!x.isSuccessfull || !num) {
    const desc = String(x?.result?.errorDescription || x?.result?.errorCodeDescription || "confirm_rejected");
    return { success: false, error: x?.result?.isBusinessLogicError ? refusal(desc) : desc, ticket: x };
  }
  return {
    success: true, ticketId: String(num), ticket: { ...x, barcode: x.barcode ?? j.barcode },
    appliedOdds: Number(x.totalOdds) || null,
    balance: x.userInfo?.balance != null ? Number(x.userInfo.balance)
      : ka?.json?.userInfo?.balance != null ? Number(ka.json.userInfo.balance) : null,
  };
}

/**
 * Connexion YellowBet par identifiant + mot de passe, exécutée depuis le site.
 * La réponse de connexion porte déjà les infos du compte (userInfo) : un seul
 * aller-retour suffit pour valider la session et lire le solde.
 */
export async function loginYellowbetJina(
  userName: string,
  password: string,
  apiKey: string,
  phoneCountryCode = "+242",
): Promise<
  | { success: true; debug?: Record<string, any>; session: { token: string | null; account: { login: string; currency: string; balance: number | null; bonus: number } } }
  | { success: false; error: string; detail?: string }
> {
  // La connexion ne renvoie que le jeton : le solde se lit ensuite via
  // GetKeepAlive (capturé en F12), avec ce jeton en Authorization + Token.
  const run = await ybRun([
    {
      path: "/services/clapi/api/Authentication/LoginUser",
      method: "POST",
      body: { userName, password, phoneCountryCode, registrationType: 2, isPrePaid: false },
    },
    { path: KEEPALIVE_PATH, method: "POST", body: { parameters: {} }, useToken: true, retryIfNull: "userInfo.balance" },
  ], apiKey, "https://yellowbet.cg/fr/authentication/login");

  if (!run.success) return run;

  const [r, ka] = run.results;
  if (!r) return { success: false, error: "no_response" };
  const j = r.json;
  if (!j) return { success: false, error: "login_unreadable", detail: r.text.slice(0, 200) };

  if (!j.isSuccessfull) {
    const desc = j?.result?.errorDescription || j?.result?.errorCodeDescription || "login_rejected";
    // « Mauvaises références » = identifiant ou mot de passe erroné.
    return { success: false, error: /mauvaise/i.test(String(desc)) ? "bad_credentials" : String(desc) };
  }

  const info = ka?.json?.userInfo || j.userInfo || j.data?.userInfo || {};
  return {
    success: true,
    debug: info.balance == null ? { kaStatus: ka?.status, kaText: (ka?.text || "").slice(0, 300) } : undefined,
    session: {
      token: j.token || j.data?.token || null,
      account: {
        login: info.userName || info.login || info.phoneNumber || userName,
        currency: info.currency || "XAF",
        balance: info.balance != null ? Number(info.balance) : null,
        bonus: Number(info.bonus ?? 0),
      },
    },
  };
}