import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  accesosAlFirmar, cambiosDelFirmante, cuerpoDocumento, datosDelDocumento, destinatario, estadoDePandadoc, fichaAlFirmar, firmanteDelDocumento,
  firmoElAlumno, mensajeDelContrato, ROL_ALUMNO, type Contrato, type DatosContrato, type EstadoContrato, type EventoContrato, type ModoContrato,
} from "./contratos";
import {
  aBorrador, actualizarDocumento, anularDocumento, clavePandadoc, crearDocumento, detalleDocumento, detallePlantilla, editarDestinatario,
  enlaceDeFirma, ErrorPandadoc, esperarBorrador, mandarDocumento, pdfDocumento, recordarDocumento,
} from "./pandadoc-servidor";
import { cambiarFicha, darAccesos, type ResultadoAccesos } from "./accesos-servidor";
import { plantillaDelContrato, programaDePlantilla, programaPorId, programasDe, type Programa } from "./programas";
import type { ConfigContratos } from "./types";
import { conCodigoDelAlumno, esPerfil, guiaDeBienvenida, htmlDeBienvenida, perfilEfectivo, textoDeBienvenida, type ConfigBienvenida } from "./bienvenida-alumno";
import { codigoDeAlumno, configResend, enviarPorResend } from "./reporte-servidor";
import { diaDeNegocio } from "./dia-negocio";

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
  const plantillaElegida = plantillaDelContrato(p.programa, p.datos.reserva, p.datos.sesiones);
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
    await avisarSiEsElLimite(db, e, { nombre: p.datos.nombre, leadId: p.leadId ?? null, quien: p.quien });
    await avisarDelContrato(db, { id, creadoPor: p.quien, ventaId: p.ventaId ?? null, leadId: p.leadId ?? null, modo: p.modo, datos: p.datos, destinatario: { nombre: p.datos.nombre }, programa: p.programa.id }, "error", mensajeDe(e));
  }
  return (await contratoPorId(db, id))!;
}

/* El tope de documentos del plan de PandaDoc no lo arregla nadie desde la ficha: hay que ampliarlo en PandaDoc. Se les avisa a los
   dueños en la campanita (uno por día, aunque fallen varios), así no se enteran por el WhatsApp de quien no pudo mandarlo. */
export async function avisarSiEsElLimite(db: SupabaseClient, e: unknown, c: { nombre?: string | null; leadId?: string | null; quien?: string }): Promise<void> {
  if (!(e instanceof ErrorPandadoc) || e.motivo !== "limite") return;
  try {
    const r = await db.from("usuarios_permitidos").select("email").eq("rol", "dueno");
    const dia = diaDeNegocio(ahora()).replace(/-/g, "");
    const filas = ((r.data ?? []) as { email: string }[]).filter((d) => d.email).map((d) => ({
      id: `av_pandadoc_limite_${dia}_${createHash("sha1").update(d.email.toLowerCase()).digest("hex").slice(0, 10)}`,
      para: d.email.toLowerCase(), tipo: "pandadoc", titulo: "PandaDoc llegó al límite del plan",
      cuerpo: `No salió el contrato${c.nombre ? ` de ${c.nombre.trim()}` : ""}${c.quien ? ` (lo intentó ${c.quien})` : ""}. Para que los contratos vuelvan a salir desde la app hay que ampliar el uso de la API en PandaDoc; mientras tanto se mandan desde PandaDoc a mano y la app los toma solos.`,
      de: "PandaDoc", contactoId: c.leadId ?? null, persona: c.nombre?.trim() || null,
    }));
    if (filas.length) await db.from("avisos").upsert(filas, { onConflict: "id", ignoreDuplicates: true });
  } catch (err) { console.error("[contratos] no se pudo avisar del límite de PandaDoc", mensajeDe(err)); }
}

/* Quién se entera de cómo le fue a un contrato: quien lo mandó y el closer de la venta (puede ser otro: lo mandó Lili o un dueño). */
async function paraQuienEsElAviso(db: SupabaseClient, c: Pick<Contrato, "creadoPor" | "ventaId">): Promise<string[]> {
  const mails = new Set<string>();
  if (/@/.test(c.creadoPor ?? "")) mails.add(c.creadoPor.trim().toLowerCase());
  if (c.ventaId) {
    const v = await db.from("ventas").select("closerId").eq("id", c.ventaId).maybeSingle();
    const closerId = (v.data as { closerId?: string | null } | null)?.closerId;
    if (closerId) {
      const m = await db.from("equipo").select("email").eq("id", closerId).maybeSingle();
      const mail = (m.data as { email?: string | null } | null)?.email;
      if (mail) mails.add(mail.trim().toLowerCase());
    }
  }
  return [...mails];
}

