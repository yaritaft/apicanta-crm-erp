/* ==================================================================
   De los participantes de un grupo de WhatsApp a sus teléfonos.

   WhatsApp identifica a cada persona de dos maneras:
   - por su TELÉFONO:  5491155551234@s.whatsapp.net
   - por un id interno (LID):  123456789012345@lid   (la persona queda
     oculta: el grupo no muestra su número)

   Qué trae cada participante depende de la versión de Baileys y del grupo:
   - Baileys 6.7.x:   un texto («…@s.whatsapp.net» o «…@lid»), o un objeto
     { id, lid?, jid? }.
   - Baileys 7.x:     un objeto { id, lid?, phoneNumber? }. En los grupos por LID,
     `id` es el LID y `phoneNumber` el teléfono; en los otros, al revés.
   Esto entiende todas esas formas. Un participante sin teléfono NO se manda:
   se cuenta aparte y se informa el total.

   Nunca se escribe un teléfono en los registros: ni acá ni donde se use esto.
   ================================================================== */

const JID_DE_PERSONA = /^(\d{6,20})(?::\d+)?@(?:s\.whatsapp\.net|c\.us)$/;
const SOLO_NUMERO = /^\+?\d{6,20}$/;

/** Los dígitos de un teléfono con forma de id de persona («549…@s.whatsapp.net»,
    con o sin el número de dispositivo «:12»), o de dígitos sueltos; si no, null. */
export function telefonoDeId(id) {
  if (typeof id !== 'string') return null;
  const t = id.trim();
  const m = JID_DE_PERSONA.exec(t);
  if (m) return m[1];
  return SOLO_NUMERO.test(t) ? t.replace(/\D/g, '') : null;
}

/** ¿Es el id interno (LID) de una persona? */
export const esLid = (id) => typeof id === 'string' && /@lid$/i.test(id.trim());

/** Un participante, tal como lo da Baileys, a su teléfono (dígitos) o null.
    `mapaLid` es lo que ya se sabe de LID → teléfono. */
export function telefonoDeParticipante(p, mapaLid = new Map()) {
  if (typeof p === 'string') {
    return telefonoDeId(p) ?? (esLid(p) ? telefonoDeId(mapaLid.get(p.trim())) : null);
  }
  if (p === null || typeof p !== 'object') return null;
  /* Primero los campos que son el teléfono; `id` al final: en un grupo por
     LID es el LID, en los otros es el teléfono. */
  for (const campo of [p.phoneNumber, p.jid, p.pn, p.id]) {
    const t = telefonoDeId(campo);
    if (t) return t;
  }
  for (const campo of [p.lid, p.id]) {
    if (esLid(campo)) {
      const t = telefonoDeId(mapaLid.get(campo.trim()));
      if (t) return t;
    }
  }
  return null;
}

/** Con quién se identifica a un participante (para no contarlo dos veces). */
function identidad(p) {
  if (typeof p === 'string') return p.trim();
  if (p && typeof p === 'object') return String(p.id ?? p.lid ?? p.phoneNumber ?? p.jid ?? '').trim();
  return '';
}

/** Los LID que se pueden resolver con lo que trae el propio participante
    (`lid` y `phoneNumber`/`jid`/`id` a la vez): se suman al mapa. */
export function aprenderLids(lista, mapaLid) {
  for (const p of Array.isArray(lista) ? lista : []) {
    if (p === null || typeof p !== 'object') continue;
    const telefono = [p.phoneNumber, p.jid, p.pn, p.id].find((x) => telefonoDeId(x));
    const lid = [p.lid, p.id].find((x) => esLid(x));
    if (telefono && lid) mapaLid.set(lid.trim(), telefono);
  }
  return mapaLid;
}

/** Los LID de la lista que todavía no tienen teléfono (para preguntarle a Baileys). */
export function lidsSinResolver(lista, mapaLid = new Map()) {
  const salida = new Set();
  for (const p of Array.isArray(lista) ? lista : []) {
    if (telefonoDeParticipante(p, mapaLid)) continue;
    const lid = typeof p === 'string' ? p : p?.lid ?? p?.id;
    if (esLid(lid)) salida.add(lid.trim());
  }
  return [...salida];
}

/** Los participantes de un grupo: sus teléfonos (sin repetir), cuántos son en
    total y cuántos no traen teléfono. */
export function normalizarParticipantes(lista, mapaLid = new Map()) {
  const vistos = new Set();
  const telefonos = new Set();
  let sinTelefono = 0;
  for (const p of Array.isArray(lista) ? lista : []) {
    const quien = identidad(p);
    if (!quien || vistos.has(quien)) continue;
    vistos.add(quien);
    const t = telefonoDeParticipante(p, mapaLid);
    if (t) telefonos.add(t); else sinTelefono++;
  }
  return { telefonos: [...telefonos], total: vistos.size, sinTelefono };
}
