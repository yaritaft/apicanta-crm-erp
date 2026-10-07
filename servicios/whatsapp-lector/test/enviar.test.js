import test from 'node:test';
import assert from 'node:assert/strict';
import { crearCliente } from '../src/enviar.js';

const registro = () => {
  const lineas = [];
  const f = (nivel) => (m) => lineas.push([nivel, String(m)]);
  return { log: { info: f('info'), warn: f('warn'), error: f('error'), debug: f('debug') }, lineas };
};
const respuesta = (status, cuerpo) => new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), { status });
const sinEspera = () => Promise.resolve();

test('manda el JSON con el secreto en «Authorization: Bearer» a la ruta de cada cosa', async () => {
  const llamadas = [];
  const fetch = async (url, init) => { llamadas.push({ url, init }); return respuesta(200, { ok: true, nuevos: 2 }); };
  const { log } = registro();
  const c = crearCliente({ appUrl: 'https://app.example.com', token: 'tok-de-prueba', log, fetch, esperar: sinEspera });

  const g = await c.enviarGrupo({ grupo: { id: 'x@g.us' }, evento: 'foto', participantes: ['5491155550001'] });
  assert.deepEqual([g.ok, g.status, g.respuesta.nuevos], [true, 200, 2]);
  assert.equal(llamadas[0].url, 'https://app.example.com/api/whatsapp/grupos');
  assert.equal(llamadas[0].init.method, 'POST');
  assert.equal(llamadas[0].init.headers.authorization, 'Bearer tok-de-prueba');
  assert.equal(llamadas[0].init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(llamadas[0].init.body).participantes, ['5491155550001']);

  await c.enviarLatido({ en: 'x', conectado: true, grupos: 1 });
  assert.equal(llamadas[1].url, 'https://app.example.com/api/whatsapp/latido');
});

test('un 5xx o una caída de la red se reintenta, y al final se rinde sin tirar un error', async () => {
  let n = 0;
  const esperas = [];
  const fetch = async () => { n++; return respuesta(503, { error: 'Falta la base.' }); };
  const { log, lineas } = registro();
  const c = crearCliente({ appUrl: 'https://a.com', token: 't', log, fetch, intentos: 3, esperar: async (ms) => { esperas.push(ms); }, azar: () => 0.5 });
  const r = await c.enviarLatido({});
  assert.equal(n, 3);
  assert.deepEqual([r.ok, r.status, r.reintentable, r.error], [false, 503, true, 'Falta la base.']);
  assert.deepEqual(esperas, [1000, 2000], 'espera creciente entre intentos');
  assert.equal(lineas.filter(([n]) => n === 'warn').length, 1);

  let k = 0;
  const caida = crearCliente({ appUrl: 'https://a.com', token: 't', log, esperar: sinEspera, fetch: async () => { k++; throw new TypeError('fetch failed'); } });
  const r2 = await caida.enviarGrupo({});
  assert.equal(k, 3);
  assert.deepEqual([r2.ok, r2.status, r2.error], [false, 0, 'No se pudo conectar con la app.']);
});

test('lo que se renueva solo (el latido con el código QR) no se reintenta: uno tardío pisaría al nuevo', async () => {
  let n = 0;
  const fetch = async () => { n++; return respuesta(503, { error: 'caída' }); };
  const c = crearCliente({ appUrl: 'https://a.com', token: 't', log: registro().log, fetch, esperar: sinEspera });
  const r = await c.enviarLatido({ estado: 'esperando_qr' }, { sinReintentos: true });
  assert.deepEqual([n, r.ok, r.status], [1, false, 503]);
  /* Sin la opción, sí. */
  n = 0;
  await c.enviarLatido({ estado: 'conectado' });
  assert.equal(n, 3);
});

test('se recupera si el segundo intento anda', async () => {
  let n = 0;
  const fetch = async () => (++n < 2 ? respuesta(502, 'Bad Gateway') : respuesta(200, { ok: true }));
  const c = crearCliente({ appUrl: 'https://a.com', token: 't', log: registro().log, fetch, esperar: sinEspera });
  const r = await c.enviarGrupo({});
  assert.deepEqual([r.ok, n], [true, 2]);
});

test('un 4xx no se reintenta: un token equivocado no va a mejorar solo', async () => {
  let n = 0;
  const fetch = async () => { n++; return respuesta(401, { error: 'No autorizado' }); };
  const { log, lineas } = registro();
  const r = await crearCliente({ appUrl: 'https://a.com', token: 't', log, fetch, esperar: sinEspera }).enviarGrupo({});
  assert.equal(n, 1);
  assert.deepEqual([r.ok, r.status, r.reintentable], [false, 401, false]);
  assert.ok(lineas.some(([nivel, m]) => nivel === 'error' && /WHATSAPP_LECTOR_TOKEN/.test(m)), 'dice cuál es el problema');

  const mal = await crearCliente({ appUrl: 'https://a.com', token: 't', log, fetch: async () => respuesta(400, { error: 'Falta «grupo».' }), esperar: sinEspera }).enviarGrupo({});
  assert.deepEqual([mal.status, mal.error], [400, 'Falta «grupo».']);
  /* 429 sí se reintenta. */
  let m = 0;
  await crearCliente({ appUrl: 'https://a.com', token: 't', log, fetch: async () => { m++; return respuesta(429, '{}'); }, esperar: sinEspera }).enviarGrupo({});
  assert.equal(m, 3);
});

test('si la app no contesta a tiempo, se corta', async () => {
  const fetch = (url, init) => new Promise((_, rechazar) => {
    init.signal.addEventListener('abort', () => rechazar(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const c = crearCliente({ appUrl: 'https://a.com', token: 't', log: registro().log, fetch, timeoutMs: 20, intentos: 1 });
  const r = await c.enviarLatido({});
  assert.deepEqual([r.ok, r.error], [false, 'La app no contestó a tiempo.']);
});

test('el aviso de la app (reloj desfasado) se muestra; los teléfonos nunca van a los registros', async () => {
  const { log, lineas } = registro();
  const fetch = async () => respuesta(200, { ok: true, aviso: 'La hora del lector difiere 130 minutos de la de la app.' });
  await crearCliente({ appUrl: 'https://a.com', token: 'tok-secreto', log, fetch, esperar: sinEspera })
    .enviarGrupo({ grupo: { id: 'x@g.us' }, participantes: ['5491155550001'] });
  assert.ok(lineas.some(([n, m]) => n === 'warn' && /130 minutos/.test(m)));
  for (const [, m] of lineas) {
    assert.ok(!m.includes('5491155550001'), 'ni el teléfono');
    assert.ok(!m.includes('tok-secreto'), 'ni el token');
  }
});
