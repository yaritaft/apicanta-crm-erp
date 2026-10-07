import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cargarEnvDeArchivo, esHostLocal, leerConfig, leerEnv, repeticionAnidada } from '../src/config.js';

const base = { APP_URL: 'https://apicanta.example.com/', WHATSAPP_LECTOR_TOKEN: 'secreto-de-prueba', GRUPOS_REGEX: 'taller online' };

test('con lo obligatorio, los valores por defecto', () => {
  const r = leerConfig(base);
  assert.ok(r.ok);
  assert.equal(r.config.appUrl, 'https://apicanta.example.com');
  assert.equal(r.config.token, 'secreto-de-prueba');
  assert.ok(r.config.gruposRegex.test('TALLER ONLINE 08/10/26 #1'), 'sin distinguir mayúsculas');
  assert.equal(r.config.gruposRegexTexto, 'taller online');
  assert.equal(r.config.authDir, './auth');
  assert.equal(r.config.latidoCadaMs, 120_000);
  assert.equal(r.config.fotoCadaMs, 6 * 3_600_000);
  assert.equal(r.config.logLevel, 'info');
  assert.equal(r.config.qrEnTerminal, false, 'el código QR no se dibuja en la terminal salvo que se pida');
});

test('el código QR en la terminal sólo con la bandera (QR_EN_TERMINAL=1, que pone --qr-terminal)', () => {
  for (const v of ['1', 'true', 'TRUE', 'si', 'sí', 'yes']) assert.equal(leerConfig({ ...base, QR_EN_TERMINAL: v }).config.qrEnTerminal, true, v);
  for (const v of ['', '0', 'no', 'false', 'nunca']) assert.equal(leerConfig({ ...base, QR_EN_TERMINAL: v }).config.qrEnTerminal, false, v);
});

test('falta lo obligatorio: dice qué', () => {
  const r = leerConfig({});
  assert.ok(!r.ok);
  assert.equal(r.errores.length, 3);
  assert.match(r.errores[0], /APP_URL/);
  assert.match(r.errores[1], /WHATSAPP_LECTOR_TOKEN/);
  assert.match(r.errores[2], /GRUPOS_REGEX/);
});

test('la dirección tiene que ser http(s)', () => {
  assert.ok(!leerConfig({ ...base, APP_URL: 'apicanta.example.com' }).ok);
  assert.ok(!leerConfig({ ...base, APP_URL: 'ftp://x.com' }).ok);
  assert.equal(leerConfig({ ...base, APP_URL: 'http://localhost:3024' }).config.appUrl, 'http://localhost:3024');
});

