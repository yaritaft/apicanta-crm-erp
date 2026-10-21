import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { baseDelPedido, correoDelPedido, esDuenoDelPedido, exigirArea } from "@/lib/permisos-servidor";
import { problemaDeDatos, type DatosContrato, type ModoContrato } from "@/lib/contratos";
import {
  anular, contratoPorId, corregir, crearContrato, mandarBorrador, nuevoEnlace, programasGuardados, reenviar, sincronizar,
} from "@/lib/contratos-servidor";
import { programaPorId } from "@/lib/programas";
import { ErrorPandadoc } from "@/lib/pandadoc-servidor";
import { diaDeNegocio } from "@/lib/dia-negocio";

/* ==================================================================
   POST { accion, … }: lo que se le hace a un contrato de PandaDoc.
   - "crear": { ventaId?, sesionId?, leadId?, alumnoId?, programa, datos, mandar?, prueba? } lo arma con la
     plantilla del programa y (salvo mandar:false) lo manda a firmar.
   - "mandar" | "reenviar" | "anular" { motivo } | "corregir" { datos } | "enlace" | "sincronizar": { id }.
   Lo hace quien edita Ventas o Alumnos, y sólo sobre lo que ve: la venta, la persona o el contrato se leen
   antes con SU sesión (el closer, sólo lo suyo). Recién ahí se usa la clave de servicio.
   Los contratos se prenden en Ajustes: apagados no sale ninguno; en «prueba», sólo los dueños y con la
   clave sandbox; encendidos, todo el equipo con la de producción (un dueño puede pedir uno de prueba).
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

function datosLimpios(d: Partial<DatosContrato> | undefined): DatosContrato {
  const t = (x: unknown) => (typeof x === "string" ? x.trim() : "");
  return {
    nombre: t(d?.nombre), email: t(d?.email).toLowerCase(), telefono: t(d?.telefono), documento: t(d?.documento),
    domicilio: t(d?.domicilio), pais: t(d?.pais), modalidad: t(d?.modalidad),
    sesiones: typeof d?.sesiones === "number" && Number.isFinite(d.sesiones) ? Math.max(0, Math.round(d.sesiones)) : null,
    bonos: Array.isArray(d?.bonos) ? d!.bonos!.map(t).filter(Boolean) : [],
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(t(d?.fecha)) ? t(d?.fecha) : diaDeNegocio(new Date().toISOString()),
    inicio: /^\d{4}-\d{2}-\d{2}$/.test(t(d?.inicio)) ? t(d?.inicio) : undefined,
  };
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
      if (config.estado === "prueba" && !dueno) return mal("Los contratos están en prueba: por ahora los mandan sólo los dueños.", 403);
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
      const problema = problemaDeDatos(datos, modo);
      if (problema) return mal(problema);

      const contrato = await crearContrato(db, {
        ventaId, sesionId, leadId, alumnoId, programa, datos, modo, quien, mandar: b.mandar !== false, config,
      });
      return NextResponse.json({ contrato }, { status: contrato.estado === "error" ? 502 : 200 });
    }

    const id = typeof b.id === "string" ? b.id : "";
    if (!id) return mal("Falta qué contrato.");
    /* Con la sesión de quien pide: si no lo ve (el closer, uno ajeno), no lo toca. */
    if (!(await laVe(mia, "contratos", id))) return mal("No encuentro ese contrato (o tu cuenta no lo ve).", 404);
    const c = await contratoPorId(db, id);
    if (!c) return mal("No encuentro ese contrato.", 404);
    const { config } = await programasGuardados(db);

    if (accion === "mandar") await mandarBorrador(db, c, quien, config);
    else if (accion === "reenviar") await reenviar(db, c, quien);
    else if (accion === "anular") await anular(db, c, typeof b.motivo === "string" ? b.motivo.trim() : "", quien);
    else if (accion === "corregir") {
      const datos = datosLimpios(b.datos as Partial<DatosContrato>);
      const problema = problemaDeDatos(datos, c.modo);
      if (problema) return mal(problema);
      await corregir(db, c, datos, quien, config);
    } else if (accion === "enlace") {
      const enlace = await nuevoEnlace(db, c);
      if (!enlace) return mal("PandaDoc no dio el link: el contrato tiene que estar enviado.", 409);
    } else if (accion === "sincronizar") await sincronizar(db, c, "sincronizacion");
    else return mal("No sé hacer eso.");

    return NextResponse.json({ contrato: await contratoPorId(db, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const status = e instanceof ErrorPandadoc ? (e.status >= 500 ? 502 : 409) : 500;
    if (e instanceof ErrorPandadoc) console.error("[contratos]", accion, e.status, e.detalle);
    return mal(e instanceof Error ? e.message : "No se pudo.", status);
  }
}
