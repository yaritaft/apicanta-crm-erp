import test from 'node:test';
import assert from 'node:assert/strict';
import { crearLogger, crearSalidaSinNumeros } from '../src/registro.js';

test('una línea por cosa, con la hora de Argentina y el nivel, y los números largos tapados', () => {
  const salida = { log: [], warn: [], error: [] };
  const consola = { log: (m) => salida.log.push(m), warn: (m) => salida.warn.push(m), error: (m) => salida.error.push(m) };
  const log = crearLogger('info', { salida: consola, ahora: () => new Date('2026-10-07T21:30:05.000Z') });
  log.info('Conectado');
  log.warn('Se cortó');
  log.error(new Error('falló con 5491155550001 y 123'));
  log.debug('esto no sale con nivel info');
  assert.equal(salida.log.length, 1);
  assert.match(salida.log[0], /^07\/10 18:30:05 INFO  Conectado$/);
  assert.match(salida.warn[0], /AVISO Se cortó$/);
  assert.match(salida.error[0], /ERROR falló con … y 123$/);
});

test('el nivel silent no dice nada; el debug dice todo', () => {
  const lineas = [];
  const consola = { log: (m) => lineas.push(m), warn: (m) => lineas.push(m), error: (m) => lineas.push(m) };
  const callado = crearLogger('silent', { salida: consola });
  callado.error('x');
  assert.equal(lineas.length, 0);
  const todo = crearLogger('debug', { salida: consola });
  todo.debug('a'); todo.info('b');
  assert.equal(lineas.length, 2);
});

test('lo que escribe Baileys pasa por un filtro que tapa los números largos (teléfonos e ids), pero no la hora ni los números cortos', () => {
  const escrito = [];
  const salida = crearSalidaSinNumeros({ write: (x) => escrito.push(x) });
  salida.write('{"level":40,"time":"2026-10-07T18:20:07.123Z","msg":"fallo con 5491155550001@s.whatsapp.net y 120363000000000001@g.us código 428"}\n');
  assert.equal(escrito.length, 1);
  assert.ok(!/\d{7,}/.test(escrito[0]), escrito[0]);
  assert.match(escrito[0], /"time":"2026-10-07T18:20:07\.123Z"/);
  assert.match(escrito[0], /…@s\.whatsapp\.net/);
  assert.match(escrito[0], /código 428/);
});
