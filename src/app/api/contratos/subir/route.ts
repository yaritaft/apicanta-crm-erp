import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { baseDelPedido, correoDelPedido, esDuenoDelPedido, exigirArea } from "@/lib/permisos-servidor";
import { datosLimpios, soloDuenos, type DatosContrato } from "@/lib/contratos";
import { alumnoDelContrato, programasGuardados, subirFirmado } from "@/lib/contratos-servidor";
import { programaPorId } from "@/lib/programas";

/* ==================================================================
   POST (multipart): subir el PDF de un contrato firmado fuera de PandaDoc
   (en papel, o mandado por otro lado), como en Blue OS.
   Campos: archivo (PDF), ventaId o alumnoId, programa, fecha (aaaa-mm-dd,
   el día que firmó), datos (JSON con nombre, mail…) y accesos ("1" para
   darle los del programa al subirlo).
   Lo hace quien edita Ventas o Alumnos y sólo sobre lo que ve (se lee con
   SU sesión); con los contratos «sólo dueños», sólo un dueño.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/* Vercel corta los pedidos de más de 4,5 MB. */
const TOPE_PDF = 4 * 1024 * 1024;

function mal(mensaje: string, status = 400) {
  return NextResponse.json({ error: mensaje }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["ventas", "alumnos"], 2, { cerrado: true });
  if (noPuede) return noPuede;
  const db = nubeServidor();
  const mia = baseDelPedido(peticion);
  if (!db || !mia) return mal("Sin base configurada.", 503);

  const { programas, config } = await programasGuardados(db);
  if (config.estado === "apagado") return mal("Los contratos desde la app todavía están apagados (Ajustes → Integraciones).", 403);
  if (soloDuenos(config.estado) && !(await esDuenoDelPedido(peticion))) return mal("Por ahora los contratos los manejan sólo los dueños (Ajustes → Integraciones).", 403);

  const form = await peticion.formData().catch(() => null);
  if (!form) return mal("No llegó el archivo.");
  const archivo = form.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) return mal("Elegí el PDF del contrato firmado.");
  if (archivo.size > TOPE_PDF) return mal("El PDF pesa más de 4 MB: comprimilo (o exportalo de nuevo) y probá otra vez.");
  const pdf = new Uint8Array(await archivo.arrayBuffer());
  if (new TextDecoder().decode(pdf.slice(0, 5)) !== "%PDF-") return mal("El archivo no es un PDF.");

  const texto = (k: string) => { const v = form.get(k); return typeof v === "string" ? v.trim() : ""; };
  const ventaId = texto("ventaId") || null;
  let alumnoId = texto("alumnoId") || null;
  if (!ventaId && !alumnoId) return mal("Falta de qué venta o de qué servicio es el contrato.");
  /* Con la sesión de quien pide: si no la ve (el closer, una ajena), no la toca. */
  let leadId: string | null = null;
  if (ventaId) {
    const v = await mia.from("ventas").select("id, contactoId").eq("id", ventaId).maybeSingle();
    if (!v.data) return mal("No encuentro esa venta (o tu cuenta no la ve).", 404);
    leadId = (v.data.contactoId as string | null) ?? null;
  }
  if (alumnoId) {
    const a = await mia.from("alumnos").select("id, leadId").eq("id", alumnoId).maybeSingle();
    if (!a.data) return mal("No encuentro ese servicio (o tu cuenta no lo ve).", 404);
    leadId = leadId ?? ((a.data.leadId as string | null) ?? null);
  }

  const programa = programaPorId(programas, texto("programa"));
  if (!programa) return mal("Elegí el programa del contrato.");
  const fecha = texto("fecha");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return mal("Poné el día que lo firmó.");
  if (fecha > new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)) return mal("El día de la firma no puede ser futuro.");
  let crudos: Partial<DatosContrato> = {};
  try { crudos = JSON.parse(texto("datos") || "{}") as Partial<DatosContrato>; } catch { /* sin datos: van vacíos */ }
  const { reserva: _r, ...datos } = datosLimpios({ ...crudos, fecha });

  alumnoId = alumnoId ?? await alumnoDelContrato(db, { alumnoId: null, ventaId, leadId, destinatario: { email: datos.email }, datos });
  try {
    const contrato = await subirFirmado(db, {
      ventaId, leadId, alumnoId, programa, datos, pdf, fecha,
      quien: correoDelPedido(peticion) || "Apicanta", darAccesos: texto("accesos") === "1",
    });
    return NextResponse.json({ contrato }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return mal(e instanceof Error ? e.message : "No se pudo.", 500);
  }
}
