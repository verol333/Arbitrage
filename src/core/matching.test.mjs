// Garde-fous du rapprochement d'equipes : familles de marqueurs (reserve /
// jeunes / feminines), repli des caracteres speciaux et non-regression sur les
// faux appariements qui ont coute de l'argent (senior vs jeunes, hommes vs
// femmes, clubs d'une meme ville).
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchBook } from './matching.js';
import { teamSim } from './text.js';

const T = Date.UTC(2026, 10, 14, 17, 0, 0);
const ref = (home, away) => ({ home, away, start: T, league: '' });
const cand = (id, home, away) => ({ id, home, away, start: T, league: '' });
const find = (r, c) => matchBook(r, [c], new Set());

test('reserve : II = B = Reserves = Jong', () => {
  assert.ok(find(ref('Karvina II', 'Slovacko II'), cand(1, 'Karvina B', 'Slovacko B')));
  assert.ok(find(ref('Sparta Rotterdam II', 'Almere City II'), cand(2, 'Jong Sparta Rotterdam', 'Jong Almere City')));
  assert.ok(find(ref('Dinamo Minsk II', 'SKA-1938'), cand(3, 'Dinamo Minsk Reserves', 'FC SKA-1938')));
});

test('reserve : jamais contre l equipe premiere', () => {
  assert.equal(find(ref('Karvina II', 'Slovacko II'), cand(4, 'Karvina', 'Slovacko')), null);
});

test('jeunes : U19 = Youth', () => {
  assert.ok(find(ref('Cordoba U19', 'Melilla U19'), cand(5, 'Cordoba Youth', 'Melilla Youth')));
  assert.equal(find(ref('Bulgaria U19', 'Latvia U19'), cand(6, 'Bulgaria', 'Latvia')), null);
});

test('feminines : (Women) = W = WGFC', () => {
  assert.ok(find(ref('Marcilio Dias (Women)', 'AJAP (Women)'), cand(7, 'Marcilio Dias W', 'Ajap W')));
  assert.ok(find(ref('Heart of Midlothian (Women)', 'Hibernian (Women)'), cand(8, 'Hearts WGFC', 'Hibernian W')));
  assert.equal(find(ref('Marcilio Dias (Women)', 'AJAP (Women)'), cand(9, 'Marcilio Dias', 'Ajap')), null);
});

test('abreviations pointees et caracteres nordiques', () => {
  assert.equal(teamSim('P.A.O.K.', 'PAOK'), 1);
  assert.ok(teamSim('Bronshoj', 'Brønshøj') >= 0.95);
  assert.ok(teamSim('Naesby', 'Næsby') >= 0.95);
});

test('non-regression : clubs differents restent separes', () => {
  assert.ok(teamSim('Manchester City', 'Manchester United') < 0.6);
  assert.ok(teamSim('Garforth Town', 'Hebburn Town') < 0.6);
  assert.equal(find(ref('Manchester City', 'Arsenal'), cand(10, 'Manchester United', 'Arsenal')), null);
});
