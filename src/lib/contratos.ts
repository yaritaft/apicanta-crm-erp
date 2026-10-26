import type { ConfigContratos } from "./types";
import { esPerfil, modeloDeBienvenida, PERFILES, type GuiaBienvenida } from "./bienvenida-alumno";
import { diaDeNegocio } from "./dia-negocio";
import { fechaHora, relativo } from "./format";

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
  /* Cuándo arranca el servicio (Manu, 20/10: «si hoy paga y quiere empezar en una semana, va la fecha de una
     semana adelante»). Sin dato, el día del contrato. Al firmar pasa a ser el inicio del alumno. */
  inicio?: string;
  /* El contrato de la reserva (Manu, 21/10): sale con la plantilla de reserva del programa, la modalidad es el
     monto que deja a cuenta («300 USD») y al firmarlo no se dan accesos (los da el contrato del programa). */
  reserva?: boolean;
  /* El perfil del alumno, que carga el closer (Lili, 22/10): Full Stack, Mobile Developer, Data Engineer o AI Engineer.
     Con eso le llega su roadmap al firmar (lib/bienvenida-alumno.ts). */
  perfil?: string;
  /* La fecha de nacimiento (aaaa-mm-dd), opcional (Juan Cruz, 24/10): no va al documento; pasa sola a la ficha del alumno
     (supabase/contrato-completa-ficha.sql) y de ahí sale su edad. */
  nacimiento?: string;
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
  /* app: lo armó la app · pandadoc: se mandó a mano desde PandaDoc y lo encontró el aviso · manual: firmado fuera de
     PandaDoc, con el PDF subido desde la ficha (supabase/contratos-a-mano.sql). */
  origen: "app" | "pandadoc" | "manual";
  error: string | null;
  creadoEn: string;
  creadoPor: string;
  actualizadoEn: string;
  sincronizadoEn: string | null;
  /* El código de su página de bienvenida (/bienvenida/<código>): PandaDoc manda ahí al alumno apenas firma. */
  bienvenida?: string | null;
  /* El mail de bienvenida con su roadmap (lib/bienvenida-alumno.ts): cuándo salió y su id en Resend. Sale una sola vez.
     Columnas de supabase/bienvenida-mail.sql. */
  bienvenidaMailEn?: string | null;
  bienvenidaMailId?: string | null;
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
  subido: "Se subió firmado a mano",
  plantilla: "La plantilla no lleva lo que se cargó",
  error: "No salió",
};

/** El rótulo de un paso del historial. Un aviso de accesos que no dio nada (esperaba la venta, la reserva…) no dice
    «Se dieron los accesos». */
export function rotuloEvento(ev: Pick<EventoContrato, "evento" | "detalle">): string {
  const d = ev.detalle ?? {};
  if (ev.evento === "accesos" && Number(d.dados ?? 0) === 0 && !Number(d.fallaron ?? 0) && !Number(d.yaEstaban ?? 0) && typeof d.motivo === "string" && d.motivo) {
    return "Los accesos todavía no se dieron";
  }
  return ROTULO_EVENTO[ev.evento] ?? ev.evento;
}

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

/** Los datos del contrato como llegan de la pantalla, limpios (textos recortados, mail en minúscula, fechas válidas). */
export function datosLimpios(d: Partial<DatosContrato> | undefined): DatosContrato {
  const t = (x: unknown) => (typeof x === "string" ? x.trim() : "");
  return {
    nombre: t(d?.nombre), email: t(d?.email).toLowerCase(), telefono: t(d?.telefono), documento: t(d?.documento),
    domicilio: t(d?.domicilio), pais: t(d?.pais), modalidad: t(d?.modalidad),
    sesiones: typeof d?.sesiones === "number" && Number.isFinite(d.sesiones) ? Math.max(0, Math.round(d.sesiones)) : null,
    bonos: Array.isArray(d?.bonos) ? d!.bonos!.map(t).filter(Boolean) : [],
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(t(d?.fecha)) ? t(d?.fecha) : diaDeNegocio(new Date().toISOString()),
    inicio: /^\d{4}-\d{2}-\d{2}$/.test(t(d?.inicio)) ? t(d?.inicio) : undefined,
    ...(d?.reserva === true ? { reserva: true } : {}),
    ...(esPerfil(d?.perfil) ? { perfil: d.perfil } : {}),
    ...(nacimientoValido(t(d?.nacimiento)) ? { nacimiento: t(d?.nacimiento) } : {}),
  };
}

