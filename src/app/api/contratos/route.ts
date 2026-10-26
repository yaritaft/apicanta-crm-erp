import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { baseDelPedido, correoDelPedido, esDuenoDelPedido, exigirArea } from "@/lib/permisos-servidor";
import { datosLimpios, problemaDeDatos, soloDuenos, type DatosContrato, type ModoContrato } from "@/lib/contratos";
import {
  anular, contratoPorId, corregir, crearContrato, darAccesosAhora, mandarBorrador, mandarRoadmap, nuevoEnlace, ponerPerfil, programasGuardados, reenviar, sincronizar, type ResultadoRoadmap,
} from "@/lib/contratos-servidor";
import { cambiaLaPlantilla, programaPorId } from "@/lib/programas";
import { ErrorPandadoc } from "@/lib/pandadoc-servidor";

/* ==================================================================
   POST { accion, … }: lo que se le hace a un contrato de PandaDoc.
   - "crear": { ventaId?, sesionId?, leadId?, alumnoId?, programa, datos, mandar?, prueba? } lo arma con la
     plantilla del programa y (salvo mandar:false) lo manda a firmar.
   - "mandar" | "reenviar" | "anular" { motivo } | "corregir" { datos } | "enlace" | "sincronizar" | "accesos": { id }; "perfil" { id, perfil } completa el perfil (roadmap) en cualquier estado.
     «accesos» da los del programa a un firmado que se quedó sin ellos (firmó antes de que se cargara la venta).
   Lo hace quien edita Ventas o Alumnos, y sólo sobre lo que ve: la venta, la persona o el contrato se leen
   antes con SU sesión (el closer, sólo lo suyo). Recién ahí se usa la clave de servicio.
   Los contratos se prenden en Ajustes: apagados no sale ninguno; en «prueba», sólo los dueños y con la
   clave sandbox; en «sólo dueños», los dueños con la de producción; encendidos, todo el equipo con la de
   producción (un dueño puede pedir uno de prueba).
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const dormir = (ms: number) => new Promise((listo) => setTimeout(listo, ms));

function mal(mensaje: string, status = 400) {
  return NextResponse.json({ error: mensaje }, { status, headers: { "Cache-Control": "no-store" } });
}

/** ¿Quien pide ve esa fila? Con reintentos: la venta recién cargada puede tardar en llegar a la base. */
async function laVe(mia: NonNullable<ReturnType<typeof baseDelPedido>>, tabla: string, id: string, intentos = 1): Promise<boolean> {
  for (let i = 0; i < intentos; i++) {
    const r = await mia.from(tabla).select("id").eq("id", id).maybeSingle();
    if (r.data) return true;
    if (i < intentos - 1) await dormir(1000);
  }
  return false;
}

