// Envoie les alertes surebet vers une URL webhook (POST).
// WEBHOOK_URL + WEBHOOK_SECRET doivent être configurés dans les secrets GitHub.

export async function sendWebhook(payload) {
  const url = process.env.WEBHOOK_URL;
  const secret = process.env.WEBHOOK_SECRET;
  if (!url) return;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': secret || '',
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    console.log(`[webhook] ${res.status} — ${payload.count} opportunités envoyées`);
  } catch (e) {
    console.warn(`[webhook] erreur: ${e.message}`);
  } finally { clearTimeout(t); }
}

export async function notifyScan(result, { live = false } = {}) {
  if (!result.opportunities?.length) return;
  await sendWebhook({
    type: 'arbitrage_alert',
    scan_type: live ? 'live' : 'prematch',
    timestamp: new Date().toISOString(),
    count: result.opportunities.length,
    opportunities: result.opportunities,
    stats: result.stats,
  });
}
