import { createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hayEquipoConfigurado } from "./equipo-servidor";
import { exigirArea } from "./permisos-servidor";
import { nubeServidor } from "./servidor";
import {
  aplicarAviso, aplicarFoto, contarDentro, MAX_BYTES_CUERPO, QR_VIGENTE_SEG,
  type CuerpoGrupo, type CuerpoLatido, type EstadoConexion, type EventoGrupo, type GrupoWhatsapp, type LatidoLector,
  type MiembroWhatsapp, type RespuestaEstado, type RespuestaWebinar,
} from "./whatsapp";

/* ==================================================================
   WhatsApp de lectura, del lado del servidor.

   Lo que escribe el lector (un servicio aparte, en un servidor propio) entra
   por /api/whatsapp/grupos y /api/whatsapp/latido, con un secreto
   (WHATSAPP_LECTOR_TOKEN). Escribe con la clave de servicio, que saltea
   RLS: las tablas sólo se escriben desde acá. La pantalla lee y cambia lo
   suyo (atar un grupo a un webinar) por /api/whatsapp/
   estado y /api/whatsapp/webinar, que antes preguntan por el tipo de cuenta.

   Dónde se guarda: en Supabase. Sin base (la app corriendo en la compu, sin
   variables) y fuera de producción, en un archivo: sirve para probar el
   lector de punta a punta sin nube. En producción sin la clave de servicio,
   contesta que falta, nunca guarda a medias.

   Nunca se escribe un teléfono en los registros ni en un mensaje de error.
   ================================================================== */

/* ---------- Dónde se guarda ---------- */

export interface RepoWhatsapp {
  leerLatido(): Promise<LatidoLector | null>;
  guardarLatido(l: { ultimoLatido: string; enLector: string | null; conectado: boolean; grupos: number; estado: EstadoConexion }): Promise<void>;

  /** El código QR para vincular el número, como imagen. Es una credencial: sólo se lee desde el servidor, y la pantalla
      se lo da únicamente a quien edita Ajustes. */
  guardarQr(q: { qr: string; en: string }): Promise<void>;
  leerQr(): Promise<{ qr: string; en: string } | null>;
  borrarQr(): Promise<void>;

  leerGrupos(): Promise<GrupoWhatsapp[]>;
  leerGrupo(id: string): Promise<GrupoWhatsapp | null>;
  /** Crea el grupo o actualiza lo que se le pase. Nunca toca a qué webinar corresponde. */
  guardarGrupo(g: { id: string; nombre?: string; miembros?: number; sinTelefono?: number; ultimaFoto?: string }): Promise<void>;
  atarGrupo(grupoId: string, webinarId: string | null): Promise<"ok" | "sin-grupo" | "sin-webinar">;

  /** Los miembros de un grupo, o sólo esos teléfonos. */
  leerMiembros(grupoId: string, telefonos?: readonly string[]): Promise<MiembroWhatsapp[]>;
  guardarMiembros(filas: readonly MiembroWhatsapp[]): Promise<void>;
  contarDentro(grupoId: string): Promise<number>;
}

/** Faltan las tablas: hay que correr supabase/whatsapp-lector.sql. */
export class ErrorSinTablas extends Error {
  constructor() { super("Faltan las tablas de WhatsApp: hay que correr supabase/whatsapp-lector.sql en la base."); }
}

/** Falta la tabla del código QR: hay que correr supabase/whatsapp-lector-qr.sql. El resto anda igual. */
export class ErrorSinTablaQr extends Error {
  constructor() { super("Falta la tabla del código QR: hay que correr supabase/whatsapp-lector-qr.sql en la base."); }
}

/** Un número de teléfono (o de lo que sea) largo no tiene por qué ir a un registro. */
export const sinNumeros = (texto: string) => texto.replace(/\d{7,}/g, "…").slice(0, 300);

class ErrorDeBase extends Error {
  constructor(public codigo: string | undefined, mensaje: string) { super(sinNumeros(mensaje)); }
}

/* Una columna que todavía no existe (falta correr un SQL) no es una tabla que falta. */
const faltaLaColumna = (e: { code?: string; message?: string }) =>
  e.code === "PGRST204" || e.code === "42703" || /column .* does not exist|find the '.*' column/i.test(e.message ?? "");

