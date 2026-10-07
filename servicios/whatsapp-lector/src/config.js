import { existsSync, readFileSync } from 'node:fs';

/* ==================================================================
   La configuración del lector, de las variables de entorno.

   - APP_URL                 la dirección de Apicanta (obligatoria)
   - WHATSAPP_LECTOR_TOKEN   el secreto compartido con la app (obligatoria)
   - GRUPOS_REGEX            qué grupos mirar, por el nombre (vacía: todos)
   - AUTH_DIR                dónde se guarda la sesión (./auth)
   - LATIDO_CADA_SEG         cada cuánto avisa que sigue vivo (120)
   - FOTO_CADA_HORAS         cada cuánto manda la lista completa de cada grupo (6; 0: nunca)
   - LOG_LEVEL               trace, debug, info, warn o error (info)
   - QR_EN_TERMINAL          1: además de mandarlo a la app, muestra el código QR en la
                             terminal (para depurar; es lo mismo que --qr-terminal)
   ================================================================== */

/** Un «.env» simple: CLAVE=valor por renglón, con # para comentarios y comillas
    opcionales. Devuelve las claves; no toca process.env. */
export function leerEnv(texto) {
  const salida = {};
  for (const crudo of String(texto ?? '').split(/\r?\n/)) {
    const linea = crudo.trim();
    if (!linea || linea.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(linea);
    if (!m) continue;
    let valor = m[2].trim();
    if (/^(['"]).*\1$/.test(valor)) valor = valor.slice(1, -1);
    else valor = valor.replace(/\s+#.*$/, '');
    salida[m[1]] = valor;
  }
  return salida;
}

/** Suma a `env` lo que diga el archivo, sin pisar lo que ya esté definido
    (las variables del sistema, de pm2 o de systemd ganan). */
export function cargarEnvDeArchivo(ruta = '.env', env = process.env) {
  if (!existsSync(ruta)) return false;
  for (const [k, v] of Object.entries(leerEnv(readFileSync(ruta, 'utf8')))) {
    if (env[k] === undefined || env[k] === '') env[k] = v;
  }
  return true;
}

const NIVELES = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];

function numero(texto, porDefecto, { min, max }) {
  if (texto === undefined || texto === null || String(texto).trim() === '') return { valor: porDefecto };
  const n = Number(texto);
  if (!Number.isFinite(n) || n < min || n > max) return { error: `tiene que ser un número entre ${min} y ${max}` };
  return { valor: n };
}

/** Lee y valida la configuración. { ok: true, config } o { ok: false, errores }. */
export function leerConfig(env = process.env) {
  const errores = [];

  let appUrl = String(env.APP_URL ?? '').trim().replace(/\/+$/, '');
  if (!appUrl) errores.push('Falta APP_URL: la dirección de Apicanta (por ejemplo https://tu-apicanta.vercel.app).');
  else {
    try {
      const u = new URL(appUrl);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocolo');
      appUrl = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
    } catch {
      errores.push('APP_URL no es una dirección válida: tiene que empezar con https:// (o http:// para probar en tu compu).');
    }
  }

  const token = String(env.WHATSAPP_LECTOR_TOKEN ?? '').trim();
  if (!token) errores.push('Falta WHATSAPP_LECTOR_TOKEN: el secreto compartido con la app (el mismo valor que en Vercel).');

  let gruposRegex = null;
  const texto = String(env.GRUPOS_REGEX ?? '').trim();
  if (texto) {
    try { gruposRegex = new RegExp(texto, 'i'); }
    catch (e) { errores.push(`GRUPOS_REGEX no es una expresión regular válida (${e.message}).`); }
  }

  const latido = numero(env.LATIDO_CADA_SEG, 120, { min: 10, max: 600 });
  if (latido.error) errores.push(`LATIDO_CADA_SEG ${latido.error}.`);
  const foto = numero(env.FOTO_CADA_HORAS, 6, { min: 0, max: 168 });
  if (foto.error) errores.push(`FOTO_CADA_HORAS ${foto.error} (0: nunca).`);

  const nivel = String(env.LOG_LEVEL ?? 'info').trim().toLowerCase() || 'info';
  if (!NIVELES.includes(nivel)) errores.push(`LOG_LEVEL tiene que ser uno de: ${NIVELES.join(', ')}.`);

  if (errores.length) return { ok: false, errores };
  return {
    ok: true,
    config: {
      appUrl, token, gruposRegex,
      gruposRegexTexto: texto,
      authDir: String(env.AUTH_DIR ?? '').trim() || './auth',
      latidoCadaMs: latido.valor * 1000,
      fotoCadaMs: foto.valor * 3_600_000,
      logLevel: nivel,
      qrEnTerminal: /^(1|true|si|sí|yes)$/i.test(String(env.QR_EN_TERMINAL ?? '').trim()),
    },
  };
}
