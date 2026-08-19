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
  // Vague 1 (2026-08-19) : clean sheet, pair/impair par equipe, corners par equipe.
  'other|home|binary|FT', 'other|away|binary|FT',
  'other|home|binary|1H', 'other|away|binary|1H',
  'other|home|binary|2H', 'other|away|binary|2H',
  'other|home|two_way|FT', 'other|away|two_way|FT',
  'goals|home|odd_even|FT', 'goals|away|odd_even|FT',
  'corners|home|over_under|FT', 'corners|away|over_under|FT',
  'corners|home|over_under|1H', 'corners|away|over_under|1H',
]);

export const isNewFamily = (family) => !SUPPORTED_FAMILIES.has(family);
