import type { Chequeos } from "./finanzas-pasos";
import type { Chequeo } from "./cierre-mes";

/* ==================================================================
   El almacén de lo que se tilda en Finanzas (la weekly, revisar Slack, el cierre
   del día de Aldana…): quién lo hizo y cuándo. Lo ve y lo cambia todo el equipo de
   Finanzas, así que vive en la base (`chequeos_finanzas`, supabase/chequeos-finanzas.sql).

   Es un almacén común a toda la pantalla (el menú que cuenta los días sin cerrar, los
   pasos y el End of Day miran el mismo): lo que se tilda aparece en todos al instante.
   Está separado de React (lib/chequeos-finanzas.ts es el gancho) para poder probarlo
   con una base de mentira, incluidas las fallas:

   - Con la tabla, manda la base: lo que se guarda se ve al instante; si la base lo
     rechaza (sin permiso para editar Finanzas, sin conexión) se desanota y se avisa,
     en vez de quedar tildado en una sola pantalla.
   - Sin la tabla (todavía no se corrió el SQL) o sin nube, queda en el navegador de
     quien lo tilda: la app anda igual y nada se rompe.
   ================================================================== */

export interface ErrorDb { code?: string; message?: string }
export interface Consulta { gte(columna: string, valor: string): Consulta; like(columna: string, patron: string): Consulta; order(columna: string): Consulta; range(desde: number, hasta: number): PromiseLike<{ data: unknown[] | null; error: ErrorDb | null }> }
export interface ClienteChequeos {
  from(tabla: string): {
    select(columnas: string): Consulta;
    upsert(fila: Record<string, unknown>, opciones: { onConflict: string }): PromiseLike<{ error: ErrorDb | null }>;
    delete(): { eq(columna: string, valor: string): PromiseLike<{ error: ErrorDb | null }> };
  };
}
export interface Disco { leer(): Chequeos; escribir(c: Chequeos): void }
export interface Instantanea { chequeos: Chequeos; cargando: boolean; error: string | null }

/* La base devuelve como mucho 1000 filas por pedido: con 19 respuestas por día, en cuatro meses son más. Se pide por páginas. */
export const PAGINA = 1000;
const MAX_PAGINAS = 20;
const DIAS_ATRAS = 120;

const faltaTabla = (e: ErrorDb | null) => e?.code === "PGRST205" || e?.code === "42P01";
const faltaColumna = (e: ErrorDb | null) => e?.code === "42703" || e?.code === "PGRST204";
const sinPermiso = (e: ErrorDb) => e.code === "42501" || e.code === "PGRST301" || e.code === "401" || e.code === "403";
export const textoDelError = (e: ErrorDb) =>
  sinPermiso(e) ? "No se pudo guardar: tu cuenta no puede editar Finanzas." : `No se pudo guardar: ${e.message ?? "la base no contestó"}. Probá de nuevo.`;

type Fila = { clave: string; por?: string | null; en: string; nota?: string | null; estado?: string | null };

