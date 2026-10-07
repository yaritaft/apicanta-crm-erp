import { cargarEnvDeArchivo, leerConfig } from './config.js';
import { crearCliente } from './enviar.js';
import { crearLogger } from './registro.js';
import { simular } from './simulado.js';

/* ==================================================================
   Lector de WhatsApp para Apicanta.

     node src/index.js                       el lector de verdad (necesita el QR la primera vez)
     node src/index.js --simulado [archivo]  sin WhatsApp: manda lo que diga el archivo
                                             (por defecto ejemplos/simulado.json)

   Sólo lectura: ver README.md.
   ================================================================== */

const tapar = (e) => String(e?.message ?? e).replace(/\d{7,}/g, '…').slice(0, 300);

async function principal() {
  const args = process.argv.slice(2);
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
    try {
      const r = await simular({ archivo: archivoSimulado, cliente, log, regex: config.gruposRegex });
      process.exitCode = r.fallidos > 0 ? 1 : 0;
    } catch (e) {
      log.error(e.message);
      process.exitCode = 2;
    }
    return;
  }

  let baileys, qr, pino;
  try {
    baileys = await import('@whiskeysockets/baileys');
    qr = (await import('qrcode-terminal')).default;
    pino = (await import('pino')).default;
  } catch (e) {
    console.error(`Faltan las dependencias (${e.code ?? e.message}). Corré «npm install» en esta carpeta.`);
    process.exitCode = 2;
    return;
  }

  const { crearLector } = await import('./lector.js');
  const verboso = ['trace', 'debug'].includes(config.logLevel);
  const lector = crearLector({
    config, baileys, qr, log, cliente,
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
