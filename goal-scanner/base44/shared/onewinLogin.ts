// ═══════════════════════════════════════════════════════════════════
// 1WIN — connexion par email/téléphone + mot de passe + captcha GeeTest v4.
//
// L'utilisateur résout le captcha directement sur notre UI (widget GeeTest
// v4 embarqué). On forward ensuite le login + password + captchaResponseV4
// à l'API 1Win. La session obtenue (cookie 1w_token) est valide 1 AN.
//
// À partir du cookie 1w_token + de l'ID user, on construit le jeton de pari
// top-parser : base64({ id, token }) — le même format que celui collé
// manuellement jusqu'ici.
//
// Flux capturé en F12 :
//   LOGIN    POST https://1win.com/api/web/v1/auth/login
//           body { login, password, captchaResponseV4, fingerprint }
//           → { id, email, phone, currency, ... } + Set-Cookie: 1w_token=…
//   BALANCE  GET  https://1win.com/api/USER-SERVICE-API/api-v1-balances-get-activated
//           cookie: session-id=…; 1w_token=…
//           → [{ currency: "XAF", balance: 12345 }, ...]
// ═══════════════════════════════════════════════════════════════════

import { pickOnewinWallet } from "./onewinWallet.ts";

const ONEWIN_LOGIN_URL = "https://1win.com/api/web/v1/auth/login";
const ONEWIN_BALANCE_URL = "https://1win.com/api/USER-SERVICE-API/api-v1-balances-get-activated";
const ONEWIN_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1";

// Empreinte statique capturée d'un vrai login 1Win (iPhone Safari PWA).
// Le blob `sealed` est chiffré côté client ; on réutilise l'empreinte complète
// pour garder tous les champs cohérents. Si 1Win commence à la refuser, il
// faudra reverse-engineerer la génération du `sealed`.
const STATIC_FINGERPRINT = {
  frontend_build_id: "0.3969.0",
  request_user_agent: ONEWIN_UA,
  canvas_fingerprint_hash: "4b2430108fcc20fe66a760d22ce1bdc39d1e8156321b002e25fb465995aa3961",
  webgl_renderer: "Apple GPU",
  platform: "web",
  languages: ["fr-FR"],
  web_driver: false,
  webgl_vendor: "Apple Inc.",
  vendor: "Apple Computer, Inc.",
  device_memory: null,
  hardware_concurrency: 4,
  screen_width: 430,
  screen_height: 932,
  screen_avail_width: 430,
  screen_avail_height: 932,
  color_depth: 24,
  pixel_depth: 24,
  user_agent_platform: null,
  max_touch_points: 5,
  cookie_enabled: true,
  java_enabled: false,
  connection_effective_type: null,
  connection_downlink: null,
  connection_rtt: null,
  local_storage_supported: true,
  session_storage_supported: true,
  indexed_db_supported: true,
  battery_charging: null,
  battery_charging_time: null,
  battery_discharging_time: null,
  battery_level: null,
  sealed: "noXc7R+hBXaR8hSL2RVuyaDW82Y4uB6IbJEV+dA41LacPseA936ExGxmcK+fD0/DbVI9qKjJ+cIJTrOwEATadO6fpqlbPZpYJiUGCNtyaJjpzh50hctBRLOfpB+nJ05EsMlPH0zzoYDw3hbFdNWud5w2f/qQQ+W34EWV57DyBqWkuIoSW0i/rFg2iKbNxw7GgSEgrziYRz6kMtM4N7CIufjxBooQPfOG8U2uRP/AzMbC4oHLFsOn1uFgZUIBWyPxc77IPd8GVRe+C+Ga2M+qQ2JRLkNtaFi5RfG29X1Fu34ulA4MfPPaBWVbpgj4SLJu8Bw0LUYs+SkZN4DTqTPwwPxirZQVXDG4yyd4Sh/TEP+tyYZmUyfwpfFzcim9I5NEuqRoUi1CVkBiwmBKC4TtPGliGw1Abn1Ef20PPHodFsDmCvGYxz0c3Al1ZuBf+JtUahblUyc5YbM8kAsIjETC7UTi02AGx0IRdiqcSH8EOTR9nZMd8sgoYPJvtCd+R3JSZQ//Rlnw5Gff7XzsslCm6f9ajuhRygtls/F3uZs0K6lN3CExpnThTXqhuvK7JbC/E4pxVi8FcR7sn96iKEp5cYfWALF/nYHhFMePoaEJe7F16dm0WjBj7p/7FYziFAheLYX8oLTAEMhvhv7Da0en5pESwWlXoimDBNkSiRU+M5W9LMoYx8BjQw7swK5Y/FCC93/O6mjGwg9rLhGsAlqKyApHL17nBeACL5JWL1aSKb2QELswuRp5i1FEdtWXi5dUusNYGZUULXotfDcIAe7MmwYYTMY18BrJmFaUjlPJcdN55t3tiyPQOjXoZ4QutlBJTpy7nga9BFdBvqMM73AhTMGWoU+viBkXI8pTpOYd8DGEaaD9A4I+3QfHb3sH2/b9gzm/sEbD71fuuAe5h+TvYTiyf3iuJcMxFvcgQdSYHQzHYmPK9gydeZzvzvH2rHUUg2v37ryLDk/UydQ70OqMSE01baWWx13oENYfF1ZYmJUAZPuiqZhLw5Rw==",
};

export interface OnewinCaptchaData {
  captcha_id: string;
  lot_number: string;
  pass_token: string;
  gen_time: string;
  captcha_output: string;
}