/** La campanita de quien mandó el contrato (26/10, Mariano: «¿cómo me doy cuenta si lo hice bien o si llegó?»): avisa cuando NO salió —con
    el motivo y qué hacer— y cuando se firmó. Uno por contrato y por persona (volver a intentar no lo repite). Los de prueba no avisan. */
export async function avisarDelContrato(
  db: SupabaseClient, c: Pick<Contrato, "id" | "creadoPor" | "ventaId" | "leadId" | "modo" | "datos" | "destinatario" | "programa">,
  que: "error" | "firmado", motivo?: string,
): Promise<void> {
  if (c.modo !== "produccion") return;
  try {
    const para = await paraQuienEsElAviso(db, c);
    if (!para.length) return;
    const nombre = (c.destinatario?.nombre ?? c.datos?.nombre ?? "").trim() || "la persona";
    const filas = para.map((mail) => ({
      id: `av_contrato_${que}_${c.id}_${createHash("sha1").update(mail).digest("hex").slice(0, 8)}`,
      para: mail, tipo: "contrato", de: "Contratos", contactoId: c.leadId ?? null, persona: nombre === "la persona" ? null : nombre,
      ...(que === "error"
        ? {
          titulo: `El contrato de ${nombre} NO salió`,
          cuerpo: `${nombre} no recibió nada. Abrí su ficha y tocá «Volver a intentar». ${motivo ? `Motivo: ${motivo.slice(0, 220)}` : ""}`.trim(),
        }
        : { titulo: `${nombre} firmó el contrato`, cuerpo: "Ya figura firmado en su ficha." }),
    }));
    await db.from("avisos").upsert(filas, { onConflict: "id", ignoreDuplicates: true });
  } catch (err) { console.error("[contratos] no se pudo avisar del contrato", c.id, mensajeDe(err)); }
}

/** El link para firmar, para copiarlo y mandarlo por WhatsApp. Si no sale, el contrato sigue igual. */
async function refrescarEnlace(db: SupabaseClient, id: string, modo: ModoContrato, documentoId: string, email: string): Promise<void> {
  try {
    const e = await enlaceDeFirma(modo, documentoId, email);
    await guardar(db, id, { enlace: e.enlace, enlaceVence: e.vence });
  } catch (err) { console.error("[contratos] no salió el link para firmar", id, mensajeDe(err)); }
}

/* ---------- Lo que se le hace a uno que ya existe ---------- */

/** Manda el que quedó en borrador, o vuelve a intentar uno que no salió («Volver a intentar»): usa el MISMO documento que ya está
    en PandaDoc, así un reintento no gasta otro documento del plan (el 24/10 se gastaron cuatro probando «Mandar uno nuevo»). */
