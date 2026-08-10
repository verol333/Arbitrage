// Registre central des bookmakers. Ajouter un book = créer un dossier
// src/bookmakers/<nom>/index.js exportant l'interface commune et l'importer ici.
// Ordre = ordre de log (aucune dépendance métier).
import xbet from './xbet/index.js';
import onewin from './onewin/index.js';
import congobet from './congobet/index.js';
import yellowbet from './yellowbet/index.js';
import apollo from './apollo/index.js';
import betmomo from './betmomo/index.js';
import premierbet from './premierbet/index.js';
import betpawa from './betpawa/index.js';
import sportybet from './sportybet/index.js';
// casongo (Velisports/VeliGroup) : sportsbook rendu dans un iframe
// launcher.velisports.com qui génère un JWT guest côté serveur à chaque ouverture.
// Impossible d'obtenir ce JWT depuis un backend headless sans simuler l'iframe
// (Playwright). Module conservé dans src/bookmakers/casongo/ pour ré-activation
// future ; non branché ici car sans JWT chaque appel retourne 400 MALFORMED.

export const bookmakers = [xbet, onewin, congobet, yellowbet, apollo, betmomo, premierbet, betpawa, sportybet];
export const bookmakersByKey = Object.fromEntries(bookmakers.map((b) => [b.key, b]));

// Chaque bookmaker DOIT exporter cette forme :
//   {
//     key: string,               // identifiant unique interne
//     label: string,             // nom d'affichage (logs, UI)
//     supports: { prematch: bool, live: bool },
//     listMatches({ sport, live, horizonHours }) →
//       Promise<Array<{ id, home, away, league, start, __raw? }>>
//     getOdds(match, { sport, live }) → Promise<{ [marketKey]: odd }>
//     // Optionnel : lecture par lot pour les APIs batchables (1win WebSocket)
//     getOddsBatch?(matches, { sport, live }) → Promise<Map<id, { [marketKey]: odd }>>
//   }