export interface OnewinLoginResult {
  success: boolean;
  session?: {
    sessionId: string;
    token: string;       // jeton de pari top-parser : base64({ id, token })
    account: {
      login: string;
      currency: string;
      balance: number | null;
    };
  };
  error?: string;
  status?: number;
  detail?: string;
}

export async function loginOnewinWithCaptcha(
  login: string,
  password: string,
  captcha?: OnewinCaptchaData | null,
): Promise<OnewinLoginResult> {
  // Si pas de captcha, on omet le champ (null est rejeté par 1Win comme Bad Request).
  const body: any = {
    login: login.trim(),
    password,
    fingerprint: STATIC_FINGERPRINT,
  };
  if (captcha) {
    body.captchaResponseV4 = captcha;
  }

  // ── LOG : ce qu'on envoie à 1Win (mot de passe masqué) ──
  const logBody = { ...body, password: "***", captchaResponseV4: captcha ? { ...captcha, captcha_output: captcha.captcha_output?.slice(0, 20) + "…" } : undefined };
  console.log("[1win] → POST /api/web/v1/auth/login", JSON.stringify(logBody));

  let res: Response;
  try {
    res = await fetch(ONEWIN_LOGIN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept": "*/*",
        "x-origin": "1win.com",
        "pwa": "pwa-ios",
        "origin": "https://1win.com",
        "referer": "https://1win.com/fr-CI",
        "user-agent": ONEWIN_UA,
        "accept-language": "fr-CI",
        "1w_lang": "fr",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return { success: false, error: "network_error", detail: (e as Error).message };
  }

  // Cloudflare challenge → HTML au lieu de JSON
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/html")) {
    console.log("[1win] ← Cloudflare (HTML), status:", res.status);
    return { success: false, error: "cloudflare_blocked", status: res.status, detail: "1Win a bloqué la requête (Cloudflare). Réessayez." };
  }

  const raw = await res.text();
  let data: any = null;
  try { data = JSON.parse(raw); } catch (_e) { data = null; }

  // ── LOG : ce que 1Win nous renvoie ──
  const _dbgCookies = res.headers.getSetCookie?.() || [];
  console.log("[1win] ← status:", res.status, "| body:", raw.slice(0, 500));
  console.log("[1win] ← set-cookie:", _dbgCookies.map((c: string) => c.slice(0, 60)).join(" | "));

  if (!res.ok || !data) {
    // Détecter les erreurs spécifiques 1Win (captcha requis/invalide, identifiants…)
    const errObj = data?.error && typeof data.error === "object" ? data.error : data;
    const code = String(errObj?.code || "");
    const msg = errObj?.message || (typeof data?.error === "string" ? data.error : "") || raw.slice(0, 300);
    const isCaptchaError = code.includes("captcha") || /captcha/i.test(String(msg));
    let error = "login_failed";
    if (isCaptchaError) {
      // Pas de captcha fourni → 1Win en réclame un ; captcha fourni mais invalide
      error = captcha ? "captcha_invalid" : "captcha_required";
    } else if (res.status === 401 || res.status === 403) {
      error = "login_failed";
    } else {
      error = "login_error";
    }
    return {
      success: false,
      error,
      status: res.status,
      detail: typeof msg === "string" ? msg : JSON.stringify(msg),
    };
  }

  // Pas de champ id → login échoué silencieusement
  if (!data?.id) {
    return { success: false, error: "login_failed", detail: raw.slice(0, 300) };
  }

  // Extraire les cookies de session (session-id et 1w_token ont la même valeur)
  const setCookies = res.headers.getSetCookie?.() || [];
  let sessionValue = "";
  for (const sc of setCookies) {
    const m = sc.match(/^([^=]+)=([^;]+)/);
    if (!m) continue;
    if (m[1] === "1w_token" || m[1] === "session-id") {
      if (!sessionValue) sessionValue = m[2];
    }
  }
  if (!sessionValue) {
    return { success: false, error: "no_session_cookie", detail: "Login réussi mais aucun cookie de session reçu" };
  }

  // Construire le jeton de pari top-parser : base64({ id, token })
  const betToken = btoa(JSON.stringify({ id: data.id, token: sessionValue }));

  // Lire le solde avec le cookie de session
  let balance: number | null = null;
  let currency = data.currency || "XAF";
  try {
    const balRes = await fetch(ONEWIN_BALANCE_URL, {
      method: "GET",
      headers: {
        "accept": "*/*",
        "referer": "https://1win.com/fr-CI/betting",
        "x-origin": "1win.com",
        "user-agent": ONEWIN_UA,
        "cookie": `session-id=${sessionValue}; 1w_token=${sessionValue}; 1w_lang=fr`,
      },
      signal: AbortSignal.timeout(15000),
    });
    if (balRes.ok) {
      const list = await balRes.json();
      if (Array.isArray(list) && list.length) {
        // Portefeuille retenu : voir shared/onewinWallet.ts — compte principal
        // en devise réelle, sinon le portefeuille réel le mieux approvisionné.
        const pick = pickOnewinWallet(list, data.currency) || list[0];
        balance = Number(pick.balance);
        currency = pick.currency || currency;
      }
    }
  } catch (_e) { /* solde optionnel */ }

  return {
    success: true,
    session: {
      sessionId: sessionValue,
      token: betToken,
      account: {
        login: data.email || data.phone || login.trim(),
        currency,
        balance,
      },
    },
  };
}