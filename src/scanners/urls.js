// Construit une URL de vérification vers la page du match sur chaque bookmaker
// pour permettre de contrôler la cote annoncée d'un simple clic.
// Certaines URLs sont approximatives (les sites re-slugifient) mais suffisent pour
// arriver sur la page du match ou de la ligue.

export function matchUrl(bookKey, m) {
  if (!m || !m.id) return null;
  switch (bookKey) {
    case '1xbet':
      return `https://1xbet.cg/en/line/football/-/-/${m.id}-`;
    case '1win':
      return `https://1win.pro/en/betting/event/${m.id}`;
    case 'congobet':
      return `https://congobet.cg/sports/football/event/${m.id}`;
    case 'yellowbet':
      return `https://yellowbet.cg/#/sports/prematch/event/${m.id}`;
    case 'apollo':
      return `https://apollo.games/en/sports/match/${m.id}`;
    case 'betmomo':
      return `https://betmomo.com/en/sportsbook/event/${m.id}`;
    case 'sportcash': {
      const [p, a] = String(m.id).split('_');
      return p && a ? `https://sportcash.ci/#!/event/${p}/${a}` : `https://sportcash.ci/`;
    }
    case 'premierbet':
      return `https://premierbetzone.com/sports/soccer/event/${m.id}`;
    case 'betpawa':
      return `https://cg.betpawa.com/events/${m.id}`;
    default:
      return null;
  }
}
