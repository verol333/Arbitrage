// ═══════════════════════════════════════════════════════════════════
// La base refuse parfois une lecture/écriture pendant quelques secondes
// (« Rate limit exceeded ») quand les automatismes de l'application tournent en
// même temps. Sans réessai, l'action de l'utilisateur échoue pour rien.
// ═══════════════════════════════════════════════════════════════════

export async function dbRetry<T>(fn: () => Promise<T>, tries = 8): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (!/rate limit|429|indisponible|unavailable|timeout|50[234]/i.test((e as Error)?.message || String(e))) break;
      // Patience croissante + part d'aléatoire : plusieurs actions bloquées en
      // même temps ne repartent pas toutes à la même seconde.
      await new Promise((r) => setTimeout(r, 800 * (i + 1) + Math.random() * 400));
    }
  }
  throw last;
}