import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aprenderLids, esLid, lidsSinResolver, normalizarParticipantes, telefonoDeId, telefonoDeParticipante,
} from '../src/participantes.js';

test('el teléfono de un id de persona, con o sin número de dispositivo', () => {
  assert.equal(telefonoDeId('5491155550001@s.whatsapp.net'), '5491155550001');
  assert.equal(telefonoDeId('5491155550001:12@s.whatsapp.net'), '5491155550001');
  assert.equal(telefonoDeId('5491155550001@c.us'), '5491155550001');
  assert.equal(telefonoDeId('+54 9 11 5555-0001'), null, 'con espacios y guiones no es un id: eso lo entiende la app');
  assert.equal(telefonoDeId('5491155550001'), '5491155550001');
  assert.equal(telefonoDeId('+5491155550001'), '5491155550001');
  assert.equal(telefonoDeId('100000000000001@lid'), null, 'el LID no es un teléfono');
  assert.equal(telefonoDeId('120363000000000001@g.us'), null, 'ni un grupo');
  assert.equal(telefonoDeId('12345'), null);
  assert.equal(telefonoDeId(undefined), null);
  assert.equal(telefonoDeId(42), null);
});

test('esLid', () => {
  assert.equal(esLid('100000000000001@lid'), true);
  assert.equal(esLid('5491155550001@s.whatsapp.net'), false);
  assert.equal(esLid(null), false);
});

test('Baileys 6.7: participantes como texto (teléfono o LID)', () => {
  const r = normalizarParticipantes(['5491155550001@s.whatsapp.net', '100000000000002@lid', '5491155550003@s.whatsapp.net']);
  assert.deepEqual(r.telefonos, ['5491155550001', '5491155550003']);
  assert.equal(r.total, 3);
  assert.equal(r.sinTelefono, 1);
});

test('Baileys 7: objetos con id, lid y phoneNumber, en grupos por teléfono y por LID', () => {
  const r = normalizarParticipantes([
    { id: '5491155550001@s.whatsapp.net', lid: '100000000000001@lid', admin: 'admin' },
    { id: '100000000000002@lid', phoneNumber: '5491155550002@s.whatsapp.net', admin: null },
    { id: '100000000000003@lid' },
    { id: '5491155550004@s.whatsapp.net', jid: '5491155550004@s.whatsapp.net' },
    { id: '100000000000005@lid', jid: '5491155550005@s.whatsapp.net' },
    { id: '100000000000006@lid', username: 'alguien' },
  ]);
  assert.deepEqual(r.telefonos, ['5491155550001', '5491155550002', '5491155550004', '5491155550005']);
  assert.equal(r.total, 6);
  assert.equal(r.sinTelefono, 2, 'los dos que WhatsApp muestra sin teléfono se cuentan aparte');
});

test('un LID se resuelve con lo que ya se aprendió', () => {
  const mapa = aprenderLids([{ id: '100000000000002@lid', phoneNumber: '5491155550002@s.whatsapp.net' }, { id: 'x@s.whatsapp.net' }], new Map());
  assert.equal(mapa.get('100000000000002@lid'), '5491155550002@s.whatsapp.net');
  assert.equal(telefonoDeParticipante('100000000000002@lid', mapa), '5491155550002');
  assert.equal(telefonoDeParticipante({ id: '100000000000002@lid' }, mapa), '5491155550002');
  assert.equal(telefonoDeParticipante({ id: '100000000000099@lid' }, mapa), null);
  const r = normalizarParticipantes(['100000000000002@lid', '100000000000099@lid'], mapa);
  assert.deepEqual(r.telefonos, ['5491155550002']);
  assert.equal(r.sinTelefono, 1);
});

test('qué LID faltan resolver', () => {
  const mapa = new Map([['100000000000002@lid', '5491155550002@s.whatsapp.net']]);
  const faltan = lidsSinResolver([
    '100000000000002@lid', '100000000000003@lid', { id: '100000000000004@lid' }, { id: '5491155550005@s.whatsapp.net', lid: '100000000000005@lid' },
    { id: 'x', lid: '100000000000006@lid' },
  ], mapa);
  assert.deepEqual(faltan.sort(), ['100000000000003@lid', '100000000000004@lid', '100000000000006@lid']);
});

test('sin repetir: el mismo participante en dos formas cuenta una vez; lo raro no rompe', () => {
  const r = normalizarParticipantes([
    '5491155550001@s.whatsapp.net', '5491155550001@s.whatsapp.net', { id: '5491155550001@s.whatsapp.net' }, null, undefined, 7, '', {},
  ]);
  assert.deepEqual(r.telefonos, ['5491155550001']);
  assert.equal(r.total, 1);
  assert.deepEqual(normalizarParticipantes(undefined), { telefonos: [], total: 0, sinTelefono: 0 });
  assert.deepEqual(normalizarParticipantes('hola'), { telefonos: [], total: 0, sinTelefono: 0 });
});