export async function mandarBorrador(db: SupabaseClient, c: Contrato, quien: string, config?: ConfigContratos): Promise<void> {
  if (!c.documentoId) throw new Error("Este contrato no llegó a PandaDoc: mandá uno nuevo.");
  try {
    if (c.estado === "error") {
      const estado = await esperarBorrador(c.modo, c.documentoId);
      if (estado !== "document.draft") throw new ErrorPandadoc(409, `Ese intento quedó en «${estado || "sin estado"}» en PandaDoc: mandá uno nuevo.`);
    }
    await mandarDocumento(c.modo, c.documentoId, mensajeDelContrato(config, c.datos, nombrePrograma(c)));
  } catch (e) {
    if (c.estado === "error") {
      await guardar(db, c.id, { error: mensajeDe(e) });
      await evento(db, c.id, "error", quien, "app", { error: mensajeDe(e), detalle: e instanceof ErrorPandadoc ? e.detalle : "", reintento: true });
    }
    await avisarSiEsElLimite(db, e, { nombre: c.destinatario?.nombre ?? c.datos?.nombre, leadId: c.leadId ?? null, quien });
    /* A quien lo mandó la primera vez (no a quien aprieta «Volver a intentar»): el aviso es del contrato, no del intento. */
    if (c.estado === "error") await avisarDelContrato(db, c, "error", mensajeDe(e));
    throw e;
  }
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
  const documentoId = c.documentoId;
  /* Cómo está de verdad en PandaDoc: si un intento anterior lo dejó en borrador, no se lo vuelve a pasar (contestaba 400
     «already in status 'draft'», Lili 23/10). Y desde que está en borrador, la ficha lo sabe. */
  const antes = await detalleDocumento(c.modo, documentoId);
  if (antes.status !== "document.draft") {
    await aBorrador(c.modo, documentoId);
    await guardar(db, c.id, { estado: "borrador" });
  }
  await esperarBorrador(c.modo, documentoId);
  const nombre = datos.nombre.trim();
  try {
    /* El documento sabe qué variables y campos tiene: se corrigen ésos. Al alumno no se lo manda de nuevo (por mail,
       PandaDoc lo suma como otro destinatario): si cambió su nombre o su mail, se lo edita por su id. */
    const actual = await detalleDocumento(c.modo, documentoId).catch(() => antes);
    const cuerpo = cuerpoDocumento({ contratoId: c.id, ventaId: c.ventaId, modo: c.modo, plantillaId: c.plantillaId, programa, datos, plantilla: actual });
    await actualizarDocumento(c.modo, documentoId, {
      name: `${c.modo === "prueba" ? "[Prueba] " : ""}Contrato ${programa} - ${nombre}`,
      tokens: cuerpo.tokens,
      ...(cuerpo.fields ? { fields: cuerpo.fields } : {}),
    });
    const firmante = firmanteDelDocumento(actual, c.destinatario.email);
    if (!firmante) throw new Error("No encuentro al alumno entre los firmantes del contrato en PandaDoc: anulalo y mandá uno nuevo.");
    const cambios: Record<string, unknown> = cambiosDelFirmante(firmante, datos) ?? {};
    /* Uno mandado a mano desde PandaDoc no tiene el redirect a su página de bienvenida: al corregirlo se le pone. */
    const pagina = c.origen === "pandadoc" && c.bienvenida ? paginaDeBienvenida(baseDeLaApp(origen), c.bienvenida) : null;
    if (pagina) cambios.redirect = { url: pagina, is_enabled: true };
    if (Object.keys(cambios).length) await editarDestinatario(c.modo, documentoId, firmante.id, cambios);
    await esperarBorrador(c.modo, documentoId);
    await mandarDocumento(c.modo, documentoId, mensajeDelContrato(config, datos, programa));
  } catch (e) {
    /* Quedó en borrador sin mandar: se anota con el motivo, y la ficha ofrece mandarlo o volver a corregirlo. */
    await guardar(db, c.id, { estado: "borrador", error: e instanceof Error ? e.message : "No se pudo corregir." });
    throw e;
  }
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
  let actual = (await contratoPorId(db, c.id))!;
  if (actual.origen === "pandadoc") actual = await completarDeAfuera(db, actual, det);
  actual = await vincular(db, actual);
  if (actual.estado === "firmado" && (!actual.accesosEn || !actual.pdfPath)) await alFirmar(db, actual);
  return (await contratoPorId(db, c.id))!;
}

/* ---------- Al firmar ---------- */

