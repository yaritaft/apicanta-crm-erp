import { normalizarParticipantes } from './participantes.js';

/* ==================================================================
   Los cuerpos de lo que se le manda a la app (POST /api/whatsapp/…).

   Mismas formas que valida la app (src/lib/whatsapp.ts). Acá sólo se
   armaron: ni red, ni WhatsApp. Un cuerpo lleva teléfonos: nunca va a un
   registro.
   ================================================================== */

const iso = (fecha) => new Date(fecha).toISOString();

/** La «foto» de un grupo: la lista completa de quienes están adentro. */
export function cuerpoFoto(grupo, participantes, { ahora = new Date(), mapaLid = new Map() } = {}) {
  const n = normalizarParticipantes(participantes, mapaLid);
  return {
    grupo: { id: grupo.id, nombre: grupo.nombre ?? '' },
    evento: 'foto',
    participantes: n.telefonos,
    total: n.total,
    sinTelefono: n.sinTelefono,
    en: iso(ahora),
  };
}

/** Un aviso de que alguien entró o salió. Si ninguno trae teléfono, null: no hay nada que avisar. */
export function cuerpoAviso(evento, grupo, participantes, { ahora = new Date(), mapaLid = new Map() } = {}) {
  const n = normalizarParticipantes(participantes, mapaLid);
  if (n.telefonos.length === 0) return null;
  return { grupo: { id: grupo.id, nombre: grupo.nombre ?? '' }, evento, participantes: n.telefonos, en: iso(ahora) };
}

/** Las acciones de Baileys que son entrar o salir; el resto (ascensos, cambios) no. */
export function eventoDeAccion(accion) {
  if (accion === 'add') return 'entro';
  if (accion === 'remove') return 'salio';
  return null;
}

/** El latido: «sigo vivo», y si está conectado a WhatsApp. */
export function cuerpoLatido({ conectado, grupos }, { ahora = new Date() } = {}) {
  return { en: iso(ahora), conectado: Boolean(conectado), grupos: Math.max(0, Math.trunc(Number(grupos) || 0)) };
}
