import { cargarEnvDeArchivo, leerConfig } from './config.js';
import { crearCliente } from './enviar.js';
import { cargarGeneradorQr, imagenDeMentira } from './qr.js';
import { crearLogger } from './registro.js';
import { simular } from './simulado.js';

/* ==================================================================
   Lector de WhatsApp para Apicanta.

     node src/index.js                       el lector de verdad. Para vincular el número no hace falta la
                                             terminal: el código QR se manda a la app y se escanea desde
                                             Ajustes → WhatsApp
     node src/index.js --qr-terminal         lo mismo, y además dibuja el código QR en la terminal (depurar)
     node src/index.js --simulado [archivo]  sin WhatsApp: manda lo que diga el archivo
                                             (por defecto ejemplos/simulado.json)

   Sólo lectura: ver README.md.
   ================================================================== */

const tapar = (e) => String(e?.message ?? e).replace(/\d{7,}/g, '…').slice(0, 300);

async function principal() {
  const args = process.argv.slice(2);
  if (args.includes('--qr-terminal')) process.env.QR_EN_TERMINAL = '1';
  const i = args.indexOf('--simulado');
  const simulado = i !== -1;
  const archivoSimulado = simulado && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'ejemplos/simulado.json';

  cargarEnvDeArchivo('.env');
  const leida = leerConfig(process.env);
  if (!leida.ok) {
    console.error('El lector no puede arrancar:');
    for (const e of leida.errores) console.error(`  - ${e}`);
    console.error('Completá el archivo .env (hay un modelo en .env.example).');
    process.exitCode = 2;
    return;
  }
  const { config } = leida;
  const log = crearLogger(config.logLevel);
  const cliente = crearCliente({ appUrl: config.appUrl, token: config.token, log });

  if (simulado) {
    log.info(`Modo simulado: sin WhatsApp. Mando «${archivoSimulado}» a ${config.appUrl}.`);
    /* Sin el paquete «qrcode» (no hace falta para probar) el código es un dibujo de prueba. */
    let generarQr = await cargarGeneradorQr();
    if (!generarQr) {
      log.warn('Falta el paquete «qrcode» (corré «npm install»): el código QR del modo simulado es un dibujo de prueba.');
      generarQr = async (texto) => imagenDeMentira(texto);
    }
    try {
      const r = await simular({ archivo: archivoSimulado, cliente, log, regex: config.gruposRegex, generarQr });
      process.exitCode = r.fallidos > 0 ? 1 : 0;
    } catch (e) {
      log.error(e.message);
      process.exitCode = 2;
    }
    return;
  }

  let baileys, pino, imagenQr, terminalQr = null;
  try {
    baileys = await import('@whiskeysockets/baileys');
    pino = (await import('pino')).default;
    imagenQr = await cargarGeneradorQr();
    if (!imagenQr) throw Object.assign(new Error('qrcode'), { code: 'ERR_MODULE_NOT_FOUND' });
    /* El código en la terminal es sólo para depurar. */
    if (config.qrEnTerminal) terminalQr = (await import('qrcode-terminal')).default;
  } catch (e) {
    console.error(`Faltan las dependencias (${e.code ?? e.message}). Corré «npm install» en esta carpeta.`);
    process.exitCode = 2;
    return;
  }

  const { crearLector } = await import('./lector.js');
  const verboso = ['trace', 'debug'].includes(config.logLevel);
  const lector = crearLector({
    config, baileys, qr: { imagen: imagenQr, terminal: terminalQr }, log, cliente,
    /* Baileys habla mucho: sólo se oye si se pide LOG_LEVEL=debug o trace. */
    loggerBaileys: pino({ level: verboso ? config.logLevel : 'silent' }),
  });

  let cerrando = false;
  const cerrar = async (senal) => {
    if (cerrando) return;
    cerrando = true;
    log.info(`Cerrando (${senal})…`);
    await lector.detener().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void cerrar('SIGINT'));
  process.on('SIGTERM', () => void cerrar('SIGTERM'));
  process.on('unhandledRejection', (e) => log.error(`Error sin atajar: ${tapar(e)}`));
  process.on('uncaughtException', (e) => {
    log.error(`Error fatal: ${tapar(e)}`);
    process.exit(1);
  });

  log.info(`Lector de WhatsApp (sólo lectura) → ${config.appUrl}. Grupos: ${config.gruposRegexTexto || 'todos'}.`);
  await lector.iniciar();
}

await principal();