export async function POST(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["ventas", "alumnos"], 2, { cerrado: true });
  if (noPuede) return noPuede;
  const db = nubeServidor();
  const mia = baseDelPedido(peticion);
  if (!db || !mia) return mal("Sin base configurada.", 503);
  const b = (await peticion.json().catch(() => ({}))) as Record<string, unknown>;
  const accion = typeof b.accion === "string" ? b.accion : "";
  const quien = correoDelPedido(peticion);

  try {
    if (accion === "crear") {
      const { programas, config } = await programasGuardados(db);
      const dueno = await esDuenoDelPedido(peticion);
      if (config.estado === "apagado") return mal("Los contratos desde la app todavía están apagados (Ajustes → Integraciones).", 403);
      if (soloDuenos(config.estado) && !dueno) return mal("Por ahora los contratos los mandan sólo los dueños (Ajustes → Integraciones).", 403);
      const modo: ModoContrato = config.estado === "prueba" || (dueno && b.prueba === true) ? "prueba" : "produccion";

      const ventaId = typeof b.ventaId === "string" && b.ventaId ? b.ventaId : null;
      const leadId = typeof b.leadId === "string" && b.leadId ? b.leadId : null;
      const alumnoId = typeof b.alumnoId === "string" && b.alumnoId ? b.alumnoId : null;
      const sesionId = typeof b.sesionId === "string" && b.sesionId ? b.sesionId : null;
      if (!ventaId && !leadId && !alumnoId) return mal("Falta de qué venta o de qué persona es el contrato.");
      if (ventaId && !(await laVe(mia, "ventas", ventaId, 6))) return mal("No encuentro esa venta (o tu cuenta no la ve). Si recién la cargaste, probá de nuevo en un momento.", 404);
      if (!ventaId && leadId && !(await laVe(mia, "leads", leadId))) return mal("No encuentro a esa persona (o tu cuenta no la ve).", 404);
      if (!ventaId && !leadId && alumnoId && !(await laVe(mia, "alumnos", alumnoId))) return mal("No encuentro ese servicio (o tu cuenta no lo ve).", 404);

      const programa = programaPorId(programas, typeof b.programa === "string" ? b.programa : null);
      if (!programa) return mal("Elegí el programa del contrato.");
      const datos = datosLimpios(b.datos as Partial<DatosContrato>);
      const problema = problemaDeDatos(datos, modo, undefined, programa.id);
      if (problema) return mal(problema);

      const contrato = await crearContrato(db, {
        ventaId, sesionId, leadId, alumnoId, programa, datos, modo, quien, mandar: b.mandar !== false, config,
        origen: new URL(peticion.url).origin,
      });
      return NextResponse.json({ contrato }, { status: contrato.estado === "error" ? 502 : 200 });
    }

    const id = typeof b.id === "string" ? b.id : "";
    if (!id) return mal("Falta qué contrato.");
    /* Con la sesión de quien pide: si no lo ve (el closer, uno ajeno), no lo toca. */
    if (!(await laVe(mia, "contratos", id))) return mal("No encuentro ese contrato (o tu cuenta no lo ve).", 404);
    const c = await contratoPorId(db, id);
    if (!c) return mal("No encuentro ese contrato.", 404);
    const { config, programas } = await programasGuardados(db);
    /* «perfil» y «roadmap»: si le salió (o no) el mail con su roadmap (lib/contratos-servidor.ts, mandarRoadmap). */
    let roadmap: ResultadoRoadmap | null = null;

    if (accion === "mandar") await mandarBorrador(db, c, quien, config);
    else if (accion === "reenviar") await reenviar(db, c, quien);
    else if (accion === "anular") await anular(db, c, typeof b.motivo === "string" ? b.motivo.trim() : "", quien);
    else if (accion === "corregir") {
      /* Corregir no cambia la plantilla: si era el de la reserva, sigue siéndolo (lo dice el contrato, no la pantalla). */
      const { reserva: _r, ...limpios } = datosLimpios(b.datos as Partial<DatosContrato>);
      const datos: DatosContrato = { ...limpios, ...(c.datos.reserva ? { reserva: true } : {}) };
      const problema = problemaDeDatos(datos, c.modo, undefined, c.programa);
      if (problema) return mal(problema);
      if (cambiaLaPlantilla(programaPorId(programas, c.programa), datos.reserva, c.datos.sesiones, datos.sesiones)) {
        return mal("Para cambiar si incluye sesiones 1 a 1, anulá este contrato y mandá otro: sale con otra plantilla.");
      }
      await corregir(db, c, datos, quien, config, new URL(peticion.url).origin);
    } else if (accion === "enlace") {
      const enlace = await nuevoEnlace(db, c);
      if (!enlace) return mal("PandaDoc no dio el link: el contrato tiene que estar enviado.", 409);
    } else if (accion === "sincronizar") await sincronizar(db, c, "sincronizacion");
    else if (accion === "accesos") await darAccesosAhora(db, c, quien || "Apicanta");
    else if (accion === "perfil") roadmap = await ponerPerfil(db, c, typeof b.perfil === "string" ? b.perfil : "", quien || "Apicanta");
    else if (accion === "roadmap") roadmap = await mandarRoadmap(db, c, quien || "Apicanta");
    else return mal("No sé hacer eso.");

    return NextResponse.json({ contrato: await contratoPorId(db, id), ...(roadmap ? { roadmap } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const status = e instanceof ErrorPandadoc ? (e.status >= 500 ? 502 : 409) : 500;
    if (e instanceof ErrorPandadoc) console.error("[contratos]", accion, e.status, e.detalle);
    return mal(e instanceof Error ? e.message : "No se pudo.", status);
  }
}
