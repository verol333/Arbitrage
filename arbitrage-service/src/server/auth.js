// Middleware : header x-api-secret obligatoire (sauf /health).
import { config } from '../config.js';

export function requireApiSecret(req, res, next) {
  if (!config.apiSecretKey) return res.status(500).json({ error: 'API_SECRET_KEY non configuré' });
  const provided = req.header('x-api-secret') || req.query.api_secret;
  if (provided !== config.apiSecretKey) return res.status(403).json({ error: 'x-api-secret invalide' });
  return next();
}
