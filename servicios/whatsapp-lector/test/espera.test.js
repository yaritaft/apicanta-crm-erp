import test from 'node:test';
import assert from 'node:assert/strict';
import { esperaCreciente } from '../src/espera.js';

test('la espera crece al doble en cada intento, hasta el tope', () => {
  const justo = () => 0.5;
  const esperas = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => esperaCreciente(n, { azar: justo }));
  assert.deepEqual(esperas, [2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 300000, 300000]);
});

test('con azar varía un poco, nunca pasa el tope ni baja de la mitad', () => {
  assert.equal(esperaCreciente(1, { azar: () => 0 }), 1600);
  assert.equal(esperaCreciente(1, { azar: () => 1 }), 2400);
  assert.equal(esperaCreciente(20, { azar: () => 1 }), 300000);
  for (let i = 0; i < 200; i++) {
    const e = esperaCreciente(3);
    assert.ok(e >= 6400 && e <= 9600);
  }
});

test('un intento raro cuenta como el primero', () => {
  for (const x of [0, -3, NaN, undefined, 'a']) assert.equal(esperaCreciente(x, { azar: () => 0.5 }), 2000);
});