/** Una fecha de nacimiento creíble: un día real, no en el futuro y de alguien de 10 a 99 años. */
export function nacimientoValido(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(`${v}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return false;
  const anio = Number(m[1]), hoy = diaDeNegocio(new Date().toISOString());
  return v <= hoy && Number(hoy.slice(0, 4)) - anio >= 10 && Number(hoy.slice(0, 4)) - anio <= 100;
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

/** Lo que va en [Venta.Modalidad] del contrato de la reserva: sólo el monto («300 USD»). */
export function modalidadDeReserva(monto: number, moneda = "USD"): string {
  return monto > 0 ? montoContrato(monto, moneda) : "";
}

/* Lo que va en [Venta.Sesiones]. Las sesiones valen sólo los primeros 3 meses del programa y después se pierden
   (Lili, 21/10, como decía el contrato viejo); va en el texto de cada opción y no fijo en la plantilla, porque
   quedaría raro cuando no hay sesiones (Manu). Y «No incluye» cuando no se dieron (Yari). */
export function textoSesiones(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  if (n <= 0) return "No incluye sesiones 1 a 1 con el mentor";
  return n === 1
    ? "1 sesión 1 a 1 con el mentor, válida durante los primeros 3 meses del programa"
    : `${n} sesiones 1 a 1 con el mentor, válidas durante los primeros 3 meses del programa`;
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
    ["Contrato.Inicio", fechaContrato(d.inicio || d.fecha)],
    ["Venta.Modalidad", d.modalidad ?? ""],
    ["Venta.Sesiones", textoSesiones(d.sesiones)],
    ["Venta.Bonos", textoBonos(d.bonos)],
    /* Si la plantilla la tiene, el perfil queda en el documento y vuelve al leer uno mandado a mano (SERVICIO, 23/10). */
    ["Cliente.Perfil", d.perfil ?? ""],
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
    const dia = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.value);
    const iso = dia ? `${dia[3]}-${dia[2]}-${dia[1]}` : fecha;
    fields[v.name] = { value: tipo === "date" ? (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00.000Z` : v.value) : v.value };
  }
  return { tokens: variables.filter((v) => tokensDe.has(v.name)), fields };
}

/* Las variables sin las que una plantilla no puede llevar lo que el closer cargó: si la plantilla las tiene escritas a mano («Un pago único de
   500 USD»), el contrato sale con ese texto aunque la venta sea de otro monto (Manu, 26/10: el Downsell era el único sin [Venta.Modalidad] y los
   closers, que ya no venden siempre a 500, lo editaban a mano en PandaDoc). */
export const VARIABLES_CLAVE: { nombre: string; para: string }[] = [
  { nombre: "Venta.Modalidad", para: "el monto y la forma de pago" },
  { nombre: "Cliente.Nombre", para: "el nombre del alumno" },
  { nombre: "Cliente.Documento", para: "el documento del alumno" },
  { nombre: "Cliente.Domicilio", para: "el domicilio del alumno" },
  { nombre: "Contrato.Fecha", para: "la fecha del contrato" },
];

/** Cuáles de esas variables (o de `nombres`) la plantilla NO tiene, ni como [variable] ni como campo con merge field. Una plantilla que no
    se pudo leer no dice nada: [] (no se avisa de lo que no se sabe). La API lista de más las variables que se borraron del texto, pero no
    inventa que falta una que está: lo que dice que falta, falta. */
