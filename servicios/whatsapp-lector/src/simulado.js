import { readFileSync } from 'node:fs';
import { cuerpoAviso, cuerpoFoto, cuerpoLatido } from './cuerpos.js';
import { dormir } from './espera.js';
import { esGrupoDeInteres } from './grupos.js';
import { aprenderLids } from './participantes.js';

/* ==================================================================
   El modo simulado: sin WhatsApp.

   Lee un JSON con lo que «vería» el lector y lo manda a la app por el mismo
   camino que el lector de verdad (los mismos cuerpos, el mismo cliente HTTP,
   el mismo filtro de GRUPOS_REGEX). Sirve para probar la app de punta a punta
   sin un número conectado, y para ensayar casos raros (participantes por LID,
   uno que sale, el lector que se cae).

   El archivo:
     { "pasos": [
         { "tipo": "latido", "conectado": true, "grupos": 1 },
         { "tipo": "foto",  "grupo": { "id": "…@g.us", "nombre": "…" }, "participantes": [ … ] },
         { "tipo": "entro", "grupo": { … }, "participantes": [ … ] },
         { "tipo": "salio", "grupo": { … }, "participantes": [ … ] },
         { "tipo": "esperar", "ms": 1000 }
     ] }
   Cada paso puede llevar "haceMin": que pasó hace tantos minutos.
   Los participantes se escriben como los da Baileys: un texto
   («5491155551234@s.whatsapp.net», «123@lid»), o un objeto
   ({ "id": "123@lid", "phoneNumber": "5491155551234@s.whatsapp.net" }).
   ================================================================== */

export function leerPasos(archivo) {
  let json;
  try { json = JSON.parse(readFileSync(archivo, 'utf8')); }
  catch (e) { throw new Error(`No pude leer el archivo del modo simulado («${archivo}»): ${e.code === 'ENOENT' ? 'no existe' : 'no es un JSON válido'}.`); }
  if (!json || !Array.isArray(json.pasos)) throw new Error('El archivo del modo simulado tiene que tener una lista «pasos».');
  return json.pasos;
}

/** Cuenta corta de lo que contestó la app, sin teléfonos. */
function resumenDe(r) {
  const x = r.respuesta ?? {};
  if (x.ignorada) return `ignorado: ${x.ignorada}`;
  const partes = [];
  for (const [k, texto] of [['nuevos', 'nuevos'], ['volvieron', 'volvieron'], ['salieron', 'salieron'], ['miembros', 'adentro']]) {
    if (typeof x[k] === 'number') partes.push(`${x[k]} ${texto}`);
  }
  return partes.join(', ') || 'ok';
}

export async function simular({ archivo, cliente, log, regex = null, ahora = () => new Date(), pausar = dormir }) {
  const pasos = leerPasos(archivo);
  const mapaLid = new Map();
  const total = { enviados: 0, fallidos: 0, salteados: 0 };

  for (const [i, paso] of pasos.entries()) {
    const cuando = new Date(ahora().getTime() - (Number(paso.haceMin) || 0) * 60_000);
    const etiqueta = `Paso ${i + 1} (${paso.tipo}${paso.grupo?.nombre ? ` «${paso.grupo.nombre}»` : ''})`;

    if (paso.tipo === 'esperar') { await pausar(Math.max(0, Number(paso.ms) || 0)); continue; }

    let respuesta;
    if (paso.tipo === 'latido') {
      respuesta = await cliente.enviarLatido(cuerpoLatido({ conectado: paso.conectado ?? true, grupos: paso.grupos ?? 0 }, { ahora: cuando }));
    } else if (paso.tipo === 'foto' || paso.tipo === 'entro' || paso.tipo === 'salio') {
      if (!paso.grupo?.id) { log.error(`${etiqueta}: falta «grupo.id».`); total.fallidos++; continue; }
      if (!esGrupoDeInteres(paso.grupo.nombre, regex)) { log.info(`${etiqueta}: no coincide con GRUPOS_REGEX, se saltea.`); total.salteados++; continue; }
      aprenderLids(paso.participantes, mapaLid);
      const cuerpo = paso.tipo === 'foto'
        ? cuerpoFoto(paso.grupo, paso.participantes, { ahora: cuando, mapaLid })
        : cuerpoAviso(paso.tipo, paso.grupo, paso.participantes, { ahora: cuando, mapaLid });
      if (!cuerpo) { log.warn(`${etiqueta}: ningún participante trae teléfono, no se informa.`); total.salteados++; continue; }
      respuesta = await cliente.enviarGrupo(cuerpo);
      if (paso.tipo === 'foto') {
        log.info(`${etiqueta}: ${cuerpo.participantes.length} con teléfono, ${cuerpo.sinTelefono} sin teléfono visible (de ${cuerpo.total}).`);
      }
    } else {
      log.error(`${etiqueta}: no conozco ese tipo de paso («latido», «foto», «entro», «salio» o «esperar»).`);
      total.fallidos++;
      continue;
    }

    if (respuesta.ok) { total.enviados++; log.info(`${etiqueta}: la app contestó ${respuesta.status} (${resumenDe(respuesta)}).`); }
    else { total.fallidos++; log.error(`${etiqueta}: la app NO lo aceptó (${respuesta.status || 'sin conexión'}): ${respuesta.error}`); }
  }
  log.info(`Simulación terminada: ${total.enviados} enviados, ${total.fallidos} fallidos, ${total.salteados} salteados.`);
  return total;
}
