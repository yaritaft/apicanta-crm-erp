import type { ConfigContratos } from "./types";

/* ==================================================================
   Los contratos de PandaDoc, lo que no depende de la red. Es el circuito
   del contrato de Blue OS (que usa Docusign) traído a PandaDoc, pedido
   por Juan Cruz el 20/10:

   - Sale desde la carga de la venta (o desde la ficha): el closer pone los
     datos del alumno, la modalidad de pago, las sesiones 1 a 1 y los bonos,
     y eso va a la plantilla del programa como VARIABLES de PandaDoc
     ([Cliente.Nombre], [Venta.Modalidad]…). La firma de Yari está fija en
     la plantilla: firma sólo el alumno (rol «Client»).
   - Queda atado a su venta, su llamada, la persona y el servicio, con su
     estado (enviado, lo abrió, firmado, rechazado, anulado) y su historial.
   - El estado lo dice PandaDoc (aviso firmado con HMAC + una pasada cada
     hora por los pendientes). Ante cada aviso se le vuelve a preguntar el
     estado al documento: los avisos llegan desordenados o repetidos, y un
     «enviado» atrasado no puede pisar un «firmado».
   - Al firmar se dan los accesos del programa (lib/accesos-servidor.ts).
   ================================================================== */

export type EstadoContrato = "creando" | "borrador" | "enviado" | "visto" | "firmado" | "rechazado" | "anulado" | "error";
export type ModoContrato = "produccion" | "prueba";

/* Lo que va en el contrato. Lo carga el closer (sale del lead y se corrige). */
export interface DatosContrato {
  nombre: string;
  email: string;
  telefono: string;
  documento: string;
  domicilio: string;
  pais: string;
  /* «Un pago único de 2.500 USD», «Tres pagos de 1.000 USD»… (sale del plan de la venta). */
  modalidad: string;
  /* Sesiones 1 a 1 con el mentor (0 a 3, lo acordado en la llamada). */
  sesiones: number | null;
  bonos: string[];
  /* El día del contrato (2026-10-20). */
  fecha: string;
}

export interface Contrato {
  id: string;
  ventaId: string | null;
  sesionId: string | null;
  leadId: string | null;
  alumnoId: string | null;
  programa: string;
  plantillaId: string;
  plantillaNombre: string;
  documentoId: string | null;
  modo: ModoContrato;
  estado: EstadoContrato;
  destinatario: { nombre?: string; email?: string; telefono?: string };
  datos: Partial<DatosContrato>;
  enlace: string | null;
  enlaceVence: string | null;
  pdfPath: string | null;
  enviadoEn: string | null;
  vistoEn: string | null;
  firmadoEn: string | null;
  rechazadoEn: string | null;
  anuladoEn: string | null;
  accesosEn: string | null;
  origen: "app" | "pandadoc";
  error: string | null;
  creadoEn: string;
  creadoPor: string;
  actualizadoEn: string;
  sincronizadoEn: string | null;
}

export interface EventoContrato {
  id: string;
  contratoId: string;
  evento: string;
  detalle: Record<string, unknown>;
  cuando: string;
  quien: string;
  origen: "app" | "pandadoc" | "sincronizacion";
}

export const ROTULO_ESTADO: Record<EstadoContrato, { texto: string; tono: "neutral" | "info" | "warning" | "success" | "danger" }> = {
  creando: { texto: "Armándose", tono: "neutral" },
  borrador: { texto: "Sin mandar", tono: "neutral" },
  enviado: { texto: "Enviado", tono: "info" },
  visto: { texto: "Lo abrió", tono: "warning" },
  firmado: { texto: "Firmado", tono: "success" },
  rechazado: { texto: "Lo rechazó", tono: "danger" },
  anulado: { texto: "Anulado", tono: "neutral" },
  error: { texto: "No salió", tono: "danger" },
};

/* Los eventos del historial, en palabras. */
export const ROTULO_EVENTO: Record<string, string> = {
  creado: "Se armó el contrato",
  enviado: "Se mandó para firmar",
  visto: "Lo abrió",
  firmado: "Lo firmó",
  rechazado: "Lo rechazó",
  anulado: "Se anuló",
  reenviado: "Se le reenvió",
  corregido: "Se corrigió y se mandó de nuevo",
  enlace: "Se generó el link para firmar",
  accesos: "Se dieron los accesos",
  error: "No salió",
};

