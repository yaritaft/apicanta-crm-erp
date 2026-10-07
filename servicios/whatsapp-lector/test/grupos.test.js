import test from 'node:test';
import assert from 'node:assert/strict';
import { elegirGrupos, esGrupoDeInteres } from '../src/grupos.js';

const todos = {
  '120363000000000001@g.us': { id: '120363000000000001@g.us', subject: 'Webinar 08/10 - Grupo 1', participants: [{ id: 'a' }] },
  '120363000000000002@g.us': { id: '120363000000000002@g.us', subject: 'Familia', participants: [] },
  '120363000000000003@g.us': { subject: 'TALLER 24/09', participants: [{ id: 'b' }, { id: 'c' }] },
  '5491155550001@s.whatsapp.net': { id: '5491155550001@s.whatsapp.net', subject: 'Webinar (no es un grupo)' },
  roto: null,
};

test('sin GRUPOS_REGEX entran todos los grupos (y sólo grupos)', () => {
  const g = elegirGrupos(todos, null);
  assert.deepEqual(g.map((x) => x.nombre), ['Webinar 08/10 - Grupo 1', 'Familia', 'TALLER 24/09']);
  assert.equal(g[2].id, '120363000000000003@g.us', 'sin id en los metadatos, vale la clave');
  assert.equal(g[2].participantes.length, 2);
});

test('con GRUPOS_REGEX, los que coinciden con el nombre, sin distinguir mayúsculas', () => {
  const g = elegirGrupos(todos, /webinar|taller/i);
  assert.deepEqual(g.map((x) => x.nombre), ['Webinar 08/10 - Grupo 1', 'TALLER 24/09']);
});

test('una regex con la bandera g no se acuerda de la vez anterior', () => {
  const re = /webinar/gi;
  assert.equal(esGrupoDeInteres('Webinar 1', re), true);
  assert.equal(esGrupoDeInteres('Webinar 1', re), true);
  assert.equal(esGrupoDeInteres('Otro', re), false);
  assert.equal(esGrupoDeInteres(undefined, re), false);
  assert.equal(esGrupoDeInteres(undefined, null), true);
});

test('lo que no es un diccionario no rompe', () => {
  assert.deepEqual(elegirGrupos(undefined, null), []);
  assert.deepEqual(elegirGrupos({}, /x/), []);
});
