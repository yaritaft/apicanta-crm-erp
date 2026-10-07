import test from 'node:test';
import assert from 'node:assert/strict';
import { cargarGeneradorQr, imagenDeMentira } from '../src/qr.js';

/* Lo mismo que valida la app (src/lib/whatsapp.ts): una imagen en data URL, de pocos KB. */
const IMAGEN = /^data:image\/(?:svg\+xml|png);base64,[A-Za-z0-9+/]+={0,2}$/;
const decodificar = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64').toString('utf8');

test('con la librería «qrcode», el código sale como un SVG en data URL', async () => {
  const pedidos = [];
  const falsa = { toString: async (texto, opciones) => { pedidos.push([texto, opciones]); return `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1H0z"/><!-- ${texto.length} --></svg>`; } };
  const generar = await cargarGeneradorQr({ importar: async () => ({ default: falsa }) });
  const imagen = await generar('2@abc,def,ghi,1');
  assert.match(imagen, IMAGEN);
  assert.ok(decodificar(imagen).startsWith('<svg'));
  assert.deepEqual(pedidos[0], ['2@abc,def,ghi,1', { type: 'svg', errorCorrectionLevel: 'L', margin: 4 }]);
  /* También anda con un módulo sin «default» (CommonJS visto desde ESM). */
  const g2 = await cargarGeneradorQr({ importar: async () => falsa });
  assert.match(await g2('x'), IMAGEN);
});

test('sin la librería, o con una que no sirve, no hay generador (y el lector real avisa que falta npm install)', async () => {
  assert.equal(await cargarGeneradorQr({ importar: async () => { throw Object.assign(new Error('no está'), { code: 'ERR_MODULE_NOT_FOUND' }); } }), null);
  assert.equal(await cargarGeneradorQr({ importar: async () => ({ default: {} }) }), null);
});

test('el dibujo de prueba parece un código pero lo dice, cambia con el texto y es una imagen válida para la app', () => {
  const a = imagenDeMentira('2@PRUEBA-UNO');
  const b = imagenDeMentira('2@PRUEBA-DOS');
  assert.match(a, IMAGEN);
  assert.notEqual(a, b, 'otro código, otro dibujo');
  assert.equal(imagenDeMentira('2@PRUEBA-UNO'), a, 'el mismo texto da el mismo dibujo');
  const svg = decodificar(a);
  assert.match(svg, /QR DE PRUEBA/);
  assert.ok(a.length < 20_000, 'chico');
  /* No lleva nada que se ejecute. */
  assert.ok(!/<script|onload|javascript:/i.test(svg));
});
