// Génère une clé API sécurisée pour le webhook.
// Usage : node scripts/generate-key.js
import crypto from 'crypto';

const key = 'arb_' + crypto.randomBytes(32).toString('hex');
console.log('\n🔑 Clé API webhook générée :\n');
console.log(`   ${key}\n`);
console.log('Ajoutez cette clé comme secret GitHub :');
console.log('  → Settings > Secrets and variables > Actions > New repository secret');
console.log('  → Nom : WEBHOOK_SECRET');
console.log(`  → Valeur : ${key}\n`);
console.log('Configurez la même clé dans votre application backend');
console.log('pour valider les requêtes entrantes (header X-Webhook-Secret).\n');