export function variablesQueFaltan(plantilla: unknown, nombres: readonly string[] = VARIABLES_CLAVE.map((v) => v.nombre)): string[] {
  if (!plantilla || typeof plantilla !== "object") return [];
  const d = plantilla as Record<string, unknown>;
  if (!Array.isArray(d.tokens) && !Array.isArray(d.fields)) return [];
  const tiene = new Set<string>();
  for (const t of Array.isArray(d.tokens) ? d.tokens : []) { const n = (t as { name?: unknown })?.name; if (typeof n === "string") tiene.add(n); }
  for (const f of Array.isArray(d.fields) ? d.fields : []) { const n = (f as { merge_field?: unknown })?.merge_field; if (typeof n === "string") tiene.add(n); }
  return nombres.filter((n) => !tiene.has(n));
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
  /* Adonde va el alumno apenas firma (la página de bienvenida con sus accesos). */
  despuesDeFirmar?: string | null;
}): Record<string, unknown> {
  const nombre = (a.datos.nombre ?? "").trim();
  const variables = variablesDelContrato(a.datos, a.programa);
  const r = a.plantilla ? relleno(variables, a.plantilla, a.datos.fecha) : { tokens: variables, fields: {} };
  return {
    name: `${a.modo === "prueba" ? "[Prueba] " : ""}Contrato ${a.programa} - ${nombre}`.trim(),
    template_uuid: a.plantillaId,
    recipients: [destinatario(a.datos, a.despuesDeFirmar)],
    tokens: r.tokens,
    ...(Object.keys(r.fields).length ? { fields: r.fields } : {}),
    metadata: { apicanta_contrato: a.contratoId, apicanta_venta: a.ventaId ?? "", apicanta_modo: a.modo },
    tags: ["apicanta", a.modo === "prueba" ? "apicanta-prueba" : "apicanta-produccion"],
  };
}

/** El alumno como destinatario de PandaDoc: firma como «Client» y, si hay página de bienvenida, va ahí al terminar. */
export function destinatario(d: Partial<DatosContrato>, despuesDeFirmar?: string | null): Record<string, unknown> {
  const nombre = (d.nombre ?? "").trim();
  return {
    email: (d.email ?? "").trim(), ...partirNombre(nombre), role: ROL_ALUMNO,
    ...(d.telefono?.trim() ? { phone: d.telefono.trim() } : {}),
    ...(despuesDeFirmar ? { redirect: { url: despuesDeFirmar, is_enabled: true } } : {}),
  };
}

/* ---------- Corregir un documento ya mandado ----------
   Lili (23/10): corregir el de Santiago Ayala Restrepo (de 0 a 2 sesiones) daba «PandaDoc contestó 400». Al corregir se
   mandaba otra vez al alumno por mail, y PandaDoc lo toma como un destinatario NUEVO («already in recipients list»); el
   documento quedaba en borrador y cada reintento lo volvía a pasar a borrador («already in status 'draft'»). Ahora al
   alumno se lo busca en el documento y, si cambió su nombre o su mail, se lo edita por su id. */

export interface FirmanteDelDocumento { id: string; email: string; first_name?: string; last_name?: string }

/** El alumno entre los destinatarios del documento: el de rol «Client» o, si no, el que tiene su mail. Los CC no firman. */
export function firmanteDelDocumento(detalle: unknown, email?: string | null): FirmanteDelDocumento | null {
  const d = (detalle && typeof detalle === "object" ? detalle : {}) as { recipients?: unknown };
  const lista = (Array.isArray(d.recipients) ? d.recipients : []) as Record<string, unknown>[];
  const firmantes = lista.filter((r) => typeof r.id === "string" && String(r.recipient_type ?? "signer").toLowerCase() !== "cc");
  const mail = (email ?? "").trim().toLowerCase();
  const r = firmantes.find((x) => x.role === ROL_ALUMNO) ?? firmantes.find((x) => String(x.email ?? "").toLowerCase() === mail) ?? (firmantes.length === 1 ? firmantes[0] : undefined);
  return r ? { id: String(r.id), email: String(r.email ?? ""), first_name: r.first_name ? String(r.first_name) : undefined, last_name: r.last_name ? String(r.last_name) : undefined } : null;
}

