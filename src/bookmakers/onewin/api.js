// Constantes 1win (top-parser) — port fidèle de matchCore.ts.
export const PLATFORM = '44ba10e5-7df2-47ab-a44d-dc93803c7a6e';
export const API_BASE = 'https://api-gateway.top-parser.com';
export const ORIGIN = 'https://1win.ng';
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
// Sport IDs 1win (validés via probe v3, sample d'équipes) :
//   18=Football (LaLiga Girona/Alaves), 12=Tennis (WIN_SID legacy — non confirmé récemment),
//   19=Basketball (VTB Saint Petersburg/CSKA), 23=Basketball alt (PBA),
//   27=Volleyball (Brazil(w)/Italy(w)), 35=Ice Hockey (HC Rysi Gomel/Belstal).
export const WIN_SID = { football: 18, tennis: 12, basketball: 19, hockey: 35, volleyball: 27 };
export const WIN_SID_ALT = { basketball: [19, 23] };
