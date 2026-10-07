import test from 'node:test';
import assert from 'node:assert/strict';
import { cuerpoAviso, cuerpoFoto, cuerpoLatido, eventoDeAccion } from '../src/cuerpos.js';

const ahora = new Date('2026-10-07T18:30:00.000Z');
const grupo = { id: '120363000000000001@g.us', nombre: 'Webinar 08/10' };

test('la foto trae los teléfonos, el total y los que no tienen teléfono', () => {
  const c = cuerpoFoto(grupo, [
    '5491155550001@s.whatsapp.net', { id: '1@lid', phoneNumber: '5491155550002@s.whatsapp.net' }, { id: '2@lid' }, { id: '3@lid' },
  ], { ahora });
  assert.deepEqual(c, {
    grupo: { id: grupo.id, nombre: 'Webinar 08/10' }, evento: 'foto', participantes: ['5491155550001', '5491155550002'],
    total: 4, sinTelefono: 2, en: '2026-10-07T18:30:00.000Z',
  });
});

test('un aviso trae sólo los teléfonos; sin ninguno no hay aviso', () => {
  const c = cuerpoAviso('entro', grupo, ['5491155550001@s.whatsapp.net', '9@lid'], { ahora });
  assert.deepEqual(c, { grupo: { id: grupo.id, nombre: 'Webinar 08/10' }, evento: 'entro', participantes: ['5491155550001'], en: '2026-10-07T18:30:00.000Z' });
  assert.equal(cuerpoAviso('salio', grupo, ['9@lid'], { ahora }), null);
  assert.equal(cuerpoAviso('salio', grupo, [], { ahora }), null);
});

test('las acciones de Baileys: add es entró, remove es salió, el resto no es nada', () => {
  assert.equal(eventoDeAccion('add'), 'entro');
  assert.equal(eventoDeAccion('remove'), 'salio');
  for (const x of ['promote', 'demote', 'modify', undefined, '']) assert.equal(eventoDeAccion(x), null);
});

test('el latido: conectado sí o no, y los grupos que vigila', () => {
  assert.deepEqual(cuerpoLatido({ conectado: true, grupos: 3 }, { ahora }), { en: '2026-10-07T18:30:00.000Z', conectado: true, grupos: 3 });
  assert.deepEqual(cuerpoLatido({ conectado: 0, grupos: '2.7' }, { ahora }), { en: '2026-10-07T18:30:00.000Z', conectado: false, grupos: 2 });
  assert.deepEqual(cuerpoLatido({ conectado: true, grupos: -4 }, { ahora }).grupos, 0);
  assert.deepEqual(cuerpoLatido({ conectado: true }, { ahora }).grupos, 0);
});
