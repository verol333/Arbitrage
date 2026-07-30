// Constantes 1win (top-parser) — port fidèle de matchCore.ts.
export const PLATFORM = '44ba10e5-7df2-47ab-a44d-dc93803c7a6e';
export const API_BASE = 'https://api-gateway.top-parser.com';
export const ORIGIN = 'https://1win.ng';
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
// Sport IDs 1win (revalidés via probe enum 2026-07-30) :
//   18=Football (1000 matchs), 23=Basketball (Wellington Saints NZ, PBA),
//   24=Tennis (Dmytro Neborak, 260 matchs), 27=Volleyball (Italy/USA),
//   21=American Football (NFL), 22=Snooker/Darts (Kyren Wilson), 29=Baseball.
// ATTENTION : 12 et 4 ne renvoient plus rien, 19 = rugby (pas basket).
// Historique : WIN_SID legacy avait tennis=12 et basketball=19 → 0 matchs
// (probe montre 12=0, 4=0, 19=rugby). Corriges vers 24 et 23.
export const WIN_SID = { football: 18, tennis: 24, basketball: 23, hockey: 35, volleyball: 27 };
// Alt IDs si un sport se decoupe en plusieurs categories (rare).
export const WIN_SID_ALT = {};
