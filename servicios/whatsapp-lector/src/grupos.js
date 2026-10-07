/* ==================================================================
   Qué grupos mira el lector.

   Un número de WhatsApp está en muchos grupos (clientes, familia, trabajo).
   GRUPOS_REGEX dice cuáles interesan: se prueba contra el NOMBRE del grupo.
   Sin GRUPOS_REGEX, todos.
   ================================================================== */

/** ¿Interesa un grupo con ese nombre? Sin regex, todos. */
export function esGrupoDeInteres(nombre, regex) {
  if (!regex) return true;
  /* Una regex con la bandera «g» o «y» recuerda dónde quedó: se reinicia. */
  regex.lastIndex = 0;
  return regex.test(String(nombre ?? ''));
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
