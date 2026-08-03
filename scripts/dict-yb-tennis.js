#!/usr/bin/env node
// Dict YellowBet tennis : dump bts sur match tennis reel (retry si sport=35 vide)
import { stealthGetJson } from '../src/net/stealth.js';

const HDR = { brandid: '122', channelid: '4', language: 'fr', terminal: 'yellowbet.cg' };

// Test sportId 35 + variantes autour + langue
for (const sid of [35, 33, 34, 36, 37, 40, 45, 47]) {
  for (const lang of ['fr', 'en']) {
    const list = await stealthGetJson(
      `https://yellowbet.cg/services/evapi/event/GetEvents?skip=0&take=3&sportId=${sid}&categoryTypeIds=all&langId=${lang}`,
      { headers: { ...HDR, language: lang }, timeoutMs: 15000 },
    );
    const events = list?.value?.events || list?.events || [];
    if (events.length > 0) {
      console.log(`\n═══ sportId=${sid} lang=${lang} : ${events.length} events ═══`);
      const ev = events[0];
      console.log(`Match : ${ev.h} vs ${ev.a} (${ev.ln || '?'})`);
      // Fetch bts detail
      const bts = await stealthGetJson(
        `https://yellowbet.cg/services/evapi/event/GetEventDetails?eventId=${ev.id}&langId=${lang}`,
        { headers: { ...HDR, language: lang }, timeoutMs: 15000 },
      );
      const arr = bts?.value?.bts || bts?.bts || [];
      console.log(`${arr.length} bts trouves :\n`);
      for (const bt of arr) {
        const outs = (bt.bs || []).map(b => `${b.n || '?'}(l=${b.l || ''})=${b.o || b.od || '?'}`).join(' | ');
        console.log(`  btId=${bt.id || '?'} name="${bt.n || '?'}" line=${bt.l || ''} → ${outs.slice(0, 250)}`);
      }
      process.exit(0);
    }
  }
}
console.log('Aucun sport tennis trouve chez YellowBet actuellement');
