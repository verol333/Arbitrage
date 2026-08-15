// Constantes 1win (top-parser).
export const PLATFORM = '44ba10e5-7df2-47ab-a44d-dc93803c7a6e';
export const API_BASE = 'https://api-gateway.top-parser.com';
export const ORIGIN = 'https://1win.ng';
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
// Sport IDs 1win (validés via F12 utilisateur 2026-08-03 + 2026-08-10) :
//   18 = Football (LaLiga)
//   23 = Basketball (NBA + cybersport melangés — filtrer "(pseudo)" en list)
//   24 = Table Tennis (WTT Women, sets a 11 points — MAL cate "Tennis" par 1win)
//   33 = Tennis (ATP/WTA + cybertennis melangés — filtrer "(pseudo)" en list)
//   35 = Ice Hockey (NHL — Carolina, Florida, Toronto, Montreal — vraie glace)
// URL confirmee : 1win.ng/betting/live/tennis-33 (sportId 33), basketball-23,
// 1win.ng/betting/prematch/ice-hockey-35.
// Volleyball 1win : sid=27 (confirme via probe 2026-08-11 - matchs Volei Renata U19,
// Pan American Cup, USA vs Puerto Rico partages avec SportyBet/Congobet).
export const WIN_SID = { football: 18, tennis: 33, basket: 23, hockey: 35, volleyball: 27, table_tennis: 24 };
