import test from 'node:test';
import assert from 'node:assert/strict';
import { cuerpoAviso, cuerpoFoto, cuerpoLatido, ESTADOS, eventoDeAccion } from '../src/cuerpos.js';

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

test('el latido: cómo está con WhatsApp y los grupos que vigila', () => {
  assert.deepEqual(cuerpoLatido({ estado: 'conectado', grupos: 3 }, { ahora }), { en: '2026-10-07T18:30:00.000Z', conectado: true, estado: 'conectado', grupos: 3 });
  assert.deepEqual(cuerpoLatido({ estado: 'reconectando', grupos: '2.7' }, { ahora }), { en: '2026-10-07T18:30:00.000Z', conectado: false, estado: 'reconectando', grupos: 2 });
  assert.equal(cuerpoLatido({ estado: 'cerrado', grupos: -4 }, { ahora }).grupos, 0);
  assert.equal(cuerpoLatido({ estado: 'conectado' }, { ahora }).grupos, 0);
  /* Un estado que no existe no se manda: se dice que está reconectando. */
  assert.equal(cuerpoLatido({ estado: 'dormido', grupos: 1 }, { ahora }).estado, 'reconectando');
  assert.deepEqual(ESTADOS, ['conectado', 'esperando_qr', 'reconectando', 'cerrado']);
});

test('el código QR va en el latido sólo cuando espera que lo vinculen', () => {
  const imagen = 'data:image/svg+xml;base64,PHN2Zy8+';
  const esperando = cuerpoLatido({ estado: 'esperando_qr', grupos: 0, qr: imagen }, { ahora });
  assert.deepEqual(esperando, { en: '2026-10-07T18:30:00.000Z', conectado: false, estado: 'esperando_qr', grupos: 0, qr: imagen });
  assert.equal('qr' in cuerpoLatido({ estado: 'esperando_qr', grupos: 0 }, { ahora }), false, 'sin imagen no hay campo');
  for (const estado of ['conectado', 'reconectando', 'cerrado']) {
    assert.equal('qr' in cuerpoLatido({ estado, grupos: 0, qr: imagen }, { ahora }), false, `con «${estado}» el código no viaja`);
  }
  assert.equal('qr' in cuerpoLatido({ estado: 'esperando_qr', qr: 42 }, { ahora }), false);
});
