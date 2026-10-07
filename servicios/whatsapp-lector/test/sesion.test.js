import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { carpetaVieja, moverSesionVieja, prepararCarpetaDeSesion } from '../src/sesion.js';

test('la sesión cerrada va a «auth.vieja», al lado', () => {
  assert.equal(carpetaVieja('./auth'), './auth.vieja');
  assert.equal(carpetaVieja('/opt/lector/auth/'), '/opt/lector/auth.vieja');
});

test('«auth» pasa a «auth.vieja» con sus archivos, y la que hubiera de antes se descarta', async () => {
  const raiz = mkdtempSync(join(tmpdir(), 'lector-sesion-'));
  try {
    const auth = join(raiz, 'auth');
    mkdirSync(auth);
    writeFileSync(join(auth, 'creds.json'), 'sesion-1');
    assert.equal(await moverSesionVieja(auth), `${auth}.vieja`);
    assert.equal(existsSync(auth), false);
    assert.equal(readFileSync(join(`${auth}.vieja`, 'creds.json'), 'utf8'), 'sesion-1');

    /* Otra vez: la de la vuelta anterior se pisa con la nueva. */
    mkdirSync(auth);
    writeFileSync(join(auth, 'creds.json'), 'sesion-2');
    await moverSesionVieja(auth);
    assert.equal(readFileSync(join(`${auth}.vieja`, 'creds.json'), 'utf8'), 'sesion-2');

    /* Sin carpeta que apartar no falla. */
    await moverSesionVieja(auth);
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});

test('la carpeta de la sesión se crea y queda sólo para su dueño (700), también si ya existía abierta, sin tocar lo de adentro', async (contexto) => {
  if (process.platform === 'win32') { contexto.skip('los modos de archivo no existen en Windows'); return; }
  const raiz = mkdtempSync(join(tmpdir(), 'lector-sesion-'));
  try {
    const nueva = join(raiz, 'no', 'existe', 'auth');
    await prepararCarpetaDeSesion(nueva);
    assert.equal(statSync(nueva).mode & 0o777, 0o700);

    const abierta = join(raiz, 'abierta');
    mkdirSync(abierta);
    chmodSync(abierta, 0o755);
    writeFileSync(join(abierta, 'creds.json'), 'llaves');
    await prepararCarpetaDeSesion(abierta);
    assert.equal(statSync(abierta).mode & 0o777, 0o700);
    assert.equal(readFileSync(join(abierta, 'creds.json'), 'utf8'), 'llaves');
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});
