// Familles de marchés DÉJÀ exploitées par le moteur d'arbitrage.
// Sert à ne remonter dans le rapport que les marchés RÉELLEMENT nouveaux.
// Clé = metric|entity|type|scope (sans la ligne).
export const SUPPORTED_FAMILIES = new Set([
  'goals|match|1x2|FT', 'goals|match|1x2|1H', 'goals|match|1x2|2H',
  'goals|match|dc|FT', 'goals|match|dc|1H', 'goals|match|dc|2H',
  'goals|match|dnb|FT',
  'goals|match|btts|FT', 'goals|both|btts|FT',
  'goals|match|over_under|FT', 'goals|match|over_under|1H', 'goals|match|over_under|2H',
  'goals|home|over_under|FT', 'goals|away|over_under|FT',
  'goals|match|handicap|FT', 'goals|match|odd_even|FT',
  'corners|match|over_under|FT', 'corners|match|over_under|1H',
  'corners|match|handicap|FT', 'corners|match|odd_even|FT',
  'cards_yellow|match|over_under|FT',
  'cards|match|over_under|FT',
]);

export const isNewFamily = (family) => !SUPPORTED_FAMILIES.has(family);
