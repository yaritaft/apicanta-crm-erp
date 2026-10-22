import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  accesosAlFirmar, cuerpoDocumento, destinatario, estadoDePandadoc, fichaAlFirmar, firmoElAlumno, mensajeDelContrato, ROL_ALUMNO,
  type Contrato, type DatosContrato, type EstadoContrato, type EventoContrato, type ModoContrato,
} from "./contratos";
import {
  aBorrador, actualizarDocumento, anularDocumento, crearDocumento, detalleDocumento, detallePlantilla, enlaceDeFirma, ErrorPandadoc,
  esperarBorrador, mandarDocumento, pdfDocumento, recordarDocumento,
} from "./pandadoc-servidor";
import { cambiarFicha, darAccesos, type ResultadoAccesos } from "./accesos-servidor";
import { plantillaDelContrato, programaPorId, programasDe, type Programa } from "./programas";
import type { ConfigContratos } from "./types";
import { guiaDeBienvenida, htmlDeBienvenida, textoDeBienvenida, type ConfigBienvenida } from "./bienvenida-alumno";
import { codigoDeAlumno, configResend, enviarPorResend } from "./reporte-servidor";
import { enlaceDeReporte } from "./reporte-enlace";

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

/** Los roadmaps y los contactos de soporte de la bienvenida (Ajustes; no están en el código porque el repositorio es público). */
export async function configBienvenida(db: SupabaseClient): Promise<ConfigBienvenida | null> {
  const r = await db.from("ajustes").select("bienvenida").limit(1).maybeSingle();
  return r.error ? null : ((r.data as { bienvenida?: ConfigBienvenida | null } | null)?.bienvenida ?? null);
}

/** La dirección de la app para la página de bienvenida: la de producción en la app publicada; si no, la del pedido. */
export function baseDeLaApp(origen?: string | null): string | null {
  const prod = process.env.VERCEL_ENV === "production" ? process.env.VERCEL_PROJECT_PRODUCTION_URL : undefined;
  if (prod) return `https://${prod}`;
  return origen && /^https:\/\//.test(origen) ? origen : null;
}
const paginaDeBienvenida = (base: string | null, codigo: string | null | undefined) =>
  base && codigo ? `${base}/bienvenida/${codigo}` : null;

const mensajeDe = (e: unknown) => e instanceof ErrorPandadoc ? e.message : e instanceof Error ? e.message : "No se pudo.";

/* ---------- Crear y mandar ---------- */

export interface PedidoContrato {
  ventaId?: string | null; sesionId?: string | null; leadId?: string | null; alumnoId?: string | null;
  programa: Programa; datos: DatosContrato; modo: ModoContrato; quien: string;
  /* false: queda en borrador en PandaDoc (para mandarlo después). */
  mandar: boolean;
  config?: ConfigContratos;
  /* La dirección de la app (para la página de bienvenida después de firmar). */
  origen?: string | null;
}