const faltaLaTabla = (e: { code?: string; message?: string }) =>
  !faltaLaColumna(e) && (e.code === "PGRST205" || e.code === "42P01" || /schema cache|does not exist/i.test(e.message ?? ""));

/* ---------- Supabase ---------- */

const COLUMNAS_GRUPO = "id, nombre, webinarId, miembros, sinTelefono, ultimaFoto, creadoEn";
const PAGINA = 1000;

class RepoSupabase implements RepoWhatsapp {
  constructor(private db: SupabaseClient) {}

  private ok<T>(r: { data: T | null; error: { code?: string; message?: string } | null }): T | null {
    if (r.error) throw faltaLaTabla(r.error) ? new ErrorSinTablas() : new ErrorDeBase(r.error.code, r.error.message ?? "Error de la base.");
    return r.data;
  }

  async leerLatido() {
    const columnas = "ultimoLatido, enLector, conectado, grupos, ultimaConexion, desde";
    /* `estado` es de supabase/whatsapp-lector-qr.sql: sin esa columna se deduce de «conectado». */
    let r = await this.db.from("whatsapp_lector").select(`${columnas}, estado`).eq("id", 1).maybeSingle();
    if (r.error && faltaLaColumna(r.error)) r = await this.db.from("whatsapp_lector").select(columnas).eq("id", 1).maybeSingle();
    return (this.ok(r) as LatidoLector | null) ?? null;
  }

  async guardarLatido(l: { ultimoLatido: string; enLector: string | null; conectado: boolean; grupos: number; estado: EstadoConexion }) {
    /* `desde` no se manda: queda el del primer latido. La última conexión sólo
       se mueve cuando dice estar conectado. */
    const fila: Record<string, unknown> = { id: 1, ...l };
    if (l.conectado) fila.ultimaConexion = l.ultimoLatido;
    let r = await this.db.from("whatsapp_lector").upsert(fila, { onConflict: "id", defaultToNull: false });
    if (r.error && faltaLaColumna(r.error)) {
      const { estado: _fuera, ...sinEstado } = fila;
      void _fuera;
      r = await this.db.from("whatsapp_lector").upsert(sinEstado, { onConflict: "id", defaultToNull: false });
    }
    this.ok(r);
  }

  async guardarQr(q: { qr: string; en: string }) {
    const r = await this.db.from("whatsapp_qr").upsert({ id: 1, ...q }, { onConflict: "id", defaultToNull: false });
    if (r.error && faltaLaTabla(r.error)) throw new ErrorSinTablaQr();
    this.ok(r);
  }

  async leerQr() {
    const r = await this.db.from("whatsapp_qr").select("qr, en").eq("id", 1).maybeSingle();
    if (r.error && faltaLaTabla(r.error)) throw new ErrorSinTablaQr();
    return (this.ok(r) as { qr: string; en: string } | null) ?? null;
  }

  async borrarQr() {
    const r = await this.db.from("whatsapp_qr").delete().eq("id", 1);
    if (r.error && faltaLaTabla(r.error)) throw new ErrorSinTablaQr();
    this.ok(r);
  }

  async leerGrupos() {
    const r = this.ok(await this.db.from("whatsapp_grupos").select(COLUMNAS_GRUPO).order("ultimaFoto", { ascending: false, nullsFirst: false }));
    return (r ?? []) as GrupoWhatsapp[];
  }

  async leerGrupo(id: string) {
    const r = this.ok(await this.db.from("whatsapp_grupos").select(COLUMNAS_GRUPO).eq("id", id).maybeSingle());
    return (r as GrupoWhatsapp | null) ?? null;
  }

  async guardarGrupo(g: { id: string; nombre?: string; miembros?: number; sinTelefono?: number; ultimaFoto?: string }) {
    const fila: Record<string, unknown> = { id: g.id };
    /* Un nombre vacío no pisa uno bueno. */
    if (g.nombre) fila.nombre = g.nombre;
    if (g.miembros !== undefined) fila.miembros = g.miembros;
    if (g.sinTelefono !== undefined) fila.sinTelefono = g.sinTelefono;
    if (g.ultimaFoto) fila.ultimaFoto = g.ultimaFoto;
    this.ok(await this.db.from("whatsapp_grupos").upsert(fila, { onConflict: "id", defaultToNull: false }));
  }

