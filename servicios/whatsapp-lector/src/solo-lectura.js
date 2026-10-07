/* ==================================================================
   Sólo lectura.

   El lector NUNCA manda un mensaje, ni marca nada como leído, ni cambia su
   presencia. Para que un cambio futuro no lo rompa sin querer, el lector
   no trabaja con el socket de Baileys: trabaja con ESTE envoltorio, que sólo
   deja pasar lo que hace falta para mirar. Cualquier otra cosa
   (sendMessage, readMessages, sendPresenceUpdate…) tira un error.
   ================================================================== */

const PERMITIDO = new Set([
  'ev',                         // los eventos
  'groupFetchAllParticipating', // los grupos y sus participantes
  'groupMetadata',              // un grupo
  'signalRepository',           // para averiguar el teléfono detrás de un LID
  'end',                        // cerrar la conexión
]);

export function soloLectura(sock) {
  return new Proxy(sock, {
    get(destino, propiedad, receptor) {
      /* Los símbolos y `then` los pide JavaScript solo (inspeccionar, await). */
      if (typeof propiedad === 'symbol' || propiedad === 'then') return undefined;
      if (!PERMITIDO.has(propiedad)) {
        throw new Error(`El lector es de sólo lectura: «${String(propiedad)}» no está permitido.`);
      }
      const valor = Reflect.get(destino, propiedad, receptor);
      return typeof valor === 'function' ? valor.bind(destino) : valor;
    },
    set() { throw new Error('El lector es de sólo lectura: no se puede cambiar el socket.'); },
  });
}