/** El PDF al bucket, «Firmado» en la ficha de Customer Success y los accesos del programa. Cada parte es independiente. */
export async function alFirmar(db: SupabaseClient, c: Contrato, opciones: { quien?: string; sinAccesos?: string } = {}): Promise<{ accesos: ResultadoAccesos | null }> {
  await avisarDelContrato(db, c, "firmado");
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
  /* Subido firmado a mano sin dar los accesos: queda anotado por qué y el botón «Dar los accesos» a la vista. */
  if (opciones.sinAccesos) {
    await eventoDeEspera(db, c.id, opciones.sinAccesos);
    return { accesos: null };
  }
  /* Los accesos solos se prenden con los contratos: con «prueba», sólo los de prueba; apagado, ninguno.
     No se marca nada: el día que se prendan, la próxima pasada los da. */
  const prendidos = accesosAlFirmar(config.estado, c.modo);
  if (!prendidos) return { accesos: null };
  const programa = programaPorId(programas, c.programa);
  /* Sin servicio todavía no se marca como hecho (hasta el 23/10 se marcaba y no se volvía a intentar): el equipo manda
     el contrato desde PandaDoc y carga la venta después, a veces horas más tarde. La pasada de cada hora lo vuelve a
     probar y los da apenas aparece el servicio; o el equipo aprieta «Dar los accesos». */
  if (!alumnoId || !programa) {
    await eventoDeEspera(db, c.id, alumnoId ? "El programa del contrato ya no existe en Ajustes."
      : c.origen === "manual" ? "Todavía no está cargado su servicio: cuando esté, tocá «Dar los accesos»." : ESPERA_SERVICIO);
    return { accesos: null };
  }
  /* Se marca ANTES de dar: si dos avisos llegan juntos, sólo uno da los accesos. */
  const toma = await db.from("contratos").update({ accesosEn: ahora() }).eq("id", c.id).is("accesosEn", null).select("id");
  if (!toma.data?.length) return { accesos: null };
  const r = await darAccesos(db, {
    alumnoId, contratoId: c.id, programa, origen: opciones.quien ? "manual" : "automatico", quien: opciones.quien ?? "Al firmar el contrato",
    persona: { nombre: c.destinatario.nombre ?? "", email: c.destinatario.email ?? "", telefono: c.destinatario.telefono },
  });
  await evento(db, c.id, "accesos", opciones.quien ?? "Apicanta", "app", { dados: r.dados, fallaron: r.fallaron, yaEstaban: r.yaEstaban });
  return { accesos: r };
}

const ESPERA_SERVICIO = "Todavía no está cargada su venta: los accesos se dan solos apenas se cargue (o con «Dar los accesos»).";

/** El «todavía no» de los accesos, una sola vez: la pasada de cada hora vuelve a pasar y no tiene que llenar el historial
    (antes quedaban dos iguales porque el aviso del documento y el del destinatario llegan juntos). */
async function eventoDeEspera(db: SupabaseClient, contratoId: string, motivo: string): Promise<void> {
  const ultimo = await db.from("contrato_eventos").select("detalle").eq("contratoId", contratoId).eq("evento", "accesos")
    .order("cuando", { ascending: false }).limit(1).maybeSingle();
  if ((ultimo.data?.detalle as { motivo?: unknown } | undefined)?.motivo === motivo) return;
  await evento(db, contratoId, "accesos", "Apicanta", "app", { dados: 0, motivo });
}

/** «Dar los accesos» desde la ficha: para el que firmó antes de que se cargara su venta, el que se subió sin darlos o
    los que quedaron marcados sin haber dado nada (los firmados antes del 23/10). Si ya se dio alguno, no se repite:
    para uno puntual está la solapa Accesos. */
export async function darAccesosAhora(db: SupabaseClient, c: Contrato, quien: string): Promise<ResultadoAccesos> {
  if (c.estado !== "firmado") throw new Error("Los accesos se dan cuando está firmado.");
  if (c.datos.reserva) throw new Error("Es el contrato de la reserva: los accesos se dan con el contrato del programa.");
  const { config } = await programasGuardados(db);
  if (!accesosAlFirmar(config.estado, c.modo)) throw new Error("Los accesos de los contratos están apagados (Ajustes → Integraciones).");
  const atado = await vincular(db, c);
  if (!(await alumnoDelContrato(db, atado))) throw new Error("Todavía no está cargada su venta (o su servicio): cargala y probá de nuevo.");
  if (atado.accesosEn) {
    const dados = await db.from("accesos_alumno").select("id", { count: "exact", head: true }).eq("contratoId", c.id);
    if ((dados.count ?? 0) > 0) throw new Error("Los accesos de este contrato ya se dieron: para uno puntual, usá la solapa Accesos.");
    /* Quedó marcado sin haber dado nada: se libera, con la misma condición que la toma (si otro lo hace a la vez, uno solo). */
    const libre = await db.from("contratos").update({ accesosEn: null }).eq("id", c.id).eq("accesosEn", atado.accesosEn).select("id");
    if (!libre.data?.length) throw new Error("Alguien más los está dando en este momento: actualizá en un minuto.");
  }
  const r = await alFirmar(db, (await contratoPorId(db, c.id))!, { quien });
  if (!r.accesos) {
    const ahoraEs = await contratoPorId(db, c.id);
    throw new Error(ahoraEs?.accesosEn ? "Los accesos ya se estaban dando." : "No se pudieron dar los accesos: mirá el historial del contrato.");
  }
  return r.accesos;
}

