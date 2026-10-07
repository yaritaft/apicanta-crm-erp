import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { carpetaVieja, moverSesionVieja } from '../src/sesion.js';

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