  async atarGrupo(grupoId: string, webinarId: string | null) {
    const r = await this.db.from("whatsapp_grupos").update({ webinarId }).eq("id", grupoId).select("id");
    if (r.error) {
      if (r.error.code === "23503") return "sin-webinar";
      this.ok(r);
    }
    return (r.data ?? []).length > 0 ? "ok" : "sin-grupo";
  }

  async leerMiembros(grupoId: string, telefonos?: readonly string[]) {
    const salida: MiembroWhatsapp[] = [];
    const columnas = "grupoId, telefono, dentro, entro, salio";
    if (telefonos) {
      for (let i = 0; i < telefonos.length; i += 100) {
        const r = this.ok(await this.db.from("whatsapp_miembros").select(columnas).eq("grupoId", grupoId).in("telefono", telefonos.slice(i, i + 100)));
        salida.push(...((r ?? []) as MiembroWhatsapp[]));
      }
      return salida;
    }
    /* PostgREST corta en 1000 sin avisar: se pide por páginas hasta que una venga incompleta. */
    for (let desde = 0; ; desde += PAGINA) {
      const r = this.ok(await this.db.from("whatsapp_miembros").select(columnas).eq("grupoId", grupoId)
        .order("telefono", { ascending: true }).range(desde, desde + PAGINA - 1));
      const filas = (r ?? []) as MiembroWhatsapp[];
      salida.push(...filas);
      if (filas.length < PAGINA) return salida;
    }
  }

  async guardarMiembros(filas: readonly MiembroWhatsapp[]) {
    for (let i = 0; i < filas.length; i += 500) {
      /* `creadoEn` no se manda: lo pone la base la primera vez y no se pisa. */
      const lote = filas.slice(i, i + 500).map(({ grupoId, telefono, dentro, entro, salio }) => ({ grupoId, telefono, dentro, entro, salio }));
      this.ok(await this.db.from("whatsapp_miembros").upsert(lote, { onConflict: "grupoId,telefono", defaultToNull: false }));
    }
  }

  async contarDentro(grupoId: string) {
    const r = await this.db.from("whatsapp_miembros").select("telefono", { count: "exact", head: true }).eq("grupoId", grupoId).eq("dentro", true);
    this.ok({ data: null, error: r.error });
    return r.count ?? 0;
  }
}

/* ---------- En memoria, y en un archivo para probar sin nube ---------- */

interface Datos { latido: LatidoLector | null; grupos: GrupoWhatsapp[]; miembros: MiembroWhatsapp[]; qr: { qr: string; en: string } | null }

const datosVacios = (): Datos => ({ latido: null, grupos: [], miembros: [], qr: null });

export class RepoMemoria implements RepoWhatsapp {
  constructor(protected datos: Datos = datosVacios()) {}

  /** Lo que hacen los que guardan en otro lado, después de cada cambio. */
  protected cambio(): void {}

  async leerLatido() { return this.datos.latido ? { ...this.datos.latido } : null; }

  async guardarLatido(l: { ultimoLatido: string; enLector: string | null; conectado: boolean; grupos: number; estado: EstadoConexion }) {
    const antes = this.datos.latido;
    this.datos.latido = {
      ...l,
      ultimaConexion: l.conectado ? l.ultimoLatido : antes?.ultimaConexion ?? null,
      desde: antes?.desde ?? l.ultimoLatido,
    };
    this.cambio();
  }

  async guardarQr(q: { qr: string; en: string }) { this.datos.qr = { ...q }; this.cambio(); }
  async leerQr() { return this.datos.qr ? { ...this.datos.qr } : null; }
  async borrarQr() { if (this.datos.qr) { this.datos.qr = null; this.cambio(); } }

  async leerGrupos() {
    return this.datos.grupos.map((g) => ({ ...g })).sort((a, b) => (b.ultimaFoto ?? "").localeCompare(a.ultimaFoto ?? ""));
  }

  async leerGrupo(id: string) {
    const g = this.datos.grupos.find((x) => x.id === id);
    return g ? { ...g } : null;
  }