/** El perfil con el que sale la bienvenida de un contrato: el del contrato y, si el closer no lo cargó, el que tiene el
    alumno en su ficha de Servicio (Programa → Perfil). */
export async function perfilDelContrato(db: SupabaseClient, c: Pick<Contrato, "datos" | "alumnoId">, alumnoId?: string | null): Promise<string | null> {
  if (esPerfil(c.datos.perfil)) return c.datos.perfil;
  const id = alumnoId ?? c.alumnoId;
  if (!id) return null;
  const r = await db.from("seguimiento_alumnos").select("stack").eq("alumnoId", id).maybeSingle();
  return perfilEfectivo(c.datos.perfil, (r.data as { stack?: string } | null)?.stack);
}

/** Servicio completa el perfil de un contrato que el closer dejó sin cargar (Lili, 25/10). No toca PandaDoc ni el
    estado: el perfil sólo decide qué roadmap le llega al alumno, y sirve en cualquier estado (también firmado). */
export async function ponerPerfil(db: SupabaseClient, c: Contrato, perfil: string, quien: string): Promise<void> {
  if (!esPerfil(perfil)) throw new Error("Ese perfil no existe.");
  if (c.datos.perfil === perfil) return;
  await guardar(db, c.id, { datos: { ...c.datos, perfil } });
  await evento(db, c.id, "perfil", quien, "app", { antes: c.datos.perfil ?? null, despues: perfil });
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
  const config = await configBienvenida(db);
  let guia = guiaDeBienvenida({ reserva: c.datos.reserva, programa: c.programa, perfil: await perfilDelContrato(db, c, alumnoId), config });
  if (!guia) return;
  const origen = process.env.APP_URL?.trim() || baseDeLaApp(null);
  if (guia.modelo === "completo" && alumnoId && origen) {
    const codigo = await codigoDeAlumno(db, alumnoId).catch(() => null);
    guia = conCodigoDelAlumno(guia, origen, codigo);
  }
  /* Se marca ANTES de mandar: si dos avisos llegan juntos, sale uno solo. */
  const toma = await db.from("contratos").update({ bienvenidaMailEn: ahora() }).eq("id", c.id).is("bienvenidaMailEn", null).select("id");
  if (!toma.data?.length) return;
  const { asunto, texto } = textoDeBienvenida(guia, origen ? paginaDeBienvenida(origen, c.bienvenida) : null);
  const responderA = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config?.responderA ?? "") ? config!.responderA : undefined;
  const r = await enviarPorResend(cfg, { para, asunto, texto, html: htmlDeBienvenida(texto), responderA });
  if (!r.ok) {
    await db.from("contratos").update({ bienvenidaMailEn: null }).eq("id", c.id);
    await evento(db, c.id, "bienvenida", "Apicanta", "app", { enviado: false, error: r.error });
    return;
  }
  await db.from("contratos").update({ bienvenidaMailId: r.id }).eq("id", c.id);
  await evento(db, c.id, "bienvenida", "Apicanta", "app", { enviado: true, id: r.id, modelo: guia.modelo, perfil: guia.perfil });
}

/** El alumno del contrato: el que tiene guardado, el de su venta o el de su persona. */
export async function alumnoDelContrato(
  db: SupabaseClient, c: Pick<Contrato, "alumnoId" | "ventaId" | "leadId"> & Partial<Pick<Contrato, "destinatario" | "datos">>,
): Promise<string | null> {
  if (c.alumnoId) return c.alumnoId;
  if (c.ventaId) {
    const r = await db.from("alumnos").select("id").eq("ventaId", c.ventaId).limit(1).maybeSingle();
    if (r.data?.id) return r.data.id as string;
  }
  if (c.leadId) {
    const r = await db.from("alumnos").select("id").eq("leadId", c.leadId).order("creadoEn", { ascending: false }).limit(1).maybeSingle();
    if (r.data?.id) return r.data.id as string;
  }
  /* Por el mail con el que firmó: el servicio puede estar atado a otro lead de la misma persona. */
  const email = mailDelContrato(c);
  if (email) {
    const r = await db.from("alumnos").select("id").ilike("email", sinComodines(email)).order("creadoEn", { ascending: false }).limit(1).maybeSingle();
    if (r.data?.id) return r.data.id as string;
  }
  return null;
}

const mailDelContrato = (c: { destinatario?: Contrato["destinatario"]; datos?: Contrato["datos"] }) =>
  (c.destinatario?.email || c.datos?.email || "").trim().toLowerCase();