test('http:// sólo para esta misma compu: por la red, el secreto y el código QR viajarían a la vista', () => {
  for (const u of ['http://localhost:3024', 'http://127.0.0.1:3011', 'http://[::1]:3000', 'http://app.localhost:3000']) {
    assert.ok(leerConfig({ ...base, APP_URL: u }).ok, u);
  }
  for (const u of ['http://apicanta.example.com', 'http://203.0.113.9:3000', 'http://localhost.evil.com', 'http://127.0.0.1.evil.com']) {
    const r = leerConfig({ ...base, APP_URL: u });
    assert.ok(!r.ok, u);
    assert.match(r.errores[0], /https:\/\//, u);
  }
  assert.ok(leerConfig({ ...base, APP_URL: 'https://apicanta.example.com' }).ok);
  assert.equal(esHostLocal('localhost'), true);
  assert.equal(esHostLocal('.localhost'), false);
  assert.equal(esHostLocal(undefined), false);
});

test('GRUPOS_REGEX: se compila sin distinguir mayúsculas, y si está mal dice por qué', () => {
  const ok = leerConfig({ ...base, GRUPOS_REGEX: 'webinar|taller' });
  assert.ok(ok.config.gruposRegex.test('TALLER 24/09'));
  assert.equal(ok.config.gruposRegexTexto, 'webinar|taller');
  const mal = leerConfig({ ...base, GRUPOS_REGEX: '(abierto' });
  assert.ok(!mal.ok);
  assert.match(mal.errores[0], /GRUPOS_REGEX/);
});

test('GRUPOS_REGEX es obligatoria: «todos los grupos» se pide a propósito con .*', () => {
  for (const vacia of [undefined, '', '   ']) {
    const r = leerConfig({ ...base, GRUPOS_REGEX: vacia });
    assert.ok(!r.ok, `«${vacia}»`);
    assert.match(r.errores[0], /Falta GRUPOS_REGEX/);
    assert.match(r.errores[0], /GRUPOS_REGEX=\.\*/);
  }
  const todos = leerConfig({ ...base, GRUPOS_REGEX: '.*' });
  assert.ok(todos.ok);
  assert.ok(todos.config.gruposRegex.test('Familia'));
});

test('GRUPOS_REGEX con repeticiones dentro de repeticiones, o demasiado larga, se rechaza (un nombre de grupo armado la colgaría)', () => {
  for (const peligrosa of ['(.*taller.*)+online', '(a+)+', '(a*)*b', '((a+)b)*', '(\\w+\\s?)+$', '(x{1,}){2,}']) {
    const r = leerConfig({ ...base, GRUPOS_REGEX: peligrosa });
    assert.ok(!r.ok, peligrosa);
    assert.match(r.errores[0], /repetición dentro de otra/, peligrosa);
  }
  const larga = leerConfig({ ...base, GRUPOS_REGEX: 'a'.repeat(201) });
  assert.ok(!larga.ok);
  assert.match(larga.errores[0], /demasiado larga/);
});

test('repeticionAnidada: las expresiones normales pasan', () => {
  for (const normal of ['taller online', 'webinar|taller', '^Taller Online \\d{2}/\\d{2}/\\d{2} #\\d+$', '(taller|webinar)s?', '(a|b)+', '[+*]+', 'a\\(b\\)+', '(ab){2}', '(a+)?', '.*']) {
    assert.equal(repeticionAnidada(normal), false, normal);
  }
  assert.equal(repeticionAnidada('(.*)+'), true);
  assert.equal(repeticionAnidada('((a)+)+'), true, 'un grupo repetido dentro de un grupo que se repite');
});

test('los números tienen rango', () => {
  assert.ok(!leerConfig({ ...base, LATIDO_CADA_SEG: '3' }).ok);
  assert.ok(!leerConfig({ ...base, LATIDO_CADA_SEG: 'mucho' }).ok);
  assert.equal(leerConfig({ ...base, LATIDO_CADA_SEG: '30' }).config.latidoCadaMs, 30_000);
  assert.equal(leerConfig({ ...base, FOTO_CADA_HORAS: '0' }).config.fotoCadaMs, 0);
  assert.ok(!leerConfig({ ...base, FOTO_CADA_HORAS: '-1' }).ok);
  assert.ok(!leerConfig({ ...base, LOG_LEVEL: 'ruidoso' }).ok);
  assert.equal(leerConfig({ ...base, LOG_LEVEL: 'DEBUG' }).config.logLevel, 'debug');
});

test('el .env: comentarios, comillas, export, y no pisa lo que ya está definido', () => {
  const v = leerEnv('# hola\nAPP_URL=https://x.com   # la app\nexport A="con espacios"\nB=\'simple\'\n\nMALA LINEA\nC=\n');
  assert.deepEqual(v, { APP_URL: 'https://x.com', A: 'con espacios', B: 'simple', C: '' });

  const carpeta = mkdtempSync(join(tmpdir(), 'lector-env-'));
  try {
    const ruta = join(carpeta, '.env');
    writeFileSync(ruta, 'APP_URL=https://desde-el-archivo.com\nWHATSAPP_LECTOR_TOKEN=del-archivo\n');
    const env = { WHATSAPP_LECTOR_TOKEN: 'del-sistema' };
    assert.equal(cargarEnvDeArchivo(ruta, env), true);
    assert.equal(env.APP_URL, 'https://desde-el-archivo.com');
    assert.equal(env.WHATSAPP_LECTOR_TOKEN, 'del-sistema', 'lo del sistema gana');
    assert.equal(cargarEnvDeArchivo(join(carpeta, 'no-existe'), {}), false);
  } finally { rmSync(carpeta, { recursive: true, force: true }); }
});