export function crearAlmacen(cliente: ClienteChequeos | null, disco: Disco, ahora: () => number = Date.now) {
  let usaNube = Boolean(cliente);
  let sinEstado = false;
  let local: Chequeos = {};
  let remoto: Chequeos = {};
  let pendientes: Record<string, Chequeo | null> = {};
  let cargando = Boolean(cliente);
  let error: string | null = null;
  let iniciado = false;
  /* Para no pisar con una respuesta vieja lo que se escribió mientras se esperaba. */
  let escrituras = 0;
  let pedidoVigente = 0;
  const oyentes = new Set<() => void>();
  /* Dos pantallas que piden a la vez (el menú y los pasos al abrir) comparten el mismo pedido. */
  let enCurso: Promise<void> | null = null;

  const armar = (): Instantanea => {
    if (!usaNube) return { chequeos: local, cargando: false, error };
    const n = { ...remoto };
    for (const [clave, c] of Object.entries(pendientes)) { if (c) n[clave] = c; else delete n[clave]; }
    return { chequeos: n, cargando, error };
  };
  let instantanea = armar();
  const emitir = () => { instantanea = armar(); oyentes.forEach((f) => f()); };

  const guardarLocal = (clave: string, c: Chequeo | null) => {
    const n = { ...disco.leer() };
    if (c) n[clave] = c; else delete n[clave];
    local = n;
    disco.escribir(n);
  };

  async function traer(): Promise<void> {
    if (!cliente || !usaNube) return;
    const mio = ++pedidoVigente;
    const desde = new Date(ahora() - DIAS_ATRAS * 86400000).toISOString();
    const antes = escrituras;
    /* Los pasos del mes que se tildan (mes|aaaa-mm|paso) se piden de cualquier fecha: un mes viejo no puede volver a verse sin tildar.
       Lo demás (el cierre del día) sólo de los últimos meses. */
    const pedir = (columnas: string, de: number, soloDelMes: boolean) => {
      const consulta = cliente.from("chequeos_finanzas").select(columnas);
      return (soloDelMes ? consulta.like("clave", "mes|%") : consulta.gte("en", desde)).order("clave").range(de, de + PAGINA - 1);
    };
    const filas: Fila[] = [];
    for (const soloDelMes of [false, true]) {
      for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
        let r = await pedir(sinEstado ? "clave,por,en,nota" : "clave,por,en,nota,estado", pagina * PAGINA, soloDelMes);
        if (r.error && faltaColumna(r.error) && !sinEstado) { sinEstado = true; r = await pedir("clave,por,en,nota", pagina * PAGINA, soloDelMes); }
        if (r.error) {
          if (faltaTabla(r.error)) { usaNube = false; local = disco.leer(); }
          cargando = false;
          emitir();
          return;
        }
        const lote = (r.data ?? []) as Fila[];
        filas.push(...lote);
        if (lote.length < PAGINA) break;
      }
    }
    if (mio !== pedidoVigente) return;                     // llegó otro pedido más nuevo: manda ése
    if (escrituras !== antes) { await traer(); return; }   // se escribió mientras se esperaba: esta respuesta ya está vieja
    const m: Chequeos = {};
    for (const f of filas) m[String(f.clave)] = { por: f.por ?? undefined, en: String(f.en), nota: f.nota ?? undefined, ...(f.estado ? { estado: f.estado } : {}) };
    remoto = m;
    cargando = false;
    emitir();
  }

  function traerUnaVez(): Promise<void> {
    if (!enCurso) enCurso = traer().finally(() => { enCurso = null; });
    return enCurso;
  }

  async function marcar(clave: string, c: Chequeo): Promise<void> {
    if (!cliente || !usaNube) { guardarLocal(clave, c); emitir(); return; }
    escrituras++;
    pendientes = { ...pendientes, [clave]: c };
    emitir();
    const guardar = () => cliente.from("chequeos_finanzas").upsert(
      { clave, por: c.por, en: c.en, nota: c.nota ?? null, ...(sinEstado ? {} : { estado: c.estado ?? null }) }, { onConflict: "clave" },
    );
    let { error: e } = await guardar();
    if (e && faltaColumna(e) && !sinEstado) { sinEstado = true; ({ error: e } = await guardar()); }
    const { [clave]: _quitada, ...resto } = pendientes; void _quitada;
    pendientes = resto;
    escrituras++;
    if (!e) { remoto = { ...remoto, [clave]: c }; emitir(); return; }
    if (faltaTabla(e)) { usaNube = false; guardarLocal(clave, c); emitir(); return; }
    error = textoDelError(e);
    emitir();
  }

  async function desmarcar(clave: string): Promise<void> {
    if (!cliente || !usaNube) { guardarLocal(clave, null); emitir(); return; }
    escrituras++;
    pendientes = { ...pendientes, [clave]: null };
    emitir();
    const { error: e } = await cliente.from("chequeos_finanzas").delete().eq("clave", clave);
    const { [clave]: _quitada, ...resto } = pendientes; void _quitada;
    pendientes = resto;
    escrituras++;
    if (!e) { const { [clave]: _borrada, ...sin } = remoto; void _borrada; remoto = sin; emitir(); return; }
    if (faltaTabla(e)) { usaNube = false; guardarLocal(clave, null); emitir(); return; }
    error = textoDelError(e);
    emitir();
  }

  return {
    /* La primera vez lee lo guardado en el navegador y pide la base. */
    iniciar(): Promise<void> {
      if (!iniciado) { iniciado = true; local = disco.leer(); emitir(); }
      return traerUnaVez();
    },
    traer: traerUnaVez,
    marcar,
    desmarcar,
    /* Otra pestaña cambió lo del navegador. */
    alCambiarElDisco() { if (!usaNube) { local = disco.leer(); emitir(); } },
    limpiarError() { if (error) { error = null; emitir(); } },
    obtener: (): Instantanea => instantanea,
    suscribir(f: () => void) { oyentes.add(f); return () => { oyentes.delete(f); }; },
  };
}
