/* Una «nube» falsa para las pruebas de estrés del almacén (no es una prueba).

   Se instala como `globalThis.fetch` ANTES de importar src/lib/store.ts: el cliente
   de verdad (@supabase/supabase-js) le habla por HTTP como si fuera PostgREST, y
   el store corre sin tocar nada. Lo que imita de PostgREST:

   - GET   /rest/v1/<tabla>?select=*&offset=&limit=   (paginado, con id=eq. e id=in.)
   - POST  /rest/v1/<tabla> con Prefer: resolution=merge-duplicates   (upsert)
       · se actualizan SÓLO las columnas que vienen en el cuerpo (la unión de las
         claves de las filas, ?columns=); las que no vienen, no se tocan;
       · es una sola sentencia: si una fila falla, no entra ninguna.
   - PATCH /rest/v1/<tabla>?id=in.(…)   y   DELETE …?id=in.(…) / id=neq.x
   - POST  /rest/v1/rpc/<función>  (puede_entrar, es_dueno)
   - tabla que falta → 404 PGRST205; columna que falta → 400 PGRST204;
     RLS → 42501; clave foránea → 23503; NOT NULL / CHECK / tipos → los del SQL.

   Lo que NO imita: realtime, triggers, políticas por fila, transacciones entre
   sentencias, el orden de las filas sin ORDER BY (acá es el de inserción). */
import { leerEsquema, valorPorDefecto, violacion, type EsquemaSql, type FkSql } from "./_sql";

export type Fila = Record<string, unknown>;

export interface Peticion {
  n: number;
  tipo: "select" | "upsert" | "update" | "delete" | "rpc";
  tabla: string;
  /** upsert: las filas tal como llegaron. */
  filas?: Fila[];
  /** update: las columnas que cambian. */
  cambios?: Fila;
  ids?: string[];
  columnas?: string[];
  /** La cabecera Prefer del pedido (resolution=merge-duplicates, missing=default…). */
  prefer?: string;
  url: string;
  /** Qué contestó la base. */
  codigo?: string;
}

export interface Resultado { status: number; body?: unknown }

export interface OpcionesBase {
  /** Con false, no se validan NOT NULL / tipos / CHECK de las tablas que el SQL define. */
  validarEsquema?: boolean;
  /** Con false, no se validan las claves foráneas. */
  validarFks?: boolean;
  /** Claves foráneas extra (las de las tablas base, que no están en el repo). */
  fksExtra?: FkSql[];
}

/* Las tablas del ERP que vienen de antes de este repo (no hay SQL que las cree). */
export const FKS_DE_LA_BASE: FkSql[] = [
  /* memoria del proyecto: «ventas.contactoId tiene FK a leads.id» */
  { hijo: "ventas", columna: "contactoId", padre: "leads", alBorrar: "restrict", archivo: "(base)" },
];

export class BaseFalsa {
  tablas = new Map<string, Map<string, Fila>>();
  /** Si es un Set, sólo esas tablas existen (las demás dan PGRST205). */
  existentes: Set<string> | null = null;
  /** tabla → columnas que la base «todavía no tiene» (PGRST204). */
  columnasFaltantes = new Map<string, Set<string>>();
  log: Peticion[] = [];
  esDueno = true;
  puedeEntrar = true;
  /** Si no existe la función, la llamada da 404 (PGRST202). */
  funciones = new Set(["puede_entrar", "es_dueno"]);
  /** tabla → quién puede escribir (RLS). Devolver false → 42501. */
  puedeEscribir: ((tabla: string, op: "upsert" | "update" | "delete") => boolean) | null = null;
  /** Para meter fallas a mano: si devuelve algo, esa es la respuesta. */
  falla: ((p: Peticion) => Resultado | null) | null = null;
  /** Para frenar las respuestas (probar qué pasa con una operación en vuelo). */
  compuerta: Promise<void> | null = null;
  esquema: EsquemaSql;
  fks: FkSql[];
  private n = 0;
  private opciones: Required<Pick<OpcionesBase, "validarEsquema" | "validarFks">>;

  constructor(op: OpcionesBase = {}) {
    this.opciones = { validarEsquema: op.validarEsquema ?? true, validarFks: op.validarFks ?? true };
    this.esquema = leerEsquema();
    this.fks = [...this.esquema.fks, ...FKS_DE_LA_BASE, ...(op.fksExtra ?? [])];
  }