/** Lo que hay que cambiarle al alumno en el documento (nombre o mail), o null si está igual. */
export function cambiosDelFirmante(f: FirmanteDelDocumento, d: Partial<DatosContrato>): Record<string, string> | null {
  const { first_name, last_name } = partirNombre((d.nombre ?? "").trim());
  const email = (d.email ?? "").trim();
  const cambios: Record<string, string> = {};
  if (email && email.toLowerCase() !== f.email.trim().toLowerCase()) cambios.email = email;
  if (first_name && first_name !== (f.first_name ?? "")) cambios.first_name = first_name;
  if (last_name !== (f.last_name ?? "") && (first_name || last_name)) cambios.last_name = last_name;
  return Object.keys(cambios).length ? cambios : null;
}

/* ---------- La página de bienvenida ---------- */

export interface AccesoParaBienvenida {
  plataforma: "wisboo" | "telegram" | "zoom";
  estado: "pendiente" | "dado" | "entro" | "fallo" | "quitado";
  recursoNombre: string;
  externo: Record<string, unknown>;
}

export interface Bienvenida {
  /* firmar: todavía no se ve la firma · preparando: firmó y se están dando los accesos · listo · sin-accesos: firmó,
     pero los accesos se los da el equipo (apagados, o el programa no tiene ninguno) · terminado: tuvo accesos y se los
     quitaron todos (el outboarding). */
  fase: "firmar" | "preparando" | "listo" | "sin-accesos" | "terminado" | "reserva";
  nombre: string;
  programa: string;
  telegram: { nombre: string; url: string | null; adentro: boolean }[];
  wisboo: { url: string | null; cursos: string[] } | null;
  zoom: { nombre: string; url: string | null }[];
  /* Algo no salió solo: el equipo lo termina a mano (se le dice, sin el detalle técnico). */
  faltaAlgo: boolean;
  /* Su roadmap, su formulario semanal y el WhatsApp de soporte (Lili, 22/10; lib/bienvenida-alumno.ts). */
  guia?: GuiaBienvenida | null;
}

/** Lo que ve el alumno: sólo su nombre de pila, el programa y sus links (nunca su mail, documento ni nada más). */
export function armarBienvenida(a: {
  contrato: Pick<Contrato, "estado" | "accesosEn" | "destinatario"> & { datos?: Partial<DatosContrato> | null };
  programa: string; accesos: AccesoParaBienvenida[]; linkWisboo: string | null;
  /* ¿Al firmar se dan los accesos solos? (prendidos en Ajustes). Si no, no hay nada que esperar: se los da el equipo. */
  accesosAutomaticos: boolean;
  guia?: GuiaBienvenida | null;
}): Bienvenida {
  const nombre = (a.contrato.destinatario.nombre ?? "").trim().split(/\s+/)[0] ?? "";
  /* La guía (roadmap, formulario y soporte) se muestra recién firmado. */
  const guia = a.contrato.estado === "firmado" ? a.guia ?? null : null;
  const base = { nombre, programa: a.programa, telegram: [], wisboo: null, zoom: [], faltaAlgo: false, guia };
  if (a.contrato.estado !== "firmado") return { ...base, fase: "firmar" };
  /* La reserva no da accesos: reservó su lugar y los recibe con el contrato del programa. */
  if (a.contrato.datos?.reserva) return { ...base, fase: "reserva" };
  if (!a.contrato.accesosEn) return { ...base, fase: a.accesosAutomaticos ? "preparando" : "sin-accesos" };
  const vigentes = a.accesos.filter((x) => x.estado !== "quitado");
  if (a.accesos.length > 0 && vigentes.length === 0) return { ...base, fase: "terminado" };
  const telegram = vigentes.filter((x) => x.plataforma === "telegram" && x.estado !== "fallo").map((x) => ({
    nombre: x.recursoNombre, adentro: x.estado === "entro",
    url: x.estado === "dado" && typeof x.externo.link === "string" ? x.externo.link : null,
  }));
  const cursos = vigentes.filter((x) => x.plataforma === "wisboo" && x.estado !== "fallo").map((x) => x.recursoNombre);
  const zoom = vigentes.filter((x) => x.plataforma === "zoom" && x.estado !== "fallo").map((x) => ({
    nombre: x.recursoNombre, url: typeof x.externo.joinUrl === "string" ? x.externo.joinUrl : null,
  }));
  const faltaAlgo = vigentes.some((x) => x.estado === "fallo");
  const hay = telegram.length + cursos.length + zoom.length > 0;
  return {
    ...base, fase: hay ? "listo" : "sin-accesos", telegram, zoom, faltaAlgo,
    wisboo: cursos.length ? { url: a.linkWisboo, cursos } : null,
  };
}

