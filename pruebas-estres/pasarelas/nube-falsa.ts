/* Una nube de mentira para las pruebas de estrés: un PostgREST mínimo en
   memoria (lo justo que usan lib/servidor.ts y las rutas de /api) y un
   `fetch` que reparte los pedidos: los de Supabase a esa base, los de las
   pasarelas a lo que cada prueba les conteste, y TODO lo demás se corta
   (no hay red). Nada sale de la máquina.

   Qué entiende del PostgREST real:
   - GET con filtros eq / neq / in / gte / lte / is, select=… y limit.
   - POST (insertar) con «resolution=ignore-duplicates» (upsert que no pisa),
     «resolution=merge-duplicates» (upsert que pisa) o sin nada (un duplicado
     es un 409, como en Postgres); «return=representation» devuelve sólo lo
     que realmente entró.
   - PATCH (update) y DELETE con los mismos filtros.
   Las claves únicas se declaran por tabla: un choque con otra clave única
   que la del «on_conflict» es un error 23505, igual que en Postgres. */

type Fila = Record<string, unknown>;

export interface Pedido { metodo: string; url: string; cuerpo?: string }

export class NubeFalsa {
  tablas = new Map<string, Fila[]>();
  /* Las claves únicas de cada tabla (la primera es la PK). */
  unicas = new Map<string, string[][]>();
  pedidos: Pedido[] = [];
  /* Las funciones (rpc) que contesta: puede_entrar, nivel_area, es_dueno, mi_acceso… */
  rpc = new Map<string, (args: Record<string, unknown>) => unknown>();
  /* Lo máximo que devuelve un pedido: PostgREST corta en 1000 sin avisar (el valor por defecto de Supabase). */
  maxFilas = 1000;
  /* Para contar lo que se escribió. */
  escrituras: { tabla: string; metodo: string; filas: number }[] = [];

  constructor() {
    this.declarar("movimientos", [["id"], ["proveedor", "referencia"]]);
    this.declarar("devoluciones", [["id"]]);
    this.declarar("sesiones", [["id"], ["calendlyInvitadoUri"]]);
    for (const t of ["pagos", "cuotas", "ventas", "procesadores", "contactos", "leads", "traspasos", "capi_enviados", "webinars", "ads", "registros_webinar", "etapas", "actividad", "equipo", "yt_estado", "grabaciones", "fathom_conexion", "ajustes"]) this.declarar(t, [["id"]]);
  }

  declarar(tabla: string, unicas: string[][]) {
    if (!this.tablas.has(tabla)) this.tablas.set(tabla, []);
    this.unicas.set(tabla, unicas);
  }

  filas(tabla: string): Fila[] { return this.tablas.get(tabla) ?? []; }

  /** Una foto de la tabla, ordenada por id, para comparar corridas. `omitir`: columnas que cambian solas (creadoEn). */
  foto(tabla: string, omitir: string[] = ["creadoEn"]): string {
    const sinOmitidas = (f: Fila) => Object.fromEntries(Object.entries(f).filter(([k]) => !omitir.includes(k)));
    return JSON.stringify([...this.filas(tabla)].map(sinOmitidas).sort((a, b) => String(a.id).localeCompare(String(b.id))));
  }

  /** Deja todas las tablas vacías (y borra el historial de pedidos). */
  vaciar() {
    for (const t of this.tablas.keys()) this.tablas.set(t, []);
    this.pedidos = [];
    this.escrituras = [];
  }