  tabla(nombre: string): Map<string, Fila> {
    let t = this.tablas.get(nombre);
    if (!t) { t = new Map(); this.tablas.set(nombre, t); }
    return t;
  }
  filas(nombre: string): Fila[] { return [...this.tabla(nombre).values()]; }
  /** Carga filas sin pasar por las reglas (para armar el punto de partida). */
  poner(nombre: string, filas: Fila[]) {
    for (const f of filas) this.tabla(nombre).set(String(f.id), JSON.parse(JSON.stringify(f)));
  }
  /** Una copia de los datos (para volver a ellos sin volver a sembrar). */
  foto(): Map<string, Map<string, Fila>> {
    return new Map([...this.tablas].map(([t, filas]) => [t, new Map([...filas].map(([id, f]) => [id, JSON.parse(JSON.stringify(f)) as Fila]))]));
  }
  /** Vuelve a los datos de una foto y borra el registro y las fallas armadas. */
  restaurar(foto: Map<string, Map<string, Fila>>) {
    this.vaciar();
    for (const [t, filas] of foto) this.tablas.set(t, new Map([...filas].map(([id, f]) => [id, JSON.parse(JSON.stringify(f)) as Fila])));
  }
  /** Deja la base como nueva: sin datos, sin registro de pedidos y sin ninguna de las fallas armadas. */
  vaciar() {
    this.tablas.clear(); this.log = []; this.n = 0;
    this.existentes = null; this.columnasFaltantes.clear(); this.esDueno = true; this.puedeEntrar = true;
    this.funciones = new Set(["puede_entrar", "es_dueno"]); this.puedeEscribir = null; this.falla = null; this.compuerta = null;
  }
  peticiones(tipo?: Peticion["tipo"], tabla?: string) {
    return this.log.filter((p) => (!tipo || p.tipo === tipo) && (!tabla || p.tabla === tabla));
  }

  existe(nombre: string): boolean { return this.existentes ? this.existentes.has(nombre) : true; }

  /* ---------- HTTP ---------- */

  async atender(entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : (entrada as Request).url);
    const metodo = (init?.method ?? "GET").toUpperCase();
    const partes = url.pathname.split("/").filter(Boolean);
    if (this.compuerta) await this.compuerta;
    await Promise.resolve();
    if (partes[0] !== "rest" || partes[1] !== "v1") return this.responder({ status: 404, body: { code: "PGRST000", message: "ruta desconocida" } });
    const nombre = partes[2];
    const cuerpo = typeof init?.body === "string" && init.body ? JSON.parse(init.body) : undefined;
    const prefer = new Headers(init?.headers).get("prefer") ?? "";
    const base: Peticion = { n: ++this.n, tipo: "select", tabla: nombre, prefer, url: url.pathname + url.search };

    if (nombre === "rpc") {
      const fn = partes[3];
      const p: Peticion = { ...base, tipo: "rpc", tabla: `rpc/${fn}` };
      this.log.push(p);
      if (!this.funciones.has(fn)) return this.responder({ status: 404, body: { code: "PGRST202", message: `Could not find the function public.${fn}` } }, p);
      return this.responder({ status: 200, body: fn === "puede_entrar" ? this.puedeEntrar : fn === "es_dueno" ? this.esDueno : null }, p);
    }