/** Un código de bienvenida bien formado (para no ir a la base con cualquier cosa). */
export const esCodigoBienvenida = (x: unknown): x is string => typeof x === "string" && /^[A-Za-z0-9_-]{24,64}$/.test(x);

/** Lo que el contrato firmado deja en la ficha de Customer Success: firmado, las sesiones 1 a 1 que se le dieron y, si la
    ficha todavía no tenía programa, el del contrato. Lo que Lili ya cargó a mano en el programa no se pisa. */
export function fichaAlFirmar(datos: Partial<DatosContrato>, programa: string, programasDeLaFicha: string[] | null | undefined): Record<string, unknown> {
  return {
    contratoFirmado: "Firmado", estadoContrato: "Firmado en PandaDoc",
    ...(typeof datos.sesiones === "number" && datos.sesiones > 0 ? { sesionesMentor: datos.sesiones } : {}),
    ...(programa && !(programasDeLaFicha ?? []).length ? { programas: [programa] } : {}),
  };
}

/** ¿Al firmar se dan los accesos solos? Encendidos o sólo dueños, siempre; en «prueba», sólo los contratos de prueba. */
export function accesosAlFirmar(estado: ConfigContratos["estado"] | undefined, modo: ModoContrato): boolean {
  return estado === "encendido" || estado === "duenos" || (estado === "prueba" && modo === "prueba");
}

/** ¿Los contratos los manda sólo un dueño? En «prueba» y en «sólo dueños». */
export const soloDuenos = (estado: ConfigContratos["estado"] | undefined): boolean => estado === "prueba" || estado === "duenos";

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

/** Los botones según el estado. No se ofrece lo que PandaDoc va a negar: un firmado no se anula, no se reenvía ni se
    corrige. Si tiene un error, se vuelve a intentar con el mismo documento o se manda otro (como en Blue OS). */
export function accionesDe(c: Pick<Contrato, "estado" | "documentoId">): AccionContrato[] {
  const conDoc = Boolean(c.documentoId);
  switch (c.estado) {
    case "creando": return conDoc ? ["sincronizar"] : [];
    case "borrador": return conDoc ? ["mandar", "corregir", "anular"] : ["mandar-otro"];
    case "enviado":
    case "visto": return ["copiar-enlace", "reenviar", "corregir", "anular", "sincronizar"];
    case "firmado": return ["ver-pdf", "mandar-otro"];
    case "rechazado":
    case "anulado": return ["mandar-otro"];
    /* Si llegó a PandaDoc, «Volver a intentar» manda ese mismo (no gasta otro documento del plan). */
    case "error": return conDoc ? ["mandar", "mandar-otro"] : ["mandar-otro"];
  }
}

/** ¿Le faltan los accesos a este contrato firmado? Pasa cuando firmó antes de que se cargara su venta (el equipo manda
    el contrato a mano desde PandaDoc y carga la venta después) o cuando se subió firmado sin darlos. Los firmados
    antes del 23/10 quedaron marcados como hechos sin haber dado nada: el último aviso de accesos dice «0 dados». */