export async function crearContrato(db: SupabaseClient, p: PedidoContrato): Promise<Contrato> {
  const plantillaElegida = plantillaDelContrato(p.programa, p.datos.reserva);
  if (!plantillaElegida.id) {
    throw new Error(p.datos.reserva
      ? `El programa ${p.programa.nombre} no tiene contrato de reserva (Ajustes → Integraciones → Programas).`
      : `El programa ${p.programa.nombre} no tiene plantilla de PandaDoc (Ajustes → Integraciones).`);
  }
  const id = nuevoId("ctr");
  /* El código de la página de bienvenida: al azar y largo (es lo único que la abre). */
  const bienvenida = randomBytes(24).toString("base64url");
  const fila: Partial<Contrato> = {
    id, ventaId: p.ventaId ?? null, sesionId: p.sesionId ?? null, leadId: p.leadId ?? null, alumnoId: p.alumnoId ?? null,
    programa: p.programa.id, plantillaId: plantillaElegida.id, plantillaNombre: plantillaElegida.nombre,
    modo: p.modo, estado: "creando",
    destinatario: { nombre: p.datos.nombre.trim(), email: p.datos.email.trim().toLowerCase(), telefono: p.datos.telefono.trim() },
    datos: p.datos, origen: "app", creadoPor: p.quien, creadoEn: ahora(), actualizadoEn: ahora(), bienvenida,
  };
  const ins = await db.from("contratos").insert(fila);
  if (ins.error) throw new Error(/contratos|PGRST205|42P01/.test(`${ins.error.code} ${ins.error.message}`)
    ? "Falta correr supabase/contratos-y-accesos.sql en la base." : `No se pudo guardar el contrato: ${ins.error.message}`);
  await evento(db, id, "creado", p.quien, "app", { programa: p.programa.nombre, modo: p.modo });

  try {
    /* Se lee la plantilla para mandar sólo las variables y los campos que tiene (si no se puede, van todas las variables). */
    const plantilla = await detallePlantilla(p.modo, plantillaElegida.id).catch(() => undefined);
    const doc = await crearDocumento(p.modo, cuerpoDocumento({
      contratoId: id, ventaId: p.ventaId, modo: p.modo, plantillaId: plantillaElegida.id, programa: p.programa.nombre, datos: p.datos, plantilla,
      despuesDeFirmar: paginaDeBienvenida(baseDeLaApp(p.origen), bienvenida),
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
export async function corregir(db: SupabaseClient, c: Contrato, datos: DatosContrato, quien: string, config?: ConfigContratos, origen?: string | null): Promise<void> {
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
    recipients: [destinatario(datos, paginaDeBienvenida(baseDeLaApp(origen), c.bienvenida))],
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
  /* El cambio de estado se escribe sólo si la fila sigue como la leímos: dos avisos juntos (el del documento y el
     del destinatario) no anotan dos veces «lo firmó». */
  let cambio = Boolean(cambios.estado);
  if (cambios.estado) {
    const r = await db.from("contratos").update({ ...cambios, actualizadoEn: ahora() }).eq("id", c.id).eq("estado", c.estado).select("id");
    cambio = Boolean(r.data?.length);
    if (!cambio) await guardar(db, c.id, { sincronizadoEn: ahora() });
  } else {
    await guardar(db, c.id, cambios);
  }
  if (cambio && cambios.estado && cambios.estado !== "borrador" && cambios.estado !== "creando") {
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
    } catch (e) {
      /* 409: PandaDoc todavía está generando el PDF. Lo trae el aviso «PDF listo» o la pasada de cada hora. */
      if (!(e instanceof ErrorPandadoc && e.status === 409)) console.error("[contratos] no se bajó el PDF", c.id, mensajeDe(e));
    }
  }

  const alumnoId = await alumnoDelContrato(db, c);
  if (alumnoId && c.alumnoId !== alumnoId) await guardar(db, c.id, { alumnoId });
  const { programas, config } = await programasGuardados(db);
  /* La reserva no toca la ficha ni da accesos: eso lo hace el contrato del programa cuando avanza. */
  await mandarBienvenida(db, c, alumnoId).catch((e) => console.error("[contratos] no salió el mail de bienvenida", c.id, mensajeDe(e)));
  if (c.datos.reserva) {
    if (!c.accesosEn) {
      await evento(db, c.id, "accesos", "Apicanta", "app", { dados: 0, motivo: "Es el contrato de la reserva: los accesos se dan con el contrato del programa." });
      await guardar(db, c.id, { accesosEn: ahora() });
    }
    return { accesos: null };
  }
  if (alumnoId && c.modo === "produccion") {
    const ficha = await db.from("seguimiento_alumnos").select("programas").eq("alumnoId", alumnoId).maybeSingle();
    const nombre = programaPorId(programas, c.programa)?.nombre ?? "";
    await cambiarFicha(db, alumnoId, fichaAlFirmar(c.datos, nombre, (ficha.data?.programas as string[] | null) ?? null))
      .catch((e) => console.error("[contratos] no se marcó la ficha", alumnoId, mensajeDe(e)));
    /* El servicio arranca cuando dice el contrato (puede ser una semana después del pago). */
    /* A las 12 de Argentina: «2026-10-26» a secas es la medianoche UTC, que en Argentina todavía es el 25. */
    const inicio = typeof c.datos.inicio === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.datos.inicio) ? `${c.datos.inicio}T15:00:00.000Z` : null;
    if (inicio) await db.from("alumnos").update({ inicio }).eq("id", alumnoId);
  }

  if (c.accesosEn) return { accesos: null };
  /* Los accesos solos se prenden con los contratos: con «prueba», sólo los de prueba; apagado, ninguno.
     No se marca nada: el día que se prendan, la próxima pasada los da. */
  const prendidos = accesosAlFirmar(config.estado, c.modo);
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

const DIAS_PARA_BIENVENIDA = 3;

/** El mail de bienvenida (Lili, 22/10): su roadmap según el perfil, el paso a paso de lo que compró, el formulario de los
    lunes y el WhatsApp de soporte. Sale una sola vez por contrato y sólo si está Resend (RESEND_API_KEY y RESEND_FROM);
    si no, el equipo lo copia desde la ficha (Servicio → Contrato). Nunca frena la firma: un error queda en el historial. */
export async function mandarBienvenida(db: SupabaseClient, c: Contrato, alumnoId: string | null): Promise<void> {
  const cfg = configResend();
  const para = (c.destinatario.email ?? c.datos.email ?? "").trim();
  if (!cfg || !para || c.bienvenidaMailEn) return;
  /* Sólo recién firmado: la pasada de cada hora vuelve a pasar por acá los contratos viejos a los que les falta el PDF o
     los accesos, y el día que se prenda Resend no les tiene que llegar la bienvenida a alumnos que ya arrancaron. */
  if (!c.firmadoEn || Date.now() - new Date(c.firmadoEn).getTime() > DIAS_PARA_BIENVENIDA * 86_400_000) return;
  let guia = guiaDeBienvenida({ reserva: c.datos.reserva, programa: c.programa, perfil: c.datos.perfil, config: await configBienvenida(db) });
  if (!guia) return;
  const origen = process.env.APP_URL?.trim() || baseDeLaApp(null);
  if (guia.modelo === "completo" && alumnoId && origen) {
    const codigo = await codigoDeAlumno(db, alumnoId).catch(() => null);
    if (codigo) guia = { ...guia, formulario: enlaceDeReporte(origen, codigo) };
  }
  /* Se marca ANTES de mandar: si dos avisos llegan juntos, sale uno solo. */
  const toma = await db.from("contratos").update({ bienvenidaMailEn: ahora() }).eq("id", c.id).is("bienvenidaMailEn", null).select("id");
  if (!toma.data?.length) return;
  const { asunto, texto } = textoDeBienvenida(guia);
  const r = await enviarPorResend(cfg, { para, asunto, texto, html: htmlDeBienvenida(texto) });
  if (!r.ok) {
    await db.from("contratos").update({ bienvenidaMailEn: null }).eq("id", c.id);
    await evento(db, c.id, "bienvenida", "Apicanta", "app", { enviado: false, error: r.error });
    return;
  }
  await db.from("contratos").update({ bienvenidaMailId: r.id }).eq("id", c.id);
  await evento(db, c.id, "bienvenida", "Apicanta", "app", { enviado: true, id: r.id, modelo: guia.modelo, perfil: guia.perfil });
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
  /* Uno armado por la app trae su id: su fila ya existe (o se está escribiendo). No es «de afuera». */
  const meta = (det.metadata ?? {}) as Record<string, unknown>;
  if (typeof meta.apicanta_contrato === "string" && meta.apicanta_contrato) return null;
  const plantilla = (det.template ?? {}) as { id?: string; name?: string };
  const { programas } = await programasGuardados(db);
  const programa = programas.find((p) => p.plantillaId && p.plantillaId === plantilla.id);
  const deReserva = programa ? null : programas.find((p) => p.plantillaReservaId && p.plantillaReservaId === plantilla.id);
  if (!programa && !deReserva) return null;
  const alumno = ((det.recipients ?? []) as { email?: string; first_name?: string; last_name?: string; phone?: string; role?: string }[])
    .find((r) => r.role === ROL_ALUMNO) ?? null;
  const email = (alumno?.email ?? "").trim().toLowerCase();
  const lead = email ? (await db.from("leads").select("id").ilike("email", email).limit(1).maybeSingle()).data?.id as string | undefined : undefined;
  const id = nuevoId("ctr");
  const elegido = (programa ?? deReserva)!;
  const ins = await db.from("contratos").insert({
    id, leadId: lead ?? null, programa: elegido.id, plantillaId: plantilla.id,
    plantillaNombre: plantilla.name ?? (programa ? elegido.plantillaNombre : elegido.plantillaReservaNombre ?? ""),
    documentoId, modo, estado: estadoDePandadoc(typeof det.status === "string" ? det.status : "") ?? "enviado", origen: "pandadoc", creadoPor: "PandaDoc",
    destinatario: { nombre: [alumno?.first_name, alumno?.last_name].filter(Boolean).join(" "), email, telefono: alumno?.phone ?? "" },
    datos: programa ? {} : { reserva: true }, enviadoEn: typeof det.date_sent === "string" ? det.date_sent : ahora(),
  });
  if (ins.error) return contratoPorDocumento(db, documentoId);
  await evento(db, id, "creado", "PandaDoc", "pandadoc", { motivo: "Se mandó a mano desde PandaDoc" });
  return contratoPorId(db, id);
}