  private json(status: number, cuerpo: unknown): Response {
    return new Response(cuerpo === undefined ? null : JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
  }

  private error(status: number, code: string, message: string): Response {
    return this.json(status, { code, message, details: null, hint: null });
  }

  async atender(url: URL, init: RequestInit): Promise<Response> {
    const metodo = (init.method ?? "GET").toUpperCase();
    const f = /^\/rest\/v1\/rpc\/([^/]+)$/.exec(url.pathname);
    if (f) {
      const fn = this.rpc.get(f[1]);
      if (!fn) return this.error(404, "PGRST202", `Could not find the function public.${f[1]} in the schema cache`);
      let args: Record<string, unknown> = {};
      try { args = typeof init.body === "string" && init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {}; } catch { /* sin argumentos */ }
      return this.json(200, fn(args));
    }
    const m = /^\/rest\/v1\/([^/]+)$/.exec(url.pathname);
    if (!m) return this.error(404, "PGRST125", `Ruta no soportada por la nube falsa: ${url.pathname}`);
    const tabla = m[1];
    if (!this.tablas.has(tabla)) return this.error(404, "PGRST205", `Could not find the table 'public.${tabla}' in the schema cache`);
    const prefer = String(new Headers(init.headers).get("prefer") ?? "");
    const filas = this.filas(tabla);
    const cuerpoTexto = typeof init.body === "string" ? init.body : "";
    this.pedidos.push({ metodo, url: decodeURIComponent(url.toString()), cuerpo: cuerpoTexto || undefined });

    if (metodo === "GET" || metodo === "HEAD") {
      let sel = filas.filter((f) => cumple(f, url));
      const off = url.searchParams.get("offset");
      if (off) sel = sel.slice(Number(off));
      const lim = url.searchParams.get("limit");
      if (lim) sel = sel.slice(0, Number(lim));
      sel = sel.slice(0, this.maxFilas);
      return this.json(200, sel.map((f) => proyectar(f, url.searchParams.get("select"))));
    }

    if (metodo === "POST") {
      let entra: Fila[];
      try {
        const j = JSON.parse(cuerpoTexto) as Fila | Fila[];
        entra = Array.isArray(j) ? j : [j];
      } catch { return this.error(400, "PGRST102", "Invalid JSON"); }
      const ignorar = /ignore-duplicates/.test(prefer);
      const fusionar = /merge-duplicates/.test(prefer);
      const devolver = /return=representation/.test(prefer);
      const unicas = this.unicas.get(tabla) ?? [];
      /* Un upsert sin on_conflict usa la clave primaria, como PostgREST. */
      const pedido = (url.searchParams.get("on_conflict") ?? "").split(",").filter(Boolean);
      const onConflict = pedido.length ? pedido : ignorar || fusionar ? (unicas[0] ?? []) : [];
      const adentro: Fila[] = [];
      /* Postgres hace todo o nada: se prueba sobre una copia. */
      const copia = filas.map((f) => ({ ...f }));
      for (const nueva of entra) {
        const choque = (claves: string[]) => copia.find((f) => claves.every((k) => f[k] !== undefined && f[k] === nueva[k]));
        const arbitro = onConflict.length ? choque(onConflict) : undefined;
        if (arbitro) {
          if (ignorar) continue;
          if (fusionar) { Object.assign(arbitro, nueva); adentro.push(arbitro); continue; }
          return this.error(409, "23505", `duplicate key value violates unique constraint "${tabla}_${onConflict.join("_")}_key"`);
        }
        /* Cualquier OTRA clave única que choque es un error, aunque se haya pedido ignorar duplicados. */
        for (const claves of unicas) {
          if (onConflict.length && claves.join() === onConflict.join()) continue;
          if (choque(claves)) return this.error(409, "23505", `duplicate key value violates unique constraint "${tabla}_${claves.join("_")}_key"`);
        }
        const fila = { ...nueva };
        copia.push(fila);
        adentro.push(fila);
      }
      this.tablas.set(tabla, copia);
      this.escrituras.push({ tabla, metodo, filas: adentro.length });
      return devolver ? this.json(201, adentro) : this.json(201, undefined);
    }

    if (metodo === "PATCH") {
      let cambios: Fila;
      try { cambios = JSON.parse(cuerpoTexto) as Fila; } catch { return this.error(400, "PGRST102", "Invalid JSON"); }
      const sel = filas.filter((f) => cumple(f, url));
      for (const f of sel) Object.assign(f, cambios);
      this.escrituras.push({ tabla, metodo, filas: sel.length });
      return /return=representation/.test(prefer) ? this.json(200, sel) : this.json(204, undefined);
    }

    if (metodo === "DELETE") {
      const quedan = filas.filter((f) => !cumple(f, url));
      this.escrituras.push({ tabla, metodo, filas: filas.length - quedan.length });
      this.tablas.set(tabla, quedan);
      return this.json(204, undefined);
    }
    return this.error(405, "PGRST", `Método ${metodo} no soportado`);
  }
}

const NO_FILTROS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

/* «in.(a,b,"c,d")» → ["a", "b", "c,d"] */
function lista(v: string): string[] {
  const dentro = v.replace(/^\(/, "").replace(/\)$/, "");
  const out: string[] = [];
  let cur = "", comillas = false;
  for (const c of dentro) {
    if (c === '"') { comillas = !comillas; continue; }
    if (c === "," && !comillas) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (dentro !== "") out.push(cur);
  return out;
}

function cumple(f: Fila, url: URL): boolean {
  for (const [k, v] of url.searchParams.entries()) {
    if (NO_FILTROS.has(k)) continue;
    let valor = v;
    let negado = false;
    if (valor.startsWith("not.")) { negado = true; valor = valor.slice(4); }
    const punto = valor.indexOf(".");
    const op = valor.slice(0, punto), val = valor.slice(punto + 1);
    /* «extra->formulariosMeta»: un campo adentro de una columna JSON. */
    const x = k.includes("->") ? k.split("->").reduce<unknown>((a, c) => (a && typeof a === "object" ? (a as Fila)[c] : undefined), f) : f[k];
    if (negado) { if (cumpleUno(op, val, x)) return false; continue; }
    if (!cumpleUno(op, val, x)) return false;
  }
  return true;
}

function cumpleUno(op: string, val: string, x: unknown): boolean {
  {
    switch (op) {
      case "eq": if (String(x) !== val) return false; break;
      case "neq": if (String(x) === val) return false; break;
      case "in": if (!lista(val).includes(String(x))) return false; break;
      case "gte": if (!(x !== undefined && x !== null && String(x) >= val)) return false; break;
      case "lte": if (!(x !== undefined && x !== null && String(x) <= val)) return false; break;
      case "ilike": if (!aLike(val).test(String(x ?? ""))) return false; break;
      case "like": if (!aLike(val, "").test(String(x ?? ""))) return false; break;
      case "cs": break; /* contains de JSON: la nube falsa no lo evalúa (deja pasar todo) */
      case "is": if (val === "null" ? !(x === null || x === undefined) : String(x) !== val) return false; break;
      default: return false;
    }
  }
  return true;
}

/* El patrón de like/ilike de PostgREST (con «\\%», «\\_» y «\\\\» escapados) a una expresión regular. */
function aLike(patron: string, banderas = "i"): RegExp {
  let re = "";
  for (let i = 0; i < patron.length; i++) {
    const c = patron[i];
    if (c === "\\" && i + 1 < patron.length) { re += patron[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue; }
    if (c === "%" || c === "*") re += ".*";
    else if (c === "_") re += ".";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, banderas);
}

function proyectar(f: Fila, select: string | null): Fila {
  if (!select || select === "*") return f;
  const cols = select.split(",").map((s) => s.trim()).filter((s) => s && !s.includes("{") && !s.includes("("));
  const o: Fila = {};
  for (const c of cols) if (c in f) o[c] = f[c];
  return o;
}

/* ---------- El fetch ---------- */

export type Respuesta = Response | { status?: number; json?: unknown; texto?: string };
export type Manejador = (url: URL, init: RequestInit) => Respuesta | Promise<Respuesta> | undefined;

export interface Instalada {
  nube: NubeFalsa;
  /** Cuántos pedidos salieron a cada host. */
  hosts: Map<string, number>;
  /** Hosts a los que se intentó llegar y no estaban previstos. */
  bloqueados: string[];
  /** Una función para atender pasarelas: devuelve undefined si no la atiende. */
  manejar: (m: Manejador) => void;
  /** Quita todos los manejadores registrados con `manejar` (y el historial de hosts y bloqueos). */
  soltar: () => void;
  restaurar: () => void;
}

export const URL_NUBE = "http://nube-falsa.supabase.test";

/** Instala un `fetch` global que atiende la nube falsa y lo que se registre con `manejar`. */
export function instalarFetchFalso(nube = new NubeFalsa()): Instalada {
  const original = globalThis.fetch;
  const manejadores: Manejador[] = [];
  const hosts = new Map<string, number>();
  const bloqueados: string[] = [];
  globalThis.fetch = (async (entrada: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.toString() : (entrada as Request).url);
    hosts.set(url.host, (hosts.get(url.host) ?? 0) + 1);
    if (url.origin === URL_NUBE) return nube.atender(url, init);
    for (const m of manejadores) {
      const r = await m(url, init);
      if (!r) continue;
      if (r instanceof Response) return r;
      return new Response(r.texto ?? JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
    }
    bloqueados.push(url.toString());
    throw new TypeError(`fetch failed: la red está cortada en las pruebas (${url.host})`);
  }) as typeof fetch;
  return {
    nube, hosts, bloqueados,
    manejar: (m) => { manejadores.push(m); },
    soltar: () => { manejadores.length = 0; hosts.clear(); bloqueados.length = 0; },
    restaurar: () => { globalThis.fetch = original; },
  };
}
