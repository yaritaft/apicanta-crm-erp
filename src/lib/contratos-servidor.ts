import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cuerpoDocumento, estadoDePandadoc, firmoElAlumno, mensajeDelContrato, partirNombre, ROL_ALUMNO,
  type Contrato, type DatosContrato, type EstadoContrato, type EventoContrato, type ModoContrato,
} from "./contratos";
import {
  aBorrador, actualizarDocumento, anularDocumento, crearDocumento, detalleDocumento, detallePlantilla, enlaceDeFirma, ErrorPandadoc,
  esperarBorrador, mandarDocumento, pdfDocumento, recordarDocumento,
} from "./pandadoc-servidor";
import { darAccesos, type ResultadoAccesos } from "./accesos-servidor";
import { programaPorId, programasDe, type Programa } from "./programas";
import type { ConfigContratos } from "./types";

/* ==================================================================
   Los contratos del lado del servidor: lo que se hace con PandaDoc y lo
   que se anota en la base (con la clave de servicio, después de que la
   ruta comprobó el permiso de quien pide). Ver lib/contratos.ts.
   ================================================================== */

const nuevoId = (prefijo: string) => `${prefijo}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const ahora = () => new Date().toISOString();

/* El orden de los estados: una sincronización nunca vuelve para atrás (un «enviado»
   atrasado no pisa un «firmado»). Volver a borrador lo hace sólo «Corregir». */
const RANGO: Record<EstadoContrato, number> = {
  error: -1, creando: 0, borrador: 1, enviado: 2, visto: 3, rechazado: 4, anulado: 4, firmado: 5,
};

export async function evento(db: SupabaseClient, contratoId: string, e: string, quien: string, origen: EventoContrato["origen"], detalle: Record<string, unknown> = {}): Promise<void> {
  await db.from("contrato_eventos").insert({ id: nuevoId("cev"), contratoId, evento: e, detalle, cuando: ahora(), quien, origen });
}

async function guardar(db: SupabaseClient, id: string, cambios: Partial<Contrato>): Promise<void> {
  const r = await db.from("contratos").update({ ...cambios, actualizadoEn: ahora() }).eq("id", id);
  if (r.error) throw new Error(`No se pudo guardar el contrato: ${r.error.message}`);
}

export async function contratoPorId(db: SupabaseClient, id: string): Promise<Contrato | null> {
  const r = await db.from("contratos").select("*").eq("id", id).maybeSingle();
  return (r.data as Contrato | null) ?? null;
}

export async function contratoPorDocumento(db: SupabaseClient, documentoId: string): Promise<Contrato | null> {
  const r = await db.from("contratos").select("*").eq("documentoId", documentoId).maybeSingle();
  return (r.data as Contrato | null) ?? null;
}

export async function programasGuardados(db: SupabaseClient): Promise<{ programas: Programa[]; config: ConfigContratos }> {
  const r = await db.from("ajustes").select("programas, contratos").limit(1).maybeSingle();
  const fila = (r.data ?? {}) as { programas?: Programa[]; contratos?: ConfigContratos };
  return { programas: programasDe(fila), config: fila.contratos ?? { estado: "apagado" } };
}

const mensajeDe = (e: unknown) => e instanceof ErrorPandadoc ? e.message : e instanceof Error ? e.message : "No se pudo.";

/* ---------- Crear y mandar ---------- */

export interface PedidoContrato {
  ventaId?: string | null; sesionId?: string | null; leadId?: string | null; alumnoId?: string | null;
  programa: Programa; datos: DatosContrato; modo: ModoContrato; quien: string;
  /* false: queda en borrador en PandaDoc (para mandarlo después). */
  mandar: boolean;
  config?: ConfigContratos;
}

export async function crearContrato(db: SupabaseClient, p: PedidoContrato): Promise<Contrato> {
  if (!p.programa.plantillaId) throw new Error(`El programa ${p.programa.nombre} no tiene plantilla de PandaDoc (Ajustes → Integraciones).`);
  const id = nuevoId("ctr");
  const fila: Partial<Contrato> = {
    id, ventaId: p.ventaId ?? null, sesionId: p.sesionId ?? null, leadId: p.leadId ?? null, alumnoId: p.alumnoId ?? null,
    programa: p.programa.id, plantillaId: p.programa.plantillaId, plantillaNombre: p.programa.plantillaNombre,
    modo: p.modo, estado: "creando",
    destinatario: { nombre: p.datos.nombre.trim(), email: p.datos.email.trim().toLowerCase(), telefono: p.datos.telefono.trim() },
    datos: p.datos, origen: "app", creadoPor: p.quien, creadoEn: ahora(), actualizadoEn: ahora(),
  };
  const ins = await db.from("contratos").insert(fila);
  if (ins.error) throw new Error(/contratos|PGRST205|42P01/.test(`${ins.error.code} ${ins.error.message}`)
    ? "Falta correr supabase/contratos-y-accesos.sql en la base." : `No se pudo guardar el contrato: ${ins.error.message}`);
  await evento(db, id, "creado", p.quien, "app", { programa: p.programa.nombre, modo: p.modo });

  try {
    /* Se lee la plantilla para mandar sólo las variables y los campos que tiene (si no se puede, van todas las variables). */
    const plantilla = await detallePlantilla(p.modo, p.programa.plantillaId).catch(() => undefined);
    const doc = await crearDocumento(p.modo, cuerpoDocumento({
      contratoId: id, ventaId: p.ventaId, modo: p.modo, plantillaId: p.programa.plantillaId, programa: p.programa.nombre, datos: p.datos, plantilla,
    }));
    await guardar(db, id, { documentoId: doc.id });
    const estado = await esperarBorrador(p.modo, doc.id);
    if (estado !== "document.draft") {
      throw new ErrorPandadoc(502, estado === "document.uploaded"
        ? "PandaDoc tardó demasiado en armar el contrato. Probá «Actualizar» en un minuto."
        : `PandaDoc dejó el contrato en «${estado || "sin estado"}».`);
    }
    if (!p.mandar) {
      await guardar(db, id, { estado: "borrador", sincronizadoEn: ahora() });
    } else {
      await mandarDocumento(p.modo, doc.id, mensajeDelContrato(p.config, p.datos, p.programa.nombre));
      await guardar(db, id, { estado: "enviado", enviadoEn: ahora(), sincronizadoEn: ahora(), error: null });
      await evento(db, id, "enviado", p.quien, "app", { a: p.datos.email });
      await refrescarEnlace(db, id, p.modo, doc.id, p.datos.email);
    }
  } catch (e) {
    await guardar(db, id, { estado: "error", error: mensajeDe(e) });
    await evento(db, id, "error", p.quien, "app", { error: mensajeDe(e), detalle: e instanceof ErrorPandadoc ? e.detalle : "" });
  }
  return (await contratoPorId(db, id))!;
}

/** El link para firmar, para copiarlo y mandarlo por WhatsApp. Si no sale, el contrato sigue igual. */
async function refrescarEnlace(db: SupabaseClient, id: string, modo: ModoContrato, documentoId: string, email: string): Promise<void> {
  try {
    const e = await enlaceDeFirma(modo, documentoId, email);
    await guardar(db, id, { enlace: e.enlace, enlaceVence: e.vence });
  } catch (err) { console.error("[contratos] no salió el link para firmar", id, mensajeDe(err)); }
}

/* ---------- Lo que se le hace a uno que ya existe ---------- */

export async function mandarBorrador(db: SupabaseClient, c: Contrato, quien: string, config?: ConfigContratos): Promise<void> {
  if (!c.documentoId) throw new Error("Este contrato no llegó a PandaDoc: mandá uno nuevo.");
  await mandarDocumento(c.modo, c.documentoId, mensajeDelContrato(config, c.datos, nombrePrograma(c)));
  await guardar(db, c.id, { estado: "enviado", enviadoEn: ahora(), sincronizadoEn: ahora(), error: null });
  await evento(db, c.id, "enviado", quien, "app", { a: c.destinatario.email });
  await refrescarEnlace(db, c.id, c.modo, c.documentoId, c.destinatario.email ?? "");
}

export async function reenviar(db: SupabaseClient, c: Contrato, quien: string): Promise<void> {
  if (!c.documentoId) throw new Error("Este contrato no llegó a PandaDoc.");
  const det = await detalleDocumento(c.modo, c.documentoId);
  const pendientes = ((det.recipients ?? []) as { id?: string; role?: string; has_completed?: boolean }[])
    .filter((r) => r.id && !r.has_completed && (r.role === ROL_ALUMNO || !r.role)).map((r) => r.id!);
  if (pendientes.length === 0) throw new Error("No hay a quién reenviárselo: ya firmó.");
  await recordarDocumento(c.modo, c.documentoId, pendientes);
  await evento(db, c.id, "reenviado", quien, "app", { a: c.destinatario.email });
  await refrescarEnlace(db, c.id, c.modo, c.documentoId, c.destinatario.email ?? "");
}

export async function anular(db: SupabaseClient, c: Contrato, motivo: string, quien: string): Promise<void> {
  if (c.estado === "firmado") throw new Error("Un contrato firmado no se puede anular.");
  if (c.documentoId && c.estado !== "anulado") await anularDocumento(c.modo, c.documentoId, motivo || "Anulado desde Apicanta");
  await guardar(db, c.id, { estado: "anulado", anuladoEn: ahora(), enlace: null });
  await evento(db, c.id, "anulado", quien, "app", { motivo });
}

/** Corregir: vuelve a borrador en PandaDoc, se cambian los datos y se manda de nuevo (las firmas se borran). */
export async function corregir(db: SupabaseClient, c: Contrato, datos: DatosContrato, quien: string, config?: ConfigContratos): Promise<void> {
  if (!c.documentoId) throw new Error("Este contrato no llegó a PandaDoc: mandá uno nuevo.");
  if (c.estado === "firmado") throw new Error("Un contrato firmado no se corrige: si hace falta otro, mandá uno nuevo.");
  const programa = nombrePrograma(c);
  if (c.estado !== "borrador") await aBorrador(c.modo, c.documentoId);
  await esperarBorrador(c.modo, c.documentoId);
  const nombre = datos.nombre.trim();
  /* El documento sabe qué variables y campos tiene: se corrigen ésos. */
  const actual = await detalleDocumento(c.modo, c.documentoId).catch(() => undefined);
  const cuerpo = cuerpoDocumento({ contratoId: c.id, ventaId: c.ventaId, modo: c.modo, plantillaId: c.plantillaId, programa, datos, plantilla: actual });
  await actualizarDocumento(c.modo, c.documentoId, {
    name: `${c.modo === "prueba" ? "[Prueba] " : ""}Contrato ${programa} - ${nombre}`,
    recipients: [{ email: datos.email.trim(), ...partirNombre(nombre), role: ROL_ALUMNO, ...(datos.telefono.trim() ? { phone: datos.telefono.trim() } : {}) }],
    tokens: cuerpo.tokens,
    ...(cuerpo.fields ? { fields: cuerpo.fields } : {}),
  });
  await esperarBorrador(c.modo, c.documentoId);
  await mandarDocumento(c.modo, c.documentoId, mensajeDelContrato(config, datos, programa));
  await guardar(db, c.id, {
    estado: "enviado", enviadoEn: ahora(), vistoEn: null, error: null, datos,
    destinatario: { nombre, email: datos.email.trim().toLowerCase(), telefono: datos.telefono.trim() },
  });
  await evento(db, c.id, "corregido", quien, "app", { cambios: diferencias(c.datos, datos) });
  await refrescarEnlace(db, c.id, c.modo, c.documentoId, datos.email);
}

const nombrePrograma = (c: Contrato) => c.plantillaNombre.replace(/^Contrato( de Mentoría| Programa| de)?\s*-?\s*/i, "") || c.programa;

function diferencias(antes: Partial<DatosContrato>, despues: DatosContrato): string[] {
  return (Object.keys(despues) as (keyof DatosContrato)[])
    .filter((k) => JSON.stringify(antes[k] ?? null) !== JSON.stringify(despues[k] ?? null));
}

export async function nuevoEnlace(db: SupabaseClient, c: Contrato): Promise<string | null> {
  if (!c.documentoId) return null;
  await refrescarEnlace(db, c.id, c.modo, c.documentoId, c.destinatario.email ?? "");
  return (await contratoPorId(db, c.id))?.enlace ?? null;
}

/* ---------- Sincronizar con PandaDoc ---------- */

/** Le pregunta a PandaDoc cómo está y lo anota. Nunca vuelve para atrás. Si quedó firmado, corre lo de la firma. */
export async function sincronizar(db: SupabaseClient, c: Contrato, origen: EventoContrato["origen"], delAviso?: Record<string, unknown>): Promise<Contrato> {
  if (!c.documentoId) return c;
  let det: Record<string, unknown>;
  try { det = await detalleDocumento(c.modo, c.documentoId); }
  catch (e) {
    /* Sin la clave de ese modo en este entorno (o PandaDoc caído): vale lo que trajo el aviso, que llegó firmado. */
    if (delAviso && e instanceof ErrorPandadoc && (e.status === 503 || e.status >= 500)) {
      console.error("[contratos] no pude volver a preguntarle a PandaDoc; uso el aviso:", c.id, e.message);
      det = delAviso;
      return aplicarDetalle(db, c, det, origen);
    }
    if (e instanceof ErrorPandadoc && e.status === 404) {
      if (c.estado !== "firmado" && c.estado !== "anulado") {
        await guardar(db, c.id, { estado: "anulado", anuladoEn: ahora(), sincronizadoEn: ahora() });
        await evento(db, c.id, "anulado", "PandaDoc", origen, { motivo: "Se borró en PandaDoc" });
      }
      return (await contratoPorId(db, c.id))!;
    }
    throw e;
  }
  return aplicarDetalle(db, c, det, origen);
}

async function aplicarDetalle(db: SupabaseClient, c: Contrato, det: Record<string, unknown>, origen: EventoContrato["origen"]): Promise<Contrato> {
  let nuevo = estadoDePandadoc(typeof det.status === "string" ? det.status : "") ?? c.estado;
  if (firmoElAlumno(det)) nuevo = "firmado";
  const cambios: Partial<Contrato> = { sincronizadoEn: ahora() };
  if (nuevo !== c.estado && (RANGO[nuevo] > RANGO[c.estado] || c.estado === "error" || c.estado === "creando")) {
    cambios.estado = nuevo;
    if (nuevo === "visto") cambios.vistoEn = c.vistoEn ?? ahora();
    if (nuevo === "enviado" && !c.enviadoEn) cambios.enviadoEn = ahora();
    if (nuevo === "firmado") cambios.firmadoEn = c.firmadoEn ?? ahora();
    if (nuevo === "rechazado") cambios.rechazadoEn = c.rechazadoEn ?? ahora();
    if (nuevo === "anulado") cambios.anuladoEn = c.anuladoEn ?? ahora();
    if (nuevo === "firmado" || nuevo === "anulado" || nuevo === "rechazado") cambios.enlace = null;
  }
  await guardar(db, c.id, cambios);
  if (cambios.estado && cambios.estado !== "borrador" && cambios.estado !== "creando") {
    await evento(db, c.id, cambios.estado, cambios.estado === "firmado" ? (c.destinatario.nombre ?? "El alumno") : "PandaDoc", origen);
  }
  const actual = (await contratoPorId(db, c.id))!;
  if (actual.estado === "firmado" && (!actual.accesosEn || !actual.pdfPath)) await alFirmar(db, actual);
  return (await contratoPorId(db, c.id))!;
}

/* ---------- Al firmar ---------- */

/** El PDF al bucket, «Firmado» en la ficha de Customer Success y los accesos del programa. Cada parte es independiente. */
export async function alFirmar(db: SupabaseClient, c: Contrato): Promise<{ accesos: ResultadoAccesos | null }> {
  if (!c.pdfPath && c.documentoId) {
    try {
      const pdf = await pdfDocumento(c.modo, c.documentoId, true);
      const ruta = `${c.id}.pdf`;
      const up = await db.storage.from("contratos").upload(ruta, Buffer.from(pdf), { contentType: "application/pdf", upsert: true });
      if (!up.error) await guardar(db, c.id, { pdfPath: ruta });
      else console.error("[contratos] no se guardó el PDF", c.id, up.error.message);
    } catch (e) { console.error("[contratos] no se bajó el PDF", c.id, mensajeDe(e)); }
  }

  const alumnoId = await alumnoDelContrato(db, c);
  if (alumnoId && c.alumnoId !== alumnoId) await guardar(db, c.id, { alumnoId });
  if (alumnoId && c.modo === "produccion") {
    await db.from("seguimiento_alumnos").update({ contratoFirmado: "Firmado", estadoContrato: "Firmado en PandaDoc" }).eq("alumnoId", alumnoId);
  }

  if (c.accesosEn) return { accesos: null };
  const { programas, config } = await programasGuardados(db);
  /* Los accesos solos se prenden con los contratos: con «prueba», sólo los de prueba; apagado, ninguno.
     No se marca nada: el día que se prendan, la próxima pasada los da. */
  const prendidos = config.estado === "encendido" || (config.estado === "prueba" && c.modo === "prueba");
  if (!prendidos) return { accesos: null };
  const programa = programaPorId(programas, c.programa);
  if (!alumnoId || !programa) {
    await evento(db, c.id, "accesos", "Apicanta", "app", {
      dados: 0, motivo: !alumnoId ? "El contrato no tiene alumno: los accesos se dan a mano desde su servicio." : "El programa del contrato ya no existe en Ajustes.",
    });
    await guardar(db, c.id, { accesosEn: ahora() });
    return { accesos: null };
  }
  /* Se marca ANTES de dar: si dos avisos llegan juntos, sólo uno da los accesos. */
  const toma = await db.from("contratos").update({ accesosEn: ahora() }).eq("id", c.id).is("accesosEn", null).select("id");
  if (!toma.data?.length) return { accesos: null };
  const r = await darAccesos(db, {
    alumnoId, contratoId: c.id, programa, origen: "automatico", quien: "Al firmar el contrato",
    persona: { nombre: c.destinatario.nombre ?? "", email: c.destinatario.email ?? "", telefono: c.destinatario.telefono },
  });
  await evento(db, c.id, "accesos", "Apicanta", "app", { dados: r.dados, fallaron: r.fallaron, yaEstaban: r.yaEstaban });
  return { accesos: r };
}

/** El alumno del contrato: el que tiene guardado, el de su venta o el de su persona. */
export async function alumnoDelContrato(db: SupabaseClient, c: Pick<Contrato, "alumnoId" | "ventaId" | "leadId">): Promise<string | null> {
  if (c.alumnoId) return c.alumnoId;
  if (c.ventaId) {
    const r = await db.from("alumnos").select("id").eq("ventaId", c.ventaId).limit(1).maybeSingle();
    if (r.data?.id) return r.data.id as string;
  }
  if (c.leadId) {
    const r = await db.from("alumnos").select("id").eq("leadId", c.leadId).order("creadoEn", { ascending: false }).limit(1).maybeSingle();
    if (r.data?.id) return r.data.id as string;
  }
  return null;
}

/* ---------- Un contrato que se mandó a mano desde PandaDoc ---------- */

/** El aviso de un documento que no salió de la app: si es de la plantilla de un programa, se anota (por el mail del alumno). */
export async function contratoDeAfuera(db: SupabaseClient, documentoId: string, modo: ModoContrato): Promise<Contrato | null> {
  const det = await detalleDocumento(modo, documentoId);
  const plantilla = (det.template ?? {}) as { id?: string; name?: string };
  const { programas } = await programasGuardados(db);
  const programa = programas.find((p) => p.plantillaId && p.plantillaId === plantilla.id);
  if (!programa) return null;
  const alumno = ((det.recipients ?? []) as { email?: string; first_name?: string; last_name?: string; phone?: string; role?: string }[])
    .find((r) => r.role === ROL_ALUMNO) ?? null;
  const email = (alumno?.email ?? "").trim().toLowerCase();
  const lead = email ? (await db.from("leads").select("id").ilike("email", email).limit(1).maybeSingle()).data?.id as string | undefined : undefined;
  const id = nuevoId("ctr");
  const ins = await db.from("contratos").insert({
    id, leadId: lead ?? null, programa: programa.id, plantillaId: programa.plantillaId, plantillaNombre: plantilla.name ?? programa.plantillaNombre,
    documentoId, modo, estado: "enviado", origen: "pandadoc", creadoPor: "PandaDoc",
    destinatario: { nombre: [alumno?.first_name, alumno?.last_name].filter(Boolean).join(" "), email, telefono: alumno?.phone ?? "" },
    datos: {}, enviadoEn: typeof det.date_sent === "string" ? det.date_sent : ahora(),
  });
  if (ins.error) return contratoPorDocumento(db, documentoId);
  await evento(db, id, "creado", "PandaDoc", "pandadoc", { motivo: "Se mandó a mano desde PandaDoc" });
  return contratoPorId(db, id);
}