/* ilike con el mail tal cual: «_» y «%» son comodines. */
const sinComodines = (x: string) => x.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Lo ata a su persona, su servicio y su venta, con lo que falte. Hace falta para los que se mandan a mano desde
    PandaDoc (sólo traen el mail) y para los que firman antes de que se cargue la venta: sin venta ni servicio, el
    contrato no aparece en ninguna ficha. La venta es la del servicio o la última activa de esa persona, siempre desde
    un mes antes del contrato: una venta vieja es otra compra. */
export async function vincular(db: SupabaseClient, c: Contrato): Promise<Contrato> {
  if (c.leadId && c.alumnoId && c.ventaId) return c;
  const cambios: Partial<Contrato> = {};
  const email = mailDelContrato(c);
  let leadId = c.leadId;
  if (!leadId && email) {
    const r = await db.from("leads").select("id").ilike("email", sinComodines(email)).order("creadoEn", { ascending: false }).limit(1).maybeSingle();
    if (r.data?.id) leadId = cambios.leadId = r.data.id as string;
  }
  const alumnoId = c.alumnoId ?? await alumnoDelContrato(db, { ...c, leadId });
  type DelAlumno = { ventaId?: string | null; leadId?: string | null };
  let alumno: DelAlumno | null = null;
  if (alumnoId) {
    if (!c.alumnoId) cambios.alumnoId = alumnoId;
    alumno = (await db.from("alumnos").select("ventaId, leadId").eq("id", alumnoId).maybeSingle()).data as DelAlumno | null;
    if (!leadId && alumno?.leadId) leadId = cambios.leadId = alumno.leadId;
  }
  if (!c.ventaId) {
    const desde = new Date(new Date(c.creadoEn).getTime() - 31 * 86_400_000).toISOString();
    if (alumno?.ventaId) {
      const v = await db.from("ventas").select("id").eq("id", alumno.ventaId).gte("fecha", desde).maybeSingle();
      if (v.data?.id) cambios.ventaId = v.data.id as string;
    }
    if (!cambios.ventaId && leadId) {
      const v = await db.from("ventas").select("id").eq("contactoId", leadId).eq("estado", "activa").gte("fecha", desde)
        .order("fecha", { ascending: false }).limit(1).maybeSingle();
      if (v.data?.id) cambios.ventaId = v.data.id as string;
    }
  }
  if (!Object.keys(cambios).length) return c;
  await guardar(db, c.id, cambios);
  return { ...c, ...cambios };
}

/** Un contrato mandado a mano desde PandaDoc trae sólo lo que tiene el documento: se completa quién firma y sus datos
    (los que faltan; lo que se corrigió desde la app no se pisa). El aviso a veces llega cuando el documento todavía no
    tiene firmante (hasta el 23/10 quedaban sin mail y no se ataban a nada). */
