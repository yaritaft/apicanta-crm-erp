import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { soloLectura } from '../src/solo-lectura.js';

function socketFalso() {
  const llamadas = [];
  return {
    llamadas,
    ev: new EventEmitter(),
    signalRepository: { lidMapping: { getPNForLID: async (x) => `${x}-pn` } },
    async groupFetchAllParticipating() { llamadas.push('groupFetchAllParticipating'); return { a: 1 }; },
    async groupMetadata(id) { llamadas.push(`groupMetadata:${id}`); return { id }; },
    end() { llamadas.push('end'); },
    sendMessage() { llamadas.push('sendMessage'); },
    readMessages() { llamadas.push('readMessages'); },
    sendPresenceUpdate() { llamadas.push('sendPresenceUpdate'); },
    updateMediaMessage() {},
    groupParticipantsUpdate() { llamadas.push('groupParticipantsUpdate'); },
    logout() { llamadas.push('logout'); },
  };
}

test('deja pasar lo que hace falta para mirar', async () => {
  const s = socketFalso();
  const l = soloLectura(s);
  assert.deepEqual(await l.groupFetchAllParticipating(), { a: 1 });
  assert.deepEqual(await l.groupMetadata('x@g.us'), { id: 'x@g.us' });
  let visto = null;
  l.ev.on('algo', (x) => { visto = x; });
  s.ev.emit('algo', 5);
  assert.equal(visto, 5);
  assert.equal(await l.signalRepository.lidMapping.getPNForLID('1@lid'), '1@lid-pn');
  l.end();
  assert.deepEqual(s.llamadas, ['groupFetchAllParticipating', 'groupMetadata:x@g.us', 'end']);
});

test('mandar un mensaje, marcar como leído, cambiar la presencia, tocar un grupo o cerrar la sesión: error', () => {
  const s = socketFalso();
  const l = soloLectura(s);
  for (const metodo of ['sendMessage', 'readMessages', 'sendPresenceUpdate', 'groupParticipantsUpdate', 'logout', 'updateMediaMessage', 'cualquierOtro']) {
    assert.throws(() => l[metodo]('x'), /sólo lectura/, metodo);
  }
  assert.deepEqual(s.llamadas, [], 'nada llegó al socket de verdad');
  assert.throws(() => { l.ev = null; }, /sólo lectura/);
});

test('JavaScript puede mirar el envoltorio sin que explote (await, console.log)', async () => {
  const l = soloLectura(socketFalso());
  assert.equal(await Promise.resolve(l) === l, true);
  assert.doesNotThrow(() => String(Object.prototype.toString.call(l)));
});