  async guardarGrupo(g: { id: string; nombre?: string; miembros?: number; sinTelefono?: number; ultimaFoto?: string }) {
    const previo = this.datos.grupos.find((x) => x.id === g.id);
    if (!previo) {
      this.datos.grupos.push({
        id: g.id, nombre: g.nombre ?? "", webinarId: null, miembros: g.miembros ?? 0, sinTelefono: g.sinTelefono ?? 0,
        ultimaFoto: g.ultimaFoto ?? null, creadoEn: new Date().toISOString(),
      });
    } else {
      if (g.nombre) previo.nombre = g.nombre;
      if (g.miembros !== undefined) previo.miembros = g.miembros;
      if (g.sinTelefono !== undefined) previo.sinTelefono = g.sinTelefono;
      if (g.ultimaFoto) previo.ultimaFoto = g.ultimaFoto;
    }
    this.cambio();
  }

  async atarGrupo(grupoId: string, webinarId: string | null) {
    const g = this.datos.grupos.find((x) => x.id === grupoId);
    if (!g) return "sin-grupo" as const;
    g.webinarId = webinarId;
    this.cambio();
    return "ok" as const;
  }

  async leerMiembros(grupoId: string, telefonos?: readonly string[]) {
    const quiero = telefonos ? new Set(telefonos) : null;
    return this.datos.miembros.filter((m) => m.grupoId === grupoId && (!quiero || quiero.has(m.telefono))).map((m) => ({ ...m }));
  }

  async guardarMiembros(filas: readonly MiembroWhatsapp[]) {
    const indice = new Map(this.datos.miembros.map((m, i) => [`${m.grupoId}|${m.telefono}`, i] as const));
    for (const f of filas) {
      const i = indice.get(`${f.grupoId}|${f.telefono}`);
      if (i === undefined) { indice.set(`${f.grupoId}|${f.telefono}`, this.datos.miembros.length); this.datos.miembros.push({ ...f }); }
      else this.datos.miembros[i] = { ...this.datos.miembros[i], ...f, creadoEn: this.datos.miembros[i].creadoEn };
    }
    this.cambio();
  }

  async contarDentro(grupoId: string) {
    return this.datos.miembros.filter((m) => m.grupoId === grupoId && m.dentro).length;
  }
}

/** El mismo repositorio, guardado en un archivo (cada pedido lo lee de nuevo:
    en desarrollo cada ruta puede tener su propia copia del módulo). */
export class RepoArchivo extends RepoMemoria {
  constructor(private ruta: string) {
    super(leerArchivo(ruta));
  }
  protected override cambio() {
    mkdirSync(dirname(this.ruta), { recursive: true });
    const temporal = `${this.ruta}.${process.pid}.tmp`;
    writeFileSync(temporal, JSON.stringify(this.datos), "utf8");
    renameSync(temporal, this.ruta);
  }
}

function leerArchivo(ruta: string): Datos {
  try {
    const j = JSON.parse(readFileSync(ruta, "utf8")) as Partial<Datos>;
    return {
      latido: j.latido ?? null, grupos: Array.isArray(j.grupos) ? j.grupos : [],
      miembros: Array.isArray(j.miembros) ? j.miembros : [],
      qr: j.qr && typeof j.qr.qr === "string" && typeof j.qr.en === "string" ? j.qr : null,
    };
  } catch {
    return datosVacios();
  }
}

/** El archivo de la prueba local: WHATSAPP_ARCHIVO_LOCAL, o uno en la carpeta temporal. */
export const rutaDePruebaLocal = () => process.env.WHATSAPP_ARCHIVO_LOCAL?.trim() || join(tmpdir(), "apicanta-whatsapp-prueba-local.json");

/** Dónde guardar ahora. Con la clave de servicio, Supabase. Sin base (la app
    corriendo local, sin variables) y fuera de producción, un archivo. Si no,
    nada: en producción nunca se guarda a medias. */
export function repositorio(): { repo: RepoWhatsapp; modo: "nube" | "prueba-local" } | null {
  const db = nubeServidor();
  if (db) return { repo: new RepoSupabase(db), modo: "nube" };
  if (!hayEquipoConfigurado() && process.env.NODE_ENV !== "production") return { repo: new RepoArchivo(rutaDePruebaLocal()), modo: "prueba-local" };
  return null;
}

export const SIN_BASE = "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor de la app: no puede guardar lo que lee el lector.";

/* ---------- El secreto del lector ---------- */

export const tokenDelLector = (): string | null => process.env.WHATSAPP_LECTOR_TOKEN?.trim() || null;