    const ids = this.idsDelFiltro(url);
    let p: Peticion;
    if (metodo === "GET") p = { ...base, tipo: "select", ids: ids?.ids };
    else if (metodo === "POST") p = { ...base, tipo: "upsert", filas: Array.isArray(cuerpo) ? cuerpo : [cuerpo], columnas: url.searchParams.get("columns")?.split(",").map((x) => x.replace(/"/g, "")) };
    else if (metodo === "PATCH") p = { ...base, tipo: "update", cambios: cuerpo, ids: ids?.ids };
    else if (metodo === "DELETE") p = { ...base, tipo: "delete", ids: ids?.ids };
    else return this.responder({ status: 405, body: {} });
    this.log.push(p);

    const manual = this.falla?.(p);
    if (manual) return this.responder(manual, p);
    if (!this.existe(nombre)) return this.responder({ status: 404, body: { code: "PGRST205", message: `Could not find the table 'public.${nombre}' in the schema cache` } }, p);

    if (p.tipo === "select") return this.responder(this.seleccionar(nombre, url, ids), p);
    const op = p.tipo as "upsert" | "update" | "delete";
    if (this.puedeEscribir && !this.puedeEscribir(nombre, op)) {
      return this.responder({ status: 403, body: { code: "42501", message: `new row violates row-level security policy for table "${nombre}"` } }, p);
    }
    if (p.tipo === "upsert") return this.responder(this.upsert(nombre, p.filas!, prefer, p.columnas), p);
    if (p.tipo === "update") return this.responder(this.actualizar(nombre, cuerpo, ids), p);
    return this.responder(this.borrar(nombre, ids), p);
  }

  private responder(r: Resultado, p?: Peticion): Response {
    /* status 0: se cortó la red (fetch rechaza). */
    if (r.status === 0) { if (p) p.codigo = "red"; throw new TypeError("fetch failed"); }
    if (p) p.codigo = (r.body as { code?: string } | undefined)?.code ?? String(r.status);
    if (r.status === 204 || r.status === 201 && r.body === undefined) return new Response(null, { status: r.status });
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }

  /* id=eq.X · id=in.(a,b,"c,d") · id=neq.X */
  private idsDelFiltro(url: URL): { op: "eq" | "in" | "neq"; ids: string[] } | null {
    const v = url.searchParams.get("id");
    if (!v) return null;
    const m = /^(eq|in|neq)\.(.*)$/s.exec(v);
    if (!m) return null;
    if (m[1] !== "in") return { op: m[1] as "eq" | "neq", ids: [m[2]] };
    const lista = m[2].replace(/^\(/, "").replace(/\)$/, "");
    const ids: string[] = [];
    let actual = "", enComilla = false;
    for (let i = 0; i < lista.length; i++) {
      const c = lista[i];
      if (c === '"') { enComilla = !enComilla; continue; }
      if (c === "," && !enComilla) { ids.push(actual); actual = ""; continue; }
      actual += c;
    }
    if (actual !== "" || lista.length) ids.push(actual);
    return { op: "in", ids };
  }

  private seleccionar(nombre: string, url: URL, f: ReturnType<BaseFalsa["idsDelFiltro"]>): Resultado {
    let filas = this.filas(nombre);
    if (f) filas = filas.filter((x) => (f.op === "neq" ? !f.ids.includes(String(x.id)) : f.ids.includes(String(x.id))));
    const desde = Number(url.searchParams.get("offset") ?? 0);
    const lim = url.searchParams.get("limit");
    const cortado = lim === null ? filas.slice(desde) : filas.slice(desde, desde + Number(lim));
    return { status: 200, body: JSON.parse(JSON.stringify(cortado)) };
  }

  private columnaFalta(nombre: string, cols: Iterable<string>): Resultado | null {
    const faltan = this.columnasFaltantes.get(nombre);
    if (!faltan) return null;
    for (const c of cols) if (faltan.has(c)) return { status: 400, body: { code: "PGRST204", message: `Could not find the '${c}' column of '${nombre}' in the schema cache` } };
    return null;
  }

  private upsert(nombre: string, filas: Fila[], prefer: string, columnas?: string[]): Resultado {
    const union = new Set<string>(columnas ?? filas.flatMap((f) => Object.keys(f)));
    const falta = this.columnaFalta(nombre, union);
    if (falta) return falta;
    const t = this.tabla(nombre);
    const sql = this.esquema.tablas.get(nombre);
    const mezcla = prefer.includes("merge-duplicates");
    const nuevas: [string, Fila][] = [];
    const vistos = new Set<string>();
    for (const f of filas) {
      if (f.id === undefined || f.id === null) return { status: 400, body: { code: "23502", message: `null value in column "id" of relation "${nombre}" violates not-null constraint` } };
      const id = String(f.id);
      if (vistos.has(id)) return { status: 400, body: { code: "21000", message: "ON CONFLICT DO UPDATE command cannot affect row a second time" } };
      vistos.add(id);
      const previa = t.get(id);
      if (previa && !mezcla) return { status: 409, body: { code: "23505", message: `duplicate key value violates unique constraint "${nombre}_pkey"` } };
      /* Lo que queda en la fila: la previa con las columnas de la unión pisadas (lo que falta en esta
         fila pero está en la unión toma el default: null). */
      const resultante: Fila = previa ? { ...previa } : {};
      for (const c of union) {
        if (c in f && f[c] !== undefined) resultante[c] = f[c];
        else if (sql?.columnas.has(c) && (!previa || true)) { const d = valorPorDefecto(sql.columnas.get(c)!); if (d !== undefined) resultante[c] = d; else if (c !== "id") resultante[c] = null; }
        else if (c !== "id") resultante[c] = null;
      }
      if (!previa && sql) {
        for (const [c, col] of sql.columnas) {
          if (!(c in resultante) || resultante[c] === undefined) { const d = valorPorDefecto(col); if (d !== undefined) resultante[c] = d; }
        }
      }
      if (this.opciones.validarEsquema && sql) {
        const v = violacion(sql, resultante, !previa);
        if (v) return { status: 400, body: v };
      }
      if (this.opciones.validarFks) {
        const v = this.revisarFks(nombre, resultante);
        if (v) return { status: 409, body: v };
      }
      nuevas.push([id, resultante]);
    }
    for (const [id, fila] of nuevas) t.set(id, fila);
    return { status: 201 };
  }

  private revisarFks(nombre: string, fila: Fila): { code: string; message: string } | null {
    for (const fk of this.fks) {
      if (fk.hijo !== nombre) continue;
      const v = fila[fk.columna];
      if (v === null || v === undefined) continue;
      if (!this.tabla(fk.padre).has(String(v))) {
        return { code: "23503", message: `insert or update on table "${nombre}" violates foreign key constraint on "${fk.columna}" → ${fk.padre}(id): Key (${fk.columna})=(${v}) is not present in table "${fk.padre}".` };
      }
    }
    return null;
  }

  private actualizar(nombre: string, cambios: Fila, f: ReturnType<BaseFalsa["idsDelFiltro"]>): Resultado {
    const falta = this.columnaFalta(nombre, Object.keys(cambios));
    if (falta) return falta;
    const t = this.tabla(nombre);
    const sql = this.esquema.tablas.get(nombre);
    const previos = f ? f.ids.filter((id) => t.has(id)) : [...t.keys()];
    const salida: [string, Fila][] = [];
    for (const id of previos) {
      const fila: Fila = { ...t.get(id)!, ...cambios };
      if (this.opciones.validarEsquema && sql) { const v = violacion(sql, fila, false); if (v) return { status: 400, body: v }; }
      if (this.opciones.validarFks) { const v = this.revisarFks(nombre, fila); if (v) return { status: 409, body: v }; }
      salida.push([id, fila]);
    }
    for (const [id, fila] of salida) t.set(id, fila);
    return { status: 204 };
  }

  private borrar(nombre: string, f: ReturnType<BaseFalsa["idsDelFiltro"]>): Resultado {
    const t = this.tabla(nombre);
    const ids = f ? (f.op === "neq" ? [...t.keys()].filter((id) => !f.ids.includes(id)) : f.ids.filter((id) => t.has(id))) : [...t.keys()];
    if (this.opciones.validarFks) {
      /* Primero ver que nada se rompa, después aplicar. */
      for (const fk of this.fks) {
        if (fk.padre !== nombre || fk.alBorrar !== "restrict") continue;
        for (const fila of this.filas(fk.hijo)) {
          if (ids.includes(String(fila[fk.columna]))) {
            return { status: 409, body: { code: "23503", message: `update or delete on table "${nombre}" violates foreign key constraint on table "${fk.hijo}"` } };
          }
        }
      }
    }
    for (const id of ids) {
      t.delete(id);
      if (!this.opciones.validarFks) continue;
      for (const fk of this.fks) {
        if (fk.padre !== nombre) continue;
        const hijo = this.tabla(fk.hijo);
        for (const [hid, fila] of [...hijo]) {
          if (String(fila[fk.columna]) !== id) continue;
          if (fk.alBorrar === "cascade") hijo.delete(hid);
          else if (fk.alBorrar === "set null") hijo.set(hid, { ...fila, [fk.columna]: null });
        }
      }
    }
    return { status: 204 };
  }
}

/** Instala la base como fetch global. Devuelve cómo volver atrás. */
export function instalar(base: BaseFalsa) {
  const original = globalThis.fetch;
  globalThis.fetch = ((entrada: RequestInfo | URL, init?: RequestInit) => base.atender(entrada, init)) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

/** Variables de entorno de la nube falsa: tienen que estar puestas ANTES de que alguien importe src/lib/supabase.ts
 *  (que decide al evaluarse si hay nube). Por eso este módulo las pone al cargarse: hay que importarlo PRIMERO. */
export function prepararEntorno() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://nube-falsa.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-falsa";
}
prepararEntorno();

/** Espera a que la cola de escritura del store se vacíe (o falle). */
export async function esperarCola(estadoSync: () => string, maxVueltas = 5000) {
  for (let i = 0; i < maxVueltas; i++) {
    if (estadoSync() !== "guardando") return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error("la cola no se vació");
}

/** Deja pasar un par de vueltas del event loop. */
export const respirar = (n = 3) => new Promise<void>((r) => { let i = 0; const f = () => (++i >= n ? r() : setImmediate(f)); setImmediate(f); });

/** Espera (con tope) a que se cumpla algo, mirando cada 20 ms: para lo que depende de un temporizador del store (la recarga que sigue a una
 *  escritura negada espera 400 ms) sin atar la prueba a cuánto tarda la máquina. */
export async function esperarHasta(condicion: () => boolean, tope = 8000): Promise<boolean> {
  const fin = Date.now() + tope;
  while (Date.now() < fin) {
    if (condicion()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return condicion();
}