/** Nuestro estado ← el de PandaDoc. null: un estado que no cambia nada. */
export function estadoDePandadoc(status: string | null | undefined): EstadoContrato | null {
  switch ((status ?? "").trim()) {
    case "document.uploaded": return "creando";
    case "document.draft": return "borrador";
    case "document.sent":
    case "document.waiting_approval":
    case "document.approved":
    case "document.rejected":
    case "document.external_review":
    case "document.waiting_pay":
      return "enviado";
    case "document.viewed": return "visto";
    case "document.completed":
    case "document.paid":
      return "firmado";
    case "document.declined": return "rechazado";
    case "document.voided":
    case "document.deleted":
      return "anulado";
    default: return null;
  }
}

/* ---------- Lo que va en la plantilla ---------- */

const NUMEROS = ["", "Un", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho", "Nueve", "Diez", "Once", "Doce"];

export function montoContrato(n: number, moneda = "USD"): string {
  const entero = Math.abs(n - Math.round(n)) < 0.005;
  return `${n.toLocaleString("es-AR", { minimumFractionDigits: entero ? 0 : 2, maximumFractionDigits: 2 })} ${moneda}`;
}

/** La modalidad de pago en palabras, a partir del plan de cuotas de la venta. */
export function modalidadDeCuotas(cuotas: { monto: number; esReserva?: boolean }[], moneda = "USD"): string {
  const conMonto = cuotas.filter((c) => c.monto > 0);
  if (conMonto.length === 0) return "";
  if (conMonto.length === 1) return `Un pago único de ${montoContrato(conMonto[0].monto, moneda)}`;
  const reserva = conMonto[0].esReserva ? conMonto[0] : null;
  const resto = reserva ? conMonto.slice(1) : conMonto;
  const iguales = resto.every((c) => Math.abs(c.monto - resto[0].monto) < 0.005);
  const cuantos = (n: number) => (NUMEROS[n] ?? String(n));
  const pagos = iguales
    ? resto.length === 1
      ? `un pago de ${montoContrato(resto[0].monto, moneda)}`
      : `${cuantos(resto.length).toLowerCase()} pagos de ${montoContrato(resto[0].monto, moneda)}`
    : `pagos de ${resto.map((c) => montoContrato(c.monto, moneda)).join(", ").replace(/, ([^,]*)$/, " y $1")}`;
  if (reserva) return `Una reserva de ${montoContrato(reserva.monto, moneda)} y ${pagos}`;
  return pagos.charAt(0).toUpperCase() + pagos.slice(1);
}

export function textoSesiones(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  if (n <= 0) return "Sin sesiones 1 a 1 con el mentor";
  return n === 1 ? "1 sesión 1 a 1 con el mentor" : `${n} sesiones 1 a 1 con el mentor`;
}

export function textoBonos(bonos: string[] | undefined): string {
  const xs = (bonos ?? []).map((b) => b.trim()).filter(Boolean);
  if (xs.length === 0) return "Sin bonos adicionales";
  return xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

/** 2026-10-20 → 20/10/2026. */
export function fechaContrato(iso: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** Las variables de la plantilla (los [Corchetes] de PandaDoc). Una que la plantilla no tiene se ignora. */
export function variablesDelContrato(d: Partial<DatosContrato>, programa: string): { name: string; value: string }[] {
  return [
    ["Cliente.Nombre", d.nombre ?? ""],
    ["Cliente.Documento", d.documento ?? ""],
    ["Cliente.Domicilio", d.domicilio ?? ""],
    ["Cliente.Email", d.email ?? ""],
    ["Cliente.Telefono", d.telefono ?? ""],
    ["Cliente.Pais", d.pais ?? ""],
    ["Contrato.Fecha", fechaContrato(d.fecha)],
    ["Venta.Modalidad", d.modalidad ?? ""],
    ["Venta.Sesiones", textoSesiones(d.sesiones)],
    ["Venta.Bonos", textoBonos(d.bonos)],
    ["Programa.Nombre", programa],
  ].map(([name, value]) => ({ name, value: value.trim() }));
}

/** Lo que la plantilla sabe recibir: las variables ([Cliente.Nombre]) y los campos con «merge field»
    (Cliente.Nombre). Manu puede armar cada plantilla de cualquiera de las dos formas: se llena lo que haya. */
export function relleno(variables: { name: string; value: string }[], plantilla: unknown, fecha?: string): {
  tokens: { name: string; value: string }[]; fields: Record<string, { value: string }>;
} {
  const d = (plantilla && typeof plantilla === "object" ? plantilla : {}) as Record<string, unknown>;
  const tokensDe = new Set((Array.isArray(d.tokens) ? d.tokens : []).map((t) => String((t as { name?: unknown })?.name ?? "")).filter(Boolean));
  const campos = new Map<string, string>();
  for (const f of Array.isArray(d.fields) ? d.fields : []) {
    const o = (f ?? {}) as { merge_field?: unknown; type?: unknown };
    if (typeof o.merge_field === "string" && o.merge_field) campos.set(o.merge_field, typeof o.type === "string" ? o.type : "text");
  }
  const fields: Record<string, { value: string }> = {};
  for (const v of variables) {
    const tipo = campos.get(v.name);
    if (!tipo || !v.value) continue;
    /* Un campo de fecha recibe el día en ISO; el formato lo pone la plantilla. */
    fields[v.name] = { value: tipo === "date" ? (fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? `${fecha}T12:00:00.000Z` : v.value) : v.value };
  }
  return { tokens: variables.filter((v) => tokensDe.has(v.name)), fields };
}

/** «María José Pérez» → nombre «María José», apellido «Pérez» (PandaDoc los pide por separado). */
export function partirNombre(nombre: string): { first_name: string; last_name: string } {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 1) return { first_name: partes[0] ?? "", last_name: "" };
  return { first_name: partes.slice(0, -1).join(" "), last_name: partes[partes.length - 1] };
}

export const ROL_ALUMNO = "Client";

/** El cuerpo para crear el documento desde la plantilla. */
export function cuerpoDocumento(a: {
  contratoId: string; ventaId?: string | null; modo: ModoContrato;
  plantillaId: string; programa: string; datos: Partial<DatosContrato>;
  /* El detalle de la plantilla: con él se mandan sólo las variables y campos que tiene. Sin él, todas las variables. */
  plantilla?: unknown;
}): Record<string, unknown> {
  const nombre = (a.datos.nombre ?? "").trim();
  const variables = variablesDelContrato(a.datos, a.programa);
  const r = a.plantilla ? relleno(variables, a.plantilla, a.datos.fecha) : { tokens: variables, fields: {} };
  return {
    name: `${a.modo === "prueba" ? "[Prueba] " : ""}Contrato ${a.programa} - ${nombre}`.trim(),
    template_uuid: a.plantillaId,
    recipients: [{
      email: (a.datos.email ?? "").trim(), ...partirNombre(nombre), role: ROL_ALUMNO,
      ...(a.datos.telefono?.trim() ? { phone: a.datos.telefono.trim() } : {}),
    }],
    tokens: r.tokens,
    ...(Object.keys(r.fields).length ? { fields: r.fields } : {}),
    metadata: { apicanta_contrato: a.contratoId, apicanta_venta: a.ventaId ?? "", apicanta_modo: a.modo },
    tags: ["apicanta", a.modo === "prueba" ? "apicanta-prueba" : "apicanta-produccion"],
  };
}

/** El asunto y el mensaje del mail de PandaDoc, con {nombre} y {programa} reemplazados. */
export function mensajeDelContrato(config: ConfigContratos | undefined, d: Partial<DatosContrato>, programa: string): { subject: string; message: string } {
  const pila = (d.nombre ?? "").trim().split(/\s+/)[0] ?? "";
  const poner = (t: string) => t.replace(/\{nombre\}/g, pila).replace(/\{programa\}/g, programa);
  return {
    subject: poner(config?.asunto?.trim() || "Tu contrato de {programa} para firmar"),
    message: poner(config?.mensaje?.trim()
      || "Hola {nombre}, te mandamos el contrato de {programa} para que lo firmes. Apenas lo firmes te llegan los accesos. ¡Bienvenido!"),
  };
}

/* ---------- Qué se puede hacer con cada contrato ---------- */

export type AccionContrato = "copiar-enlace" | "reenviar" | "corregir" | "anular" | "mandar" | "mandar-otro" | "ver-pdf" | "sincronizar";

/** Los botones según el estado. No se ofrece lo que PandaDoc va a negar: un firmado no se anula ni se reenvía. */
export function accionesDe(c: Pick<Contrato, "estado" | "documentoId">): AccionContrato[] {
  const conDoc = Boolean(c.documentoId);
  switch (c.estado) {
    case "creando": return conDoc ? ["sincronizar"] : [];
    case "borrador": return conDoc ? ["mandar", "corregir", "anular"] : ["mandar-otro"];
    case "enviado":
    case "visto": return ["copiar-enlace", "reenviar", "corregir", "anular", "sincronizar"];
    case "firmado": return ["ver-pdf"];
    case "rechazado":
    case "anulado":
    case "error": return ["mandar-otro"];
  }
}

/** ¿Este contrato todavía espera algo de PandaDoc? (la tarjeta se refresca sola mientras tanto). */
export const estaPendiente = (estado: EstadoContrato) => estado === "creando" || estado === "enviado" || estado === "visto";

/** Lo que falta para poder mandarlo. null: se puede. */
export function problemaDeDatos(d: Partial<DatosContrato>, modo: ModoContrato, dominioPrueba = "apicanta.com"): string | null {
  if (!d.nombre?.trim()) return "Falta el nombre completo del alumno.";
  const email = (d.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Falta un mail válido: es adonde le llega el contrato.";
  if (modo === "prueba" && !email.endsWith(`@${dominioPrueba}`)) {
    return `Un contrato de prueba sólo puede ir a un mail @${dominioPrueba} (así lo pide PandaDoc con la clave sandbox).`;
  }
  if (!d.documento?.trim()) return "Falta el documento (DNI, pasaporte o el que tenga).";
  if (!d.domicilio?.trim()) return "Falta el domicilio.";
  return null;
}

/* ---------- El aviso de PandaDoc ---------- */

export interface AvisoPandadoc {
  evento: string;
  documentoId: string;
  estado: string;
  plantillaId: string | null;
  metadata: Record<string, string>;
  /* En recipient_completed: quién completó. */
  quien: string | null;
}

/** El aviso llega como lista de eventos ({ event, data }). Lo que no se entiende, se descarta. */
export function leerAvisos(cuerpo: unknown): AvisoPandadoc[] {
  const lista = Array.isArray(cuerpo) ? cuerpo : cuerpo ? [cuerpo] : [];
  return lista.flatMap((x): AvisoPandadoc[] => {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const data = (o.data && typeof o.data === "object" ? o.data : {}) as Record<string, unknown>;
    const id = typeof data.id === "string" ? data.id : "";
    if (!id) return [];
    const meta = (data.metadata && typeof data.metadata === "object" ? data.metadata : {}) as Record<string, unknown>;
    const plantilla = (data.template && typeof data.template === "object" ? data.template : {}) as Record<string, unknown>;
    const accion = (data.action_by && typeof data.action_by === "object" ? data.action_by : {}) as Record<string, unknown>;
    return [{
      evento: typeof o.event === "string" ? o.event : "",
      documentoId: id,
      estado: typeof data.status === "string" ? data.status : "",
      plantillaId: typeof plantilla.id === "string" ? plantilla.id : null,
      metadata: Object.fromEntries(Object.entries(meta).filter(([, v]) => typeof v === "string")) as Record<string, string>,
      quien: typeof accion.email === "string" ? accion.email : null,
    }];
  });
}

/** Del detalle del documento: ¿el alumno ya firmó? (antes de que firme el resto, si la plantilla tiene otro firmante). */
export function firmoElAlumno(detalle: unknown): boolean {
  const d = (detalle && typeof detalle === "object" ? detalle : {}) as Record<string, unknown>;
  if (d.status === "document.completed" || d.status === "document.paid") return true;
  const recipients = Array.isArray(d.recipients) ? d.recipients : [];
  return recipients.some((r) => {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    return o.role === ROL_ALUMNO && o.has_completed === true;
  });
}
