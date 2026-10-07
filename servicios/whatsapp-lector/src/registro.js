/* ==================================================================
   Los registros del lector: una línea por cosa, con la hora de Argentina, en
   castellano. Nunca se escribe un teléfono (ni en un mensaje de error): los
   que llaman no se lo pasan, y por las dudas acá se tapan los números largos.
   ================================================================== */

const ORDEN = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const ROTULO = { trace: 'TRACE', debug: 'DEBUG', info: 'INFO ', warn: 'AVISO', error: 'ERROR', fatal: 'FATAL' };

/* La hora de Argentina (UTC−3, sin horario de verano): «07/10 18:30:05». A mano,
   para que no dependa de la versión de Node ni de su tabla de idiomas. */
const dos = (n) => String(n).padStart(2, '0');
const hora = (fecha) => {
  const d = new Date(fecha.getTime() - 3 * 3_600_000);
  return `${dos(d.getUTCDate())}/${dos(d.getUTCMonth() + 1)} ${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}:${dos(d.getUTCSeconds())}`;
};

export function crearLogger(nivel = 'info', { salida = console, ahora = () => new Date() } = {}) {
  const minimo = nivel === 'silent' ? ORDEN.length : Math.max(0, ORDEN.indexOf(nivel));
  const emitir = (n) => (texto) => {
    if (ORDEN.indexOf(n) < minimo) return;
    const limpio = String(texto?.message ?? texto).replace(/\d{9,}/g, '…');
    const f = n === 'error' || n === 'fatal' ? salida.error : n === 'warn' ? salida.warn : salida.log;
    f.call(salida, `${hora(ahora())} ${ROTULO[n]} ${limpio}`);
  };
  return Object.fromEntries(ORDEN.map((n) => [n, emitir(n)]));
}
