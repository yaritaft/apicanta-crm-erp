import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerPasos, simular } from '../src/simulado.js';

const carpeta = join(dirname(fileURLToPath(import.meta.url)), '..');
const ejemplo = join(carpeta, 'ejemplos', 'simulado.json');

function clienteFalso() {
  const c = { grupos: [], latidos: [] };
  c.enviarGrupo = async (cuerpo) => { c.grupos.push(cuerpo); return { ok: true, status: 200, respuesta: { nuevos: 1, miembros: 5 } }; };
  c.enviarLatido = async (cuerpo) => { c.latidos.push(cuerpo); return { ok: true, status: 200, respuesta: {} }; };
  return c;
}
const registroFalso = () => {
  const lineas = [];
  const f = (n) => (m) => lineas.push([n, String(m)]);
  return { log: { info: f('info'), warn: f('warn'), error: f('error'), debug: f('debug') }, lineas };
};

test('el ejemplo que viene en el repo es un JSON válido con los pasos que dice el README', () => {
  const pasos = leerPasos(ejemplo);
  assert.deepEqual(pasos.map((p) => p.tipo), ['latido', 'foto', 'foto', 'esperar', 'entro', 'salio', 'entro', 'latido']);
});

test('lo que no se puede leer, se explica', () => {
  assert.throws(() => leerPasos('/no/existe.json'), /no existe/);
  const dir = mkdtempSync(join(tmpdir(), 'lector-sim-'));
  try {
    writeFileSync(join(dir, 'roto.json'), '{ esto no');
    assert.throws(() => leerPasos(join(dir, 'roto.json')), /no es un JSON válido/);
    writeFileSync(join(dir, 'sin-pasos.json'), '{}');
    assert.throws(() => leerPasos(join(dir, 'sin-pasos.json')), /«pasos»/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('simula el ejemplo con los mismos cuerpos que el lector de verdad, y respeta GRUPOS_REGEX', async () => {
  const cliente = clienteFalso();
  const { log, lineas } = registroFalso();
  const r = await simular({ archivo: ejemplo, cliente, log, regex: /webinar|taller/i, ahora: () => new Date('2026-10-07T18:00:00Z'), pausar: async () => {} });

  assert.deepEqual(r, { enviados: 5, fallidos: 0, salteados: 2 }, 'el grupo VIP y el aviso de uno sin teléfono se saltean (y la espera no cuenta)');
  assert.deepEqual(cliente.latidos.map((l) => [l.conectado, l.grupos]), [[true, 1], [true, 1]]);

  const [foto, entro, salio] = cliente.grupos;
  assert.equal(foto.evento, 'foto');
  assert.deepEqual(foto.grupo, { id: '120363000000000001@g.us', nombre: 'Webinar 08/10 - Grupo 1' });
  assert.deepEqual(foto.participantes, [
    '5491155550001', '5491155550002', '5491155550003', '5491155550004', '5215512340005', '573001230006', '34612000007', '5491155550008',
  ]);
  assert.deepEqual([foto.total, foto.sinTelefono], [10, 2], 'los dos que vienen sólo con LID se cuentan aparte');
  assert.deepEqual([entro.evento, entro.participantes], ['entro', ['5491155550011', '5491155550012']]);
  assert.deepEqual([salio.evento, salio.participantes], ['salio', ['5491155550008']]);
  assert.equal(foto.en, '2026-10-07T18:00:00.000Z');

  for (const [, m] of lineas) assert.ok(!/\d{9,}/.test(m), `un registro lleva un teléfono: ${m}`);
  assert.ok(lineas.some(([, m]) => /GRUPOS_REGEX/.test(m)));
});

test('«haceMin» adelanta el pasado: sirve para ensayar avisos viejos', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lector-sim-'));
  try {
    const archivo = join(dir, 'viejo.json');
    writeFileSync(archivo, JSON.stringify({ pasos: [
      { tipo: 'foto', grupo: { id: 'g1@g.us', nombre: 'Taller' }, participantes: ['549110000001@s.whatsapp.net'], haceMin: 30 },
      { tipo: 'latido', conectado: false, haceMin: 5 },
      { tipo: 'loquesea' },
      { tipo: 'foto', participantes: [] },
    ] }));
    const cliente = clienteFalso();
    const r = await simular({ archivo, cliente, log: registroFalso().log, ahora: () => new Date('2026-10-07T18:00:00Z'), pausar: async () => {} });
    assert.equal(cliente.grupos[0].en, '2026-10-07T17:30:00.000Z');
    assert.equal(cliente.latidos[0].en, '2026-10-07T17:55:00.000Z');
    assert.equal(cliente.latidos[0].conectado, false);
    assert.deepEqual(r, { enviados: 2, fallidos: 2, salteados: 0 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- Por HTTP de verdad, con index.js ---------- */

function correr(args, env) {
  return new Promise((listo) => {
    const hijo = spawn(process.execPath, ['src/index.js', ...args], { cwd: carpeta, env: { PATH: process.env.PATH, ...env } });
    let salida = '';
    hijo.stdout.on('data', (d) => { salida += d; });
    hijo.stderr.on('data', (d) => { salida += d; });
    hijo.on('close', (codigo) => listo({ codigo, salida }));
  });
}

test('node src/index.js --simulado, contra un servidor de verdad: manda con el token y termina bien', async () => {
  const pedidos = [];
  const servidor = createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (d) => { cuerpo += d; });
    req.on('end', () => {
      pedidos.push({ url: req.url, auth: req.headers.authorization, json: JSON.parse(cuerpo) });
      res.setHeader('content-type', 'application/json');
      const autorizado = req.headers.authorization === 'Bearer token-de-prueba';
      res.statusCode = autorizado ? 200 : 401;
      res.end(JSON.stringify(autorizado ? { ok: true, nuevos: 1, miembros: 8 } : { error: 'No autorizado' }));
    });
  });
  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  const { port } = servidor.address();
  try {
    const r = await correr(['--simulado', 'ejemplos/simulado.json'], {
      APP_URL: `http://127.0.0.1:${port}`, WHATSAPP_LECTOR_TOKEN: 'token-de-prueba', GRUPOS_REGEX: 'webinar|taller',
    });
    assert.equal(r.codigo, 0, r.salida);
    assert.match(r.salida, /Modo simulado/);
    assert.match(r.salida, /Simulación terminada: 5 enviados, 0 fallidos, 2 salteados/);
    assert.ok(!/\d{9,}/.test(r.salida), 'la salida no lleva teléfonos');
    assert.deepEqual(pedidos.map((p) => p.url), [
      '/api/whatsapp/latido', '/api/whatsapp/grupos', '/api/whatsapp/grupos', '/api/whatsapp/grupos', '/api/whatsapp/latido',
    ]);
    assert.ok(pedidos.every((p) => p.auth === 'Bearer token-de-prueba'));
    assert.equal(pedidos.filter((p) => p.url === '/api/whatsapp/latido').length, 2);

    /* Con otro token, la app dice que no y el comando termina con error. */
    const mal = await correr(['--simulado', 'ejemplos/simulado.json'], {
      APP_URL: `http://127.0.0.1:${port}`, WHATSAPP_LECTOR_TOKEN: 'token-equivocado', GRUPOS_REGEX: 'webinar|taller',
    });
    assert.equal(mal.codigo, 1);
    assert.match(mal.salida, /WHATSAPP_LECTOR_TOKEN no es el mismo/);
  } finally { servidor.close(); }
});

test('sin configuración, el comando dice qué falta y no arranca', async () => {
  const r = await correr(['--simulado'], {});
  assert.equal(r.codigo, 2);
  assert.match(r.salida, /APP_URL/);
  assert.match(r.salida, /WHATSAPP_LECTOR_TOKEN/);
  assert.match(r.salida, /\.env\.example/);
});