/** Compara en tiempo constante: se comparan los hashes, así ni el largo se filtra. */
export function tokenValido(recibido: string | null | undefined, esperado: string): boolean {
  if (!recibido || !esperado) return false;
  const a = createHash("sha256").update(recibido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}

const tokenDelPedido = (peticion: Request): string | null => /^Bearer\s+(\S+)\s*$/i.exec(peticion.headers.get("authorization") ?? "")?.[1] ?? null;

/** null si el lector puede pasar; si no, la respuesta: 503 si la app no tiene
    el secreto configurado, 401 si no es el correcto. */
export function autorizarLector(peticion: Request): NextResponse | null {
  const esperado = tokenDelLector();
  if (!esperado) {
    return NextResponse.json(
      { error: "El lector de WhatsApp todavía no está habilitado: falta la variable WHATSAPP_LECTOR_TOKEN en el servidor de la app." },
      { status: 503 },
    );
  }
  if (!tokenValido(tokenDelPedido(peticion), esperado)) {
    return NextResponse.json(
      { error: "No autorizado: el lector tiene que mandar «Authorization: Bearer <token>» con el token que está en la app." },
      { status: 401 },
    );
  }
  return null;
}

/** El cuerpo como JSON, con tope de tamaño. */
export async function leerJson(peticion: Request, max: number = MAX_BYTES_CUERPO):
  Promise<{ ok: true; json: unknown } | { ok: false; status: number; error: string }> {
  const declarado = Number(peticion.headers.get("content-length"));
  const demasiado = { ok: false as const, status: 413, error: `El pedido es demasiado grande (el máximo es ${Math.round(max / 1000)} KB).` };
  if (Number.isFinite(declarado) && declarado > max) return demasiado;
  let texto: string;
  try { texto = await peticion.text(); } catch { return { ok: false, status: 400, error: "No pude leer el cuerpo del pedido." }; }
  if (texto.length > max) return demasiado;
  try { return { ok: true, json: JSON.parse(texto) }; } catch { return { ok: false, status: 400, error: "El cuerpo no es un JSON válido." }; }
}

/** La respuesta para un error inesperado: sin datos de nadie. */
export function respuestaDeError(e: unknown, donde: string): NextResponse {
  if (e instanceof ErrorSinTablas) return NextResponse.json({ error: e.message, tablas: false }, { status: 503 });
  console.error(`[${donde}]`, e instanceof ErrorDeBase && e.codigo ? `${e.codigo}:` : "", sinNumeros(e instanceof Error ? e.message : String(e)));
  return NextResponse.json({ error: "No se pudo guardar. Revisá los registros de la app." }, { status: 500 });
}

/* ---------- Lo que escribe el lector ---------- */

export interface ResultadoGrupo {
  ok: true;
  evento: EventoGrupo;
  grupo: string;
  recibidos: number;
  validos: number;
  descartados: number;
  nuevos: number;
  volvieron: number;
  salieron: number;
  /** Cuántos quedaron adentro del grupo. */
  miembros: number | null;
  /** Por qué no se aplicó (y se contestó bien igual). */
  ignorada?: string;
  aviso?: string;
}

const aMs = (iso: string | null | undefined) => Date.parse(iso ?? "");

/** Una foto o un aviso de un grupo. */
export async function recibirGrupo(repo: RepoWhatsapp, c: CuerpoGrupo): Promise<ResultadoGrupo> {
  const id = c.grupo.id;
  const base: ResultadoGrupo = {
    ok: true, evento: c.evento, grupo: id, recibidos: c.recibidos, validos: c.telefonos.length, descartados: c.descartados,
    nuevos: 0, volvieron: 0, salieron: 0, miembros: null,
    aviso: c.relojDesfasadoMin ? `La hora del lector difiere ${Math.abs(c.relojDesfasadoMin)} minutos de la de la app: revisá el reloj del servidor.` : undefined,
  };
  const t = aMs(c.en);
  const grupo = await repo.leerGrupo(id);

  if (c.evento === "foto") {
    /* Una foto que llega tarde no pisa una más nueva. */
    if (grupo?.ultimaFoto && t < aMs(grupo.ultimaFoto)) return { ...base, ignorada: "Ya hay una foto más nueva de este grupo." };
    /* Una foto sin nadie, con el grupo ya cargado, es un error del lector (el
       número del lector está siempre adentro): si no, se vaciaría el grupo. */
    if (c.telefonos.length === 0 && grupo && grupo.miembros > 0) return { ...base, ignorada: "La foto vino vacía y el grupo tenía gente: no se aplica." };

    const existentes = await repo.leerMiembros(id);
    const cambios = aplicarFoto(existentes, c.telefonos, c.en, { grupoId: id, primeraFoto: !grupo?.ultimaFoto, sinTelefono: c.sinTelefono });
    const miembros = contarDentro(existentes, cambios);
    /* El grupo va antes que sus miembros (la clave foránea). */
    await repo.guardarGrupo({ id, nombre: c.grupo.nombre, miembros, sinTelefono: c.sinTelefono, ultimaFoto: c.en });
    await repo.guardarMiembros([...cambios.crear, ...cambios.actualizar]);
    return { ...base, nuevos: cambios.nuevos, volvieron: cambios.volvieron, salieron: cambios.salieron, miembros };
  }

  if (c.telefonos.length === 0) return { ...base, ignorada: "El aviso no trae ningún teléfono." };
  /* Lo que pasó antes de la última foto ya está en la foto. */
  if (grupo?.ultimaFoto && t <= aMs(grupo.ultimaFoto)) return { ...base, ignorada: "Eso ya está en la última foto del grupo." };

  const existentes = await repo.leerMiembros(id, c.telefonos);
  const cambios = aplicarAviso(existentes, c.evento, c.telefonos, c.en, id);
  await repo.guardarGrupo({ id, nombre: c.grupo.nombre });
  let miembros: number | null = grupo?.miembros ?? null;
  if (cambios.crear.length + cambios.actualizar.length > 0) {
    await repo.guardarMiembros([...cambios.crear, ...cambios.actualizar]);
    miembros = await repo.contarDentro(id);
    await repo.guardarGrupo({ id, miembros });
  }
  return { ...base, nuevos: cambios.nuevos, volvieron: cambios.volvieron, salieron: cambios.salieron, miembros };
}

/** El latido: el servidor le pone SU hora, no la del lector. Con un código QR esperando se
    guarda (aparte, en una tabla que sólo lee el servidor); en cualquier otro estado, el código
    viejo se borra: ya no sirve y es una credencial. Sin la tabla del QR el latido entra igual. */
export async function recibirLatido(repo: RepoWhatsapp, c: CuerpoLatido, ahora: Date = new Date()): Promise<{ ok: true; aviso?: string }> {
  await repo.guardarLatido({ ultimoLatido: ahora.toISOString(), enLector: c.en, conectado: c.conectado, grupos: c.grupos, estado: c.estado });
  const avisos: string[] = [];
  if (c.relojDesfasadoMin) avisos.push(`La hora del lector difiere ${Math.abs(c.relojDesfasadoMin)} minutos de la de la app: revisá el reloj del servidor.`);
  try {
    if (c.estado !== "esperando_qr") await repo.borrarQr();
    else if (c.qr) await repo.guardarQr({ qr: c.qr, en: ahora.toISOString() });
  } catch (e) {
    if (!(e instanceof ErrorSinTablaQr)) throw e;
    /* Sin la tabla, un QR que llega no tiene dónde quedar: se avisa, una vez por pedido con código. */
    if (c.qr) avisos.push("Falta correr supabase/whatsapp-lector-qr.sql: el código QR no se puede mostrar en la app.");
  }
  return { ok: true, aviso: avisos.length ? avisos.join(" ") : undefined };
}

/* ---------- Lo que lee la pantalla ---------- */

type Modo = "nube" | "prueba-local";

export async function estadoParaPantalla(repo: RepoWhatsapp, modo: Modo): Promise<RespuestaEstado> {
  const [lector, grupos] = await Promise.all([repo.leerLatido(), repo.leerGrupos()]);
  return { configurado: Boolean(tokenDelLector()), tablas: true, modo, lector, grupos };
}

export interface DepsDeEstado {
  exigirArea: (peticion: Request, areas: Parameters<typeof exigirArea>[1], minimo: 1 | 2) => Promise<NextResponse | null>;
  repositorio: typeof repositorio;
  ahora: () => Date;
}
const DEPS: DepsDeEstado = { exigirArea, repositorio, ahora: () => new Date() };

/** GET /api/whatsapp/estado. Lo ve quien ve los Webinars. El código QR para vincular el número es
    una credencial (quien lo escanea lee ese WhatsApp): va SÓLO si lo pide (?qr=1), el lector está
    esperándolo, tiene menos de un minuto y quien pide es dueño o edita Ajustes. Se pregunta con la
    sesión de quien pide, como en las demás rutas; nunca se lee desde el navegador con RLS. */
export async function responderEstado(peticion: Request, deps: DepsDeEstado = DEPS): Promise<NextResponse> {
  const SIN_CACHE = { headers: { "Cache-Control": "no-store" } };
  const noPuede = await deps.exigirArea(peticion, ["webinars"], 1);
  if (noPuede) return noPuede;

  const donde = deps.repositorio();
  if (!donde) return NextResponse.json({ error: SIN_BASE }, { status: 503 });
  try {
    const r = await estadoParaPantalla(donde.repo, donde.modo);
    const pideQr = new URL(peticion.url).searchParams.get("qr") === "1";
    if (pideQr && r.lector?.estado === "esperando_qr") {
      const puede = (await deps.exigirArea(peticion, ["ajustes"], 2)) === null;
      r.puedeVerQr = puede;
      r.qr = null;
      if (puede) {
        try {
          const q = await donde.repo.leerQr();
          if (q && deps.ahora().getTime() - Date.parse(q.en) < QR_VIGENTE_SEG * 1000) r.qr = q.qr;
        } catch (e) {
          if (!(e instanceof ErrorSinTablaQr)) throw e;
          r.qrSinTabla = true;
        }
      }
    }
    return NextResponse.json(r, SIN_CACHE);
  } catch (e) {
    if (e instanceof ErrorSinTablas) {
      return NextResponse.json({ configurado: Boolean(tokenDelLector()), tablas: false, modo: donde.modo, lector: null, grupos: [] }, SIN_CACHE);
    }
    return respuestaDeError(e, "whatsapp/estado");
  }
}

/** Los grupos de un webinar y quién está adentro de alguno. */
export async function datosDeWebinar(repo: RepoWhatsapp, modo: Modo, webinarId: string, ahora: Date = new Date()): Promise<RespuestaWebinar> {
  const [lector, todos] = await Promise.all([repo.leerLatido(), repo.leerGrupos()]);
  const grupos = todos.filter((g) => g.webinarId === webinarId);
  const dentro = new Set<string>();
  const salieron = new Map<string, string>();
  for (const g of grupos) {
    for (const m of await repo.leerMiembros(g.id)) {
      if (m.dentro) dentro.add(m.telefono);
      else if (m.salio && m.salio > (salieron.get(m.telefono) ?? "")) salieron.set(m.telefono, m.salio);
    }
  }
  /* Quien salió de un grupo y está en otro del mismo webinar, está. */
  for (const t of dentro) salieron.delete(t);
  return {
    configurado: Boolean(tokenDelLector()), tablas: true, modo, lector, grupos,
    dentro: [...dentro], salieron: Object.fromEntries(salieron),
    generado: ahora.toISOString(),
  };
}

/** Los pedidos de la pantalla que cambian algo. */
export type AccionWebinar =
  | { accion: "atar"; grupoId: string; webinarId: string }
  | { accion: "soltar"; grupoId: string };

const IDENTIFICADOR = /^[\w.:@+-]{1,160}$/;

export function leerAccion(json: unknown): { ok: true; accion: AccionWebinar } | { ok: false; error: string } {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return { ok: false, error: "Falta el cuerpo del pedido." };
  const b = json as Record<string, unknown>;
  const texto = (k: string) => (typeof b[k] === "string" && IDENTIFICADOR.test(b[k] as string) ? (b[k] as string) : null);
  if (b.accion === "atar") {
    const grupoId = texto("grupoId"), webinarId = texto("webinarId");
    return grupoId && webinarId ? { ok: true, accion: { accion: "atar", grupoId, webinarId } } : { ok: false, error: "Faltan el grupo y el webinar." };
  }
  if (b.accion === "soltar") {
    const grupoId = texto("grupoId");
    return grupoId ? { ok: true, accion: { accion: "soltar", grupoId } } : { ok: false, error: "Falta el grupo." };
  }
  return { ok: false, error: "No conozco esa acción: «atar» o «soltar»." };
}