async function completarDeAfuera(db: SupabaseClient, c: Contrato, det: Record<string, unknown>): Promise<Contrato> {
  const leido = datosDelDocumento(det);
  const cambios: Partial<Contrato> = {};
  const dest = {
    nombre: c.destinatario.nombre || leido.destinatario.nombre,
    email: c.destinatario.email || leido.destinatario.email,
    telefono: c.destinatario.telefono || leido.destinatario.telefono,
  };
  if (JSON.stringify(dest) !== JSON.stringify({ nombre: c.destinatario.nombre ?? "", email: c.destinatario.email ?? "", telefono: c.destinatario.telefono ?? "" })) {
    cambios.destinatario = dest;
  }
  const datos = { ...leido.datos, ...Object.fromEntries(Object.entries(c.datos).filter(([, x]) => x !== "" && x !== null && x !== undefined)) };
  if (JSON.stringify(datos) !== JSON.stringify(c.datos)) cambios.datos = datos;
  if (!c.bienvenida) cambios.bienvenida = randomBytes(24).toString("base64url");
  if (!Object.keys(cambios).length) return c;
  await guardar(db, c.id, cambios);
  return { ...c, ...cambios };
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
  /* La plantilla sin sesiones 1 a 1 es del programa (no de la reserva): el documento no trae el punto, así que son 0. */
  const reconocida = programaDePlantilla(programas, plantilla.id);
  if (!reconocida) return null;
  const programa = reconocida.tipo === "reserva" ? null : reconocida.programa;
  const deReserva = reconocida.tipo === "reserva" ? reconocida.programa : null;
  const leido = datosDelDocumento(det);
  const id = nuevoId("ctr");
  const elegido = (programa ?? deReserva)!;
  /* Uno armado a mano en PandaDoc es un contrato real, aunque lo haya traído el aviso de la clave de prueba (que ve
     el mismo espacio): hasta el 23/10 quedaban como «prueba» y al firmar no se marcaba la ficha. */
  const modoReal: ModoContrato = clavePandadoc("produccion") ? "produccion" : modo;
  const ins = await db.from("contratos").insert({
    id, programa: elegido.id, plantillaId: plantilla.id,
    plantillaNombre: plantilla.name ?? (programa ? elegido.plantillaNombre : elegido.plantillaReservaNombre ?? ""),
    documentoId, modo: modoReal, estado: estadoDePandadoc(typeof det.status === "string" ? det.status : "") ?? "enviado", origen: "pandadoc", creadoPor: "PandaDoc",
    destinatario: leido.destinatario, datos: { ...leido.datos, ...(programa ? {} : { reserva: true }), ...(reconocida.tipo === "sinSesiones" ? { sesiones: 0 } : {}) },
    enviadoEn: typeof det.date_sent === "string" ? det.date_sent : ahora(), bienvenida: randomBytes(24).toString("base64url"),
  });
  if (ins.error) return contratoPorDocumento(db, documentoId);
  await evento(db, id, "creado", "PandaDoc", "pandadoc", { motivo: "Se mandó a mano desde PandaDoc" });
  const c = await contratoPorId(db, id);
  return c ? vincular(db, c) : null;
}

/* ---------- Un contrato firmado fuera de PandaDoc ---------- */

export interface SubidaFirmado {
  ventaId: string | null; leadId: string | null; alumnoId: string | null;
  programa: Programa; datos: DatosContrato; pdf: Uint8Array;
  /* El día que lo firmó (2026-10-23). */
  fecha: string;
  quien: string;
  /* false: se anota firmado y se marca la ficha, pero los accesos los da el equipo después («Dar los accesos»). */
  darAccesos: boolean;
}

/** Subir el PDF de un contrato firmado en papel o por otro lado (como en Blue OS): queda firmado en la venta, con su
    PDF y su página de bienvenida, y corre lo mismo que al firmar en PandaDoc (la ficha y, si se pide, los accesos). */
export async function subirFirmado(db: SupabaseClient, p: SubidaFirmado): Promise<Contrato> {
  const id = nuevoId("ctr");
  const ruta = `${id}.pdf`;
  const up = await db.storage.from("contratos").upload(ruta, Buffer.from(p.pdf), { contentType: "application/pdf", upsert: false });
  if (up.error) throw new Error(`No se pudo guardar el PDF: ${up.error.message}`);
  /* A las 12 de Argentina, como el inicio: «2026-10-23» a secas es la medianoche UTC, que en Argentina es el 22. */
  const firmadoEn = `${p.fecha}T15:00:00.000Z`;
  const ins = await db.from("contratos").insert({
    id, ventaId: p.ventaId, leadId: p.leadId, alumnoId: p.alumnoId, programa: p.programa.id, plantillaId: "",
    plantillaNombre: p.programa.plantillaNombre || `Contrato ${p.programa.nombre}`, modo: "produccion", estado: "firmado", origen: "manual",
    destinatario: { nombre: p.datos.nombre, email: p.datos.email, telefono: p.datos.telefono }, datos: p.datos,
    pdfPath: ruta, firmadoEn, creadoPor: p.quien, creadoEn: ahora(), actualizadoEn: ahora(), bienvenida: randomBytes(24).toString("base64url"),
  });
  if (ins.error) {
    await db.storage.from("contratos").remove([ruta]);
    throw new Error(/origen/.test(ins.error.message) ? "Falta correr supabase/contratos-a-mano.sql en la base." : `No se pudo guardar el contrato: ${ins.error.message}`);
  }
  await evento(db, id, "subido", p.quien, "app", { programa: p.programa.nombre, firmado: p.fecha });
  const c = await vincular(db, (await contratoPorId(db, id))!);
  await alFirmar(db, c, p.darAccesos ? { quien: p.quien } : { sinAccesos: "Se subió firmado sin dar los accesos: se dan con «Dar los accesos»." });
  return (await contratoPorId(db, id))!;
}