export function accesosPendientes(
  c: Pick<Contrato, "estado" | "accesosEn"> & { datos?: Partial<DatosContrato> | null },
  eventos: Pick<EventoContrato, "evento" | "detalle" | "cuando">[],
): { pendiente: boolean; motivo: string | null } {
  if (c.estado !== "firmado" || c.datos?.reserva) return { pendiente: false, motivo: null };
  const ultimo = [...eventos].filter((e) => e.evento === "accesos").sort((a, b) => a.cuando.localeCompare(b.cuando)).pop();
  const motivo = ultimo && typeof ultimo.detalle?.motivo === "string" && ultimo.detalle.motivo ? ultimo.detalle.motivo : null;
  if (!c.accesosEn) return { pendiente: true, motivo };
  const nada = ultimo !== undefined && Number(ultimo.detalle?.dados ?? 0) === 0 && !Number(ultimo.detalle?.fallaron ?? 0)
    && !Number(ultimo.detalle?.yaEstaban ?? 0) && Boolean(motivo);
  return { pendiente: nada, motivo: nada ? motivo : null };
}

/* ---------- Un contrato que se mandó a mano desde PandaDoc: lo que dice el documento ---------- */

/** 20/10/2026, 20/10/26 (así lo escribe el equipo a mano en PandaDoc) o 2026-10-20T12:00:00Z → 2026-10-20. */
function diaDe(texto: string): string {
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/.exec(texto.trim());
  if (dmy) return `${dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(texto.trim());
  return iso ? iso[1] : "";
}

/** «2 sesiones 1 a 1…» → 2 · «No incluye sesiones…» → 0 · otra cosa → null. */
export function sesionesDeTexto(texto: string): number | null {
  const t = texto.trim();
  if (/^no incluye/i.test(t)) return 0;
  const n = /^(\d+)\s+sesi/i.exec(t);
  return n ? Number(n[1]) : null;
}

/** «full stack» o «Data engineer» → el perfil tal como lo conoce la bienvenida (lib/bienvenida-alumno.ts). */
export function perfilDeTexto(texto: string): string | undefined {
  const plano = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s-]+/g, " ").trim().toLowerCase();
  return PERFILES.find((p) => plano(p) === plano(texto));
}

/** «Sin bonos adicionales» → [] · «A, B y C» → [A, B, C]. */
export function bonosDeTexto(texto: string): string[] {
  const t = texto.trim();
  if (!t || /^sin bonos/i.test(t)) return [];
  const partes = t.split(/,\s*/);
  const ultimo = partes.pop() ?? "";
  return [...partes, ...ultimo.split(/\s+y\s+/)].map((x) => x.trim()).filter(Boolean);
}

/** Lo que dice un contrato que no armó la app (Juan Cruz, 23/10: el equipo los manda a mano desde PandaDoc): quién lo
    firma y lo que tienen sus variables ([Cliente.Nombre], [Contrato.Inicio]…). Con eso se ata a su venta, se puede
    corregir desde la app y al firmar se carga el inicio del servicio. Sólo lo que trae: lo que falta no se inventa. */
export function datosDelDocumento(detalle: unknown): {
  destinatario: { nombre: string; email: string; telefono: string }; datos: Partial<DatosContrato>;
} {
  const d = (detalle && typeof detalle === "object" ? detalle : {}) as Record<string, unknown>;
  const valores = new Map<string, string>();
  for (const t of Array.isArray(d.tokens) ? d.tokens : []) {
    const o = (t ?? {}) as { name?: unknown; value?: unknown };
    if (typeof o.name === "string" && typeof o.value === "string" && o.value.trim()) valores.set(o.name, o.value.trim());
  }
  for (const f of Array.isArray(d.fields) ? d.fields : []) {
    const o = (f ?? {}) as { merge_field?: unknown; value?: unknown };
    if (typeof o.merge_field === "string" && typeof o.value === "string" && o.value.trim() && !valores.has(o.merge_field)) {
      valores.set(o.merge_field, o.value.trim());
    }
  }
  const firmantes = (Array.isArray(d.recipients) ? d.recipients : []) as { email?: string; first_name?: string | null; last_name?: string | null; phone?: string | null; role?: string; recipient_type?: string }[];
  const alumno = firmantes.find((r) => r.role === ROL_ALUMNO) ?? firmantes.find((r) => !r.role && r.recipient_type !== "CC") ?? null;
  const v = (k: string) => valores.get(k) ?? "";
  const nombre = [alumno?.first_name, alumno?.last_name].map((x) => (x ?? "").trim()).filter(Boolean).join(" ") || v("Cliente.Nombre");
  const email = ((alumno?.email ?? "").trim() || v("Cliente.Email")).toLowerCase();
  const telefono = (alumno?.phone ?? "").trim() || v("Cliente.Telefono");

  const datos: Partial<DatosContrato> = {};
  const poner = <K extends keyof DatosContrato>(k: K, x: DatosContrato[K] | "" | null | undefined) => {
    if (x !== "" && x !== null && x !== undefined) datos[k] = x as DatosContrato[K];
  };
  poner("nombre", v("Cliente.Nombre") || nombre);
  poner("email", email);
  poner("telefono", telefono);
  poner("documento", v("Cliente.Documento"));
  poner("domicilio", v("Cliente.Domicilio"));
  poner("pais", v("Cliente.Pais"));
  poner("fecha", diaDe(v("Contrato.Fecha")));
  poner("inicio", diaDe(v("Contrato.Inicio")));
  poner("modalidad", v("Venta.Modalidad"));
  if (valores.has("Venta.Sesiones")) poner("sesiones", sesionesDeTexto(v("Venta.Sesiones")));
  if (valores.has("Venta.Bonos")) datos.bonos = bonosDeTexto(v("Venta.Bonos"));
  /* El perfil decide qué roadmap le llega en el mail de bienvenida: sólo si la plantilla tiene [Cliente.Perfil]. */
  poner("perfil", perfilDeTexto(v("Cliente.Perfil")));
  return { destinatario: { nombre, email, telefono }, datos };
}

/** ¿Este contrato todavía espera algo de PandaDoc? (la tarjeta se refresca sola mientras tanto). */
export const estaPendiente = (estado: EstadoContrato) => estado === "creando" || estado === "enviado" || estado === "visto";

/** Los que valen la pena mostrar de una persona: un intento que no salió y ya tiene otro más nuevo (volvieron a mandarlo, a mano o desde la app)
    es historia, y un anulado también si hay otro después. Hasta tres, del más nuevo al más viejo. */
export function contratosAMostrar(todos: readonly Contrato[]): Contrato[] {
  const mismaCompra = (a: Contrato, b: Contrato) => (Boolean(a.ventaId) && a.ventaId === b.ventaId) || (Boolean(a.leadId) && a.leadId === b.leadId);
  const reemplazado = (c: Contrato, valen: (o: Contrato) => boolean) => todos.some((o) => o.id !== c.id && valen(o) && mismaCompra(o, c) && o.creadoEn > c.creadoEn);
  /* Uno firmado de la misma compra tapa a los que no salieron o se anularon, aunque sea más viejo (Sebastián Vega: el de la venta repetida
     quedó anulado y el firmado era del 22/10). */
  const firmado = (c: Contrato) => todos.some((o) => o.id !== c.id && o.estado === "firmado" && mismaCompra(o, c));
  return todos
    .filter((c) => c.estado === "error" ? !firmado(c) && !reemplazado(c, (o) => o.estado !== "error" && o.estado !== "anulado")
      : c.estado === "anulado" ? !firmado(c) && !reemplazado(c, () => true) : true)
    .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn))
    .slice(0, 3);
}

/** El contrato que le toca a una llamada: el de su sesión y, si ese ya tiene reemplazo (se mandó a mano desde PandaDoc, sin sesión), el vigente,
    para que la llamada y la columna de la ficha digan lo mismo. Sólo si la llamada terminó en venta. */
export function contratoDeLlamada(visibles: readonly Contrato[], f: { id: string; venta?: unknown }): Contrato | undefined {
  return visibles.find((c) => c.sesionId === f.id) ?? (f.venta ? visibles[0] : undefined);
}

/** El mensaje de WhatsApp para pasarle a quien firmó su página de accesos (Mariano, 26/10: Jacob firmó, el mail con los accesos no lo vio y el closer
    no tenía cómo mandárselos desde la app). La página trae el grupo de Telegram y los cursos; el usuario de los cursos es el mail con el que firmó. */
export function mensajeDeAccesosPorWhatsapp(nombre: string, email: string, url: string): string {
  const primero = nombre.trim().split(/\s+/)[0] || "";
  return `${primero ? `${primero}, ya` : "Ya"} tenés tus accesos listos. Entrá desde acá: ${url}\n`
    + `Ahí está el grupo de Telegram (el link sirve una sola vez, abrilo con Telegram instalado) y los cursos: la primera vez te pide elegir una contraseña y tu usuario es tu mail${email ? ` (${email})` : ""}. `
    + `Si no encontrás el mail que te mandamos, mirá en spam.`;
}

/** Lo que le pasó al contrato, en una frase para el closer. */
export function quePasoConElContrato(c: Contrato): string {
  const a = c.destinatario?.email || c.datos?.email || "su mail";
  switch (c.estado) {
    case "error": return `${a} no recibió nada.`;
    case "creando": return "Se está armando…";
    case "borrador": return "Quedó armado pero sin mandar.";
    case "enviado": return `Le llegó a ${a} (${c.enviadoEn ? fechaHora(c.enviadoEn) : "recién"}). Todavía no lo abrió.`;
    case "visto": return `Lo abrió ${relativo(c.vistoEn)}. Falta que firme.`;
    case "firmado": return `Firmó el ${fechaHora(c.firmadoEn)}.`;
    case "rechazado": return "Lo rechazó. Hay que corregirlo y mandarlo de nuevo.";
    case "anulado": return "Se anuló.";
  }
}


/** ¿La pasada de cada hora tiene que conectar sola el aviso de producción? Sólo en la app publicada, con la clave,
    y si NUNCA se conectó: una fila desconectada a mano (sin clave) no se vuelve a conectar sola. */
export function conectarAvisoSolo(a: { enProduccion: boolean; hayClave: boolean; hayFila: boolean }): boolean {
  return a.enProduccion && a.hayClave && !a.hayFila;
}

/** Lo que falta para poder mandarlo. null: se puede. */
export function problemaDeDatos(d: Partial<DatosContrato>, modo: ModoContrato, dominioPrueba = "apicanta.com", programa?: string): string | null {
  if (!d.nombre?.trim()) return "Falta el nombre completo del alumno.";
  const email = (d.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Falta un mail válido: es adonde le llega el contrato.";
  if (modo === "prueba" && !email.endsWith(`@${dominioPrueba}`)) {
    return `Un contrato de prueba sólo puede ir a un mail @${dominioPrueba} (así lo pide PandaDoc con la clave sandbox).`;
  }
  if (!d.documento?.trim()) return "Falta el documento (DNI, pasaporte o el que tenga).";
  if (!d.domicilio?.trim()) return "Falta el domicilio.";
  if (d.reserva && !d.modalidad?.trim()) return "Falta el monto de la reserva.";
  /* Los programas con bienvenida (Hackear AI, Downsell y la reserva) le mandan al alumno el roadmap de su perfil. */
  if (programa && modeloDeBienvenida({ reserva: d.reserva, programa }) && !esPerfil(d.perfil)) {
    return "Falta el perfil del alumno (Full Stack, Mobile, Data o AI Engineer): con eso le llega su roadmap.";
  }
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
  /* El documento como vino en el aviso (es el mismo formato que su detalle): sirve si no se le puede volver a preguntar a PandaDoc. */
  detalle: Record<string, unknown>;
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
      detalle: data,
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
