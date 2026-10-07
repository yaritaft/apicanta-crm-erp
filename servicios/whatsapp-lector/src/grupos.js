/* ==================================================================
   Qué grupos mira el lector.

   Un número de WhatsApp está en muchos grupos (clientes, familia, trabajo).
   GRUPOS_REGEX dice cuáles interesan: se prueba contra el NOMBRE del grupo.
   (La configuración la exige: «todos» se pide a propósito con .*; acá, sin
   regex, entran todos sólo para las pruebas.)

   Ojo: el nombre de un grupo lo pone quien lo crea, y a este número lo puede
   agregar cualquiera a un grupo propio. La regex sola no prueba que sea un
   taller de verdad: la app sólo muestra lo que llega, y atar un grupo a un
   webinar lo decide una persona en Ajustes → WhatsApp.
   ================================================================== */

/** ¿Interesa un grupo con ese nombre? Sin regex, todos. */
export function esGrupoDeInteres(nombre, regex) {
  if (!regex) return true;
  /* Una regex con la bandera «g» o «y» recuerda dónde quedó: se reinicia. */
  regex.lastIndex = 0;
  /* WhatsApp deja hasta 100 letras; se prueba hasta 200 por si cambia. */
  return regex.test(String(nombre ?? '').slice(0, 200));
}

/** De lo que devuelve `groupFetchAllParticipating()` ({ [id]: metadatos }), los
    grupos que interesan: { id, nombre, participantes }. Sólo grupos de verdad
    (el id termina en @g.us), no comunidades enteras ni listas de difusión. */
export function elegirGrupos(porId, regex) {
  const salida = [];
  for (const [clave, meta] of Object.entries(porId ?? {})) {
    if (!meta || typeof meta !== 'object') continue;
    const id = String(meta.id ?? clave);
    if (!id.endsWith('@g.us')) continue;
    const nombre = String(meta.subject ?? meta.nombre ?? '').trim();
    if (!esGrupoDeInteres(nombre, regex)) continue;
    salida.push({ id, nombre, participantes: Array.isArray(meta.participants) ? meta.participants : [] });
  }
  return salida;
}
