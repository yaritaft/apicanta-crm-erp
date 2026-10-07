import type { Ajustes, EstadoApp, Gasto, GrupoGasto, ID, MiembroEquipo, Moneda, RolEquipo } from "./types";
import { aMonedaBase, escribirMonto, leerMonto, montoOriginal, normalizar } from "./gastos";
import { embudoDeGasto } from "./embudos";

/* ==================================================================
   Cargar un gasto: lo que decide el asistente, sin React, para poder
   probarlo.

   - Los pasos de cada camino. Un gasto nuevo pregunta de a una cosa;
     repetir uno que ya se cargó salta directo a revisarlo (no se vuelve a
     preguntar lo que ya se sabe); editar abre todo junto.
   - Lo que falta para poder cargarlo. El proveedor es obligatorio.
   - A quién se le pagó: el equipo y los proveedores que ya se usaron, en
     el orden que conviene según la categoría.
   ================================================================== */

/* ---------- Los pasos ---------- */

export type PasoId = "concepto" | "categoria" | "proveedor" | "monto" | "fecha" | "revisar";

/* nuevo: de cero · repetir: se eligió «ya cargaste algo parecido» · editar: ya existía */
export type ModoCarga = "nuevo" | "repetir" | "editar";

export interface PasoCarga { id: PasoId; titulo: string }

const PASO: Record<PasoId, PasoCarga> = {
  concepto:  { id: "concepto",  titulo: "Qué pagaste" },
  categoria: { id: "categoria", titulo: "Categoría" },
  proveedor: { id: "proveedor", titulo: "Proveedor" },
  monto:     { id: "monto",     titulo: "Monto" },
  fecha:     { id: "fecha",     titulo: "Fecha" },
  revisar:   { id: "revisar",   titulo: "Revisá y cargá" },
};

export function modoDeCarga(x: { editando: boolean; copiadoDe?: string }): ModoCarga {
  if (x.editando) return "editar";
  return x.copiadoDe ? "repetir" : "nuevo";
}

/** Los pasos que se recorren en cada camino. Al repetir un gasto, la
 *  categoría, el proveedor, el monto y la fecha ya vienen puestos: se
 *  revisan todos juntos en un solo paso y se corrige ahí mismo lo que haga
 *  falta. Al editar se abre directo esa misma revisión. */
export function pasosDeCarga(modo: ModoCarga): PasoCarga[] {
  switch (modo) {
    case "editar": return [{ ...PASO.revisar, titulo: "Revisá y guardá" }];
    case "repetir": return [PASO.concepto, PASO.revisar];
    default: return [PASO.concepto, PASO.categoria, PASO.proveedor, PASO.monto, PASO.fecha, PASO.revisar];
  }
}

/** La grilla con todas las categorías aparece sólo si todavía no hay una
 *  (ni sugerida ni elegida) o si se pidió cambiarla. Si no, se muestra la
 *  categoría ya puesta como una tarjeta para confirmarla. */
export function mostrarGrilla(categoria: string, pidioCambiar: boolean): boolean {
  return !categoria.trim() || pidioCambiar;
}

/* ---------- El borrador ---------- */

export interface BorradorGasto {
  concepto: string;
  categoria: string;
  grupo: GrupoGasto;
  /* Elegida a mano o copiada de un gasto anterior: la sugerencia ya no la pisa. */
  categoriaElegida: boolean;
  /* Categoría que no existía: hay que decir en qué bloque cae. */
  nueva: boolean;
  /* Texto, no número: se escribe como se escribe acá ("145.000", "1.500,50")
     y lo lee leerMonto. Un input numérico leería "145.000" como 145. */
  monto: string;
  moneda: Moneda;
  tipoCambio: string;
  fecha: string;
  recurrente: boolean;
  /* El nombre tal como se escribe: una persona del equipo o un proveedor. */
  proveedor: string;
  webinarId: string;
  /* La estrategia (embudo) a la que se le carga: entra en su CAC y su profit. */
  embudoId: string;
  notas: string;
  /* El gasto anterior del que se copió, para marcarlo en la lista. */
  copiadoDe?: string;
}

const redondear = (n: number) => Math.round(n * 100) / 100;

/* Mediodía y no medianoche: la fecha no se corre de día con el huso. */
export const mediodia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).toISOString();

/* El tipo de cambio de Ajustes, escrito como se escribe en el campo. */
export const tipoCambioDeAjustes = (a: Pick<Ajustes, "tipoCambio">): string =>
  a.tipoCambio > 0 ? escribirMonto(a.tipoCambio) : "";

/** El borrador con el que arranca el asistente: vacío, o el gasto que se edita. */
export function borradorInicial(
  ajustes: Pick<Ajustes, "monedaBase" | "tipoCambio">, gasto?: Gasto | null, hoy: Date = new Date(),
): BorradorGasto {
  const base = ajustes.monedaBase;
  const tc = tipoCambioDeAjustes(ajustes);
  if (!gasto) {
    return {
      concepto: "", categoria: "", grupo: "operativo", categoriaElegida: false, nueva: false,
      monto: "", moneda: base, tipoCambio: tc, fecha: mediodia(hoy), recurrente: false,
      proveedor: "", webinarId: "", embudoId: "", notas: "",
    };
  }
  const orig = montoOriginal(gasto);
  return {
    concepto: gasto.concepto, categoria: gasto.categoria, grupo: gasto.grupo,
    categoriaElegida: true, nueva: false,
    monto: escribirMonto(orig ? orig.monto : gasto.monto),
    moneda: orig ? orig.moneda : (gasto.moneda ?? base),
    tipoCambio: orig ? escribirMonto(orig.tipoCambio) : tc,
    fecha: gasto.fecha, recurrente: Boolean(gasto.recurrente),
    proveedor: gasto.proveedor ?? "", webinarId: gasto.webinarId ?? "", embudoId: embudoDeGasto(gasto) ?? "", notas: gasto.notas ?? "",
  };
}

/** Lo que se copia al repetir un gasto de antes: lo que suele repetirse
 *  (categoría, monto, moneda, proveedor, si es fijo) y no lo que es de esa
 *  vez (la fecha, el webinar, las notas, el tipo de cambio de ese día: el
 *  de hoy es el de Ajustes). */
export function cambiosAlRepetir(g: Gasto, tipoCambioDeHoy: string): Partial<BorradorGasto> {
  const orig = montoOriginal(g);
  return {
    concepto: g.concepto, categoria: g.categoria, grupo: g.grupo, categoriaElegida: true, nueva: false,
    monto: escribirMonto(orig ? orig.monto : g.monto), moneda: orig ? orig.moneda : g.moneda,
    tipoCambio: tipoCambioDeHoy,
    proveedor: g.proveedor ?? "", recurrente: Boolean(g.recurrente), copiadoDe: g.id,
  };
}

/* ---------- Lo que falta para poder cargarlo ---------- */

export type CampoGasto = "concepto" | "categoria" | "proveedor" | "monto" | "tipoCambio" | "fecha";
export type ProblemasGasto = Partial<Record<CampoGasto, string>>;

/* Una sola letra no es un nombre: seguro es un error de tipeo. */
export const esProveedorValido = (texto: string): boolean => texto.trim().length >= 2;

export const MENSAJE_PROVEEDOR = "Elegí o escribí a quién le pagaste";

/** Todo lo que falta o está mal, campo por campo. Sirve para pintar cada
 *  casillero y para decidir si se puede cargar. */
export function problemasDelGasto(
  b: Pick<BorradorGasto, "concepto" | "categoria" | "proveedor" | "monto" | "moneda" | "tipoCambio" | "fecha">,
  base: Moneda,
): ProblemasGasto {
  const p: ProblemasGasto = {};
  if (b.concepto.trim().length < 2) p.concepto = "Contá qué pagaste";
  if (!b.categoria.trim()) p.categoria = "Elegí una categoría";
  if (!esProveedorValido(b.proveedor)) p.proveedor = MENSAJE_PROVEEDOR;
  if (!(leerMonto(b.monto) > 0)) p.monto = "Escribí cuánto fue";
  if (b.moneda !== base && !(leerMonto(b.tipoCambio) > 0)) p.tipoCambio = "Escribí el tipo de cambio";
  if (Number.isNaN(new Date(b.fecha).getTime())) p.fecha = "Elegí la fecha";
  return p;
}

/** Lo que impide pasar de este paso (null: se puede seguir). En el último
 *  paso cuenta todo, en el orden en que se lee la pantalla. */
export function problemaDelPaso(
  paso: PasoId, b: Parameters<typeof problemasDelGasto>[0], base: Moneda,
): string | null {
  const p = problemasDelGasto(b, base);
  switch (paso) {
    case "concepto": return p.concepto ?? null;
    case "categoria": return p.categoria ?? null;
    case "proveedor": return p.proveedor ?? null;
    case "monto": return p.monto ?? p.tipoCambio ?? null;
    case "fecha": return p.fecha ?? null;
    default: return p.concepto ?? p.categoria ?? p.monto ?? p.tipoCambio ?? p.fecha ?? p.proveedor ?? null;
  }
}

/* ---------- A quién se le pagó ---------- */

export interface OpcionProveedor {
  /* Lo que queda escrito en el gasto. */
  nombre: string;
  grupo: "equipo" | "usado";
  /* Debajo del nombre: el puesto o el rol de una persona del equipo; de un
     proveedor, cuántos gastos tiene y en qué categoría fue el último. */
  detalle: string;
  /* De alguien del equipo: quién es, para dejarlo anotado en el gasto. */
  equipoId?: ID;
  /* Del equipo: ya no está. */
  inactivo?: boolean;
  /* De un proveedor usado: en cuántos gastos aparece. */
  usos?: number;
}

export const TITULO_GRUPO_PROVEEDOR: Record<OpcionProveedor["grupo"], string> = {
  equipo: "Equipo",
  usado: "Proveedores que ya usaste",
};

/* El rol en las ventas, para quien no tiene un puesto cargado. «No vende»
   no dice nada de a quién se le paga: queda en «Equipo». */
const ROL_EN_VENTAS: Record<RolEquipo, string> = {
  closer: "Closer", setter: "Setter", director: "Director comercial", growth: "Growth partner",
  socio: "Socio", ceo: "CEO", otro: "",
};

/** Lo que se lee debajo del nombre de alguien del equipo: su puesto
 *  («COO», «Editor») o, si no tiene, su rol. */
export function detalleDeMiembro(m: Pick<MiembroEquipo, "puesto" | "rol" | "activo">): string {
  const base = m.puesto?.trim() || ROL_EN_VENTAS[m.rol] || "Equipo";
  return m.activo ? base : `${base} · ya no está`;
}

/* Las categorías en las que se le paga a una persona del equipo: las mismas
   a las que va lo que sale de Equipo y honorarios (lib/honorarios.ts). */
const CATEGORIAS_DE_PERSONAS = new Set(["equipo / salarios", "honorarios del ceo", "setters", "edicion de contenido", "filmmaker"]);
/* Y las que alguien creó con nombre de sueldo u honorario («Sueldos extra»).
   «Viáticos equipo» no: ahí se le paga a una aerolínea, no al equipo. */
const NOMBRE_DE_PERSONAS = /^equipo\b|\b(salari|sueldo|honorari|nomina)/;

/** ¿Es una categoría donde se le paga a alguien del equipo (sueldos,
 *  honorarios, setters)? Ahí el equipo va primero en la lista. */
export function esCategoriaDeEquipo(categoria: string, grupo?: GrupoGasto): boolean {
  const c = normalizar(categoria);
  if (!c) return false;
  return CATEGORIAS_DE_PERSONAS.has(c) || NOMBRE_DE_PERSONAS.test(c) || grupo === "dueno";
}

interface Uso {
  /* Cómo se escribió, y cuántas veces de cada manera. */
  variantes: Map<string, number>;
  n: number;
  ultima: string;
  categoria: string;
  enCategoria: boolean;
}

const limpiarNombre = (s: string) => s.trim().replace(/\s+/g, " ");

const masRecientePrimero = (a: Gasto, b: Gasto) =>
  +new Date(b.fecha) - +new Date(a.fecha) || +new Date(b.creadoEn || b.fecha) - +new Date(a.creadoEn || a.fecha);

/** La lista para elegir a quién se le pagó: las personas del equipo (los
 *  activos primero) y los proveedores que ya se usaron en otros gastos,
 *  uno por nombre. Con una categoría de sueldos u honorarios va primero el
 *  equipo; con cualquier otra, primero los proveedores, y entre ellos los
 *  que ya se usaron en esa misma categoría. */
export function opcionesProveedor(
  e: Pick<EstadoApp, "equipo" | "gastos">, categoria = "", grupo?: GrupoGasto,
): OpcionProveedor[] {
  const cat = normalizar(categoria);

  /* Cómo se usó cada nombre, del gasto más reciente al más viejo. «Meta»,
     «meta » y «META» son uno solo: queda escrito como se lo escribió más
     veces (y, si empatan, como se lo escribió la última). */
  const usos = new Map<string, Uso>();
  for (const g of [...e.gastos].sort(masRecientePrimero)) {
    const nombre = limpiarNombre(g.proveedor ?? "");
    const k = normalizar(nombre);
    if (!k) continue;
    const enCategoria = Boolean(cat) && normalizar(g.categoria) === cat;
    const u = usos.get(k);
    if (u) {
      u.n += 1;
      u.enCategoria = u.enCategoria || enCategoria;
      u.variantes.set(nombre, (u.variantes.get(nombre) ?? 0) + 1);
    } else {
      usos.set(k, { variantes: new Map([[nombre, 1]]), n: 1, ultima: g.fecha, categoria: g.categoria, enCategoria });
    }
  }
  const comoSeEscribe = (u: Uso) => {
    let mejor = ""; let veces = 0;
    for (const [nombre, n] of u.variantes) if (n > veces) { mejor = nombre; veces = n; }
    return mejor;
  };

  const delEquipo = new Set<string>();
  const equipo = e.equipo
    .map((m) => ({ m, nombre: limpiarNombre(m.nombre ?? "") }))
    .filter(({ nombre }) => nombre)
    .map(({ m, nombre }) => {
      delEquipo.add(normalizar(nombre));
      const o: OpcionProveedor = { nombre, grupo: "equipo", detalle: detalleDeMiembro(m), equipoId: m.id };
      if (!m.activo) o.inactivo = true;
      return { o, activo: m.activo, enCategoria: Boolean(usos.get(normalizar(nombre))?.enCategoria) };
    })
    .sort((a, b) =>
      Number(b.activo) - Number(a.activo)
      || Number(b.enCategoria) - Number(a.enCategoria)
      || a.o.nombre.localeCompare(b.o.nombre, "es"))
    .map((x) => x.o);

  /* Quien ya está en el equipo no se repite entre los proveedores. */
  const usados = [...usos.entries()]
    .filter(([k]) => !delEquipo.has(k))
    .map(([, u]) => u)
    .sort((a, b) =>
      Number(b.enCategoria) - Number(a.enCategoria)
      || +new Date(b.ultima) - +new Date(a.ultima)
      || comoSeEscribe(a).localeCompare(comoSeEscribe(b), "es"))
    .map((u): OpcionProveedor => ({
      nombre: comoSeEscribe(u), grupo: "usado", usos: u.n,
      detalle: `${u.n} ${u.n === 1 ? "gasto" : "gastos"}${u.categoria ? ` · ${u.categoria}` : ""}`,
    }));

  return esCategoriaDeEquipo(categoria, grupo) ? [...equipo, ...usados] : [...usados, ...equipo];
}

/* Cuánto calza lo escrito con una opción: menor es mejor, -1 no calza. */
function puntajeDe(o: OpcionProveedor, q: string): number {
  const n = normalizar(o.nombre);
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  const palabras = n.split(" ");
  if (q.split(" ").every((t) => palabras.some((p) => p.startsWith(t)))) return 2;
  if (n.includes(q)) return 3;
  /* A alguien del equipo también se lo encuentra por lo que hace: «coo», «closer». */
  if (o.grupo === "equipo" && normalizar(o.detalle).includes(q)) return 4;
  return -1;
}

/** Las opciones que calzan con lo que se escribió, sin tildes ni mayúsculas
 *  y por cualquier palabra del nombre. Los grupos quedan en su orden; dentro
 *  de cada uno, primero lo que mejor calza. */
export function filtrarProveedores(opciones: readonly OpcionProveedor[], texto: string): OpcionProveedor[] {
  const q = normalizar(texto);
  if (!q) return [...opciones];
  const ordenDeGrupo = new Map<string, number>();
  for (const o of opciones) if (!ordenDeGrupo.has(o.grupo)) ordenDeGrupo.set(o.grupo, ordenDeGrupo.size);
  return opciones
    .map((o, i) => ({ o, i, puntaje: puntajeDe(o, q) }))
    .filter((x) => x.puntaje >= 0)
    .sort((a, b) =>
      (ordenDeGrupo.get(a.o.grupo) ?? 0) - (ordenDeGrupo.get(b.o.grupo) ?? 0) || a.puntaje - b.puntaje || a.i - b.i)
    .map((x) => x.o);
}

/** Lo escrito no es ninguna de las opciones: se ofrece usarlo como proveedor nuevo. */
export function esProveedorNuevo(opciones: readonly OpcionProveedor[], texto: string): boolean {
  const q = normalizar(texto);
  return q.length >= 2 && !opciones.some((o) => normalizar(o.nombre) === q);
}

/** El nombre como queda guardado. Si lo escrito es una opción de la lista
 *  (aunque sea con otras mayúsculas o sin tildes) se usa la de la lista, y
 *  si es alguien del equipo se anota quién es; si no, es un proveedor nuevo
 *  y queda como se escribió. */
export function resolverProveedor(
  texto: string, opciones: readonly OpcionProveedor[],
): { nombre: string; equipoId?: ID } {
  const limpio = limpiarNombre(texto);
  const q = normalizar(limpio);
  if (!q) return { nombre: "" };
  const igual = opciones.find((o) => normalizar(o.nombre) === q);
  if (!igual) return { nombre: limpio };
  return igual.equipoId ? { nombre: igual.nombre, equipoId: igual.equipoId } : { nombre: igual.nombre };
}

/** A quién del equipo se le pagó (vive en `extra`): no hace falta una
 *  columna nueva y el proveedor sigue siendo un texto. */
export const equipoDeGasto = (g: { extra?: Record<string, unknown> }): ID | undefined =>
  (typeof g.extra?.proveedorEquipoId === "string" && g.extra.proveedorEquipoId) || undefined;

/* ---------- Lo que se guarda ---------- */

/* Al editar, un campo que se vació tiene que viajar como null: la cola de
   escritura saca los undefined y la base se quedaría con el valor viejo. */
const vaciar = (antes: unknown) => (antes ? (null as unknown as undefined) : undefined);

/** El gasto tal como se guarda. Lo pagado en otra moneda queda tal cual
 *  en `extra`, al lado del monto convertido que es el que suma el estado
 *  de resultados. */
export function datosDelGasto(
  b: BorradorGasto,
  c: { base: Moneda; previo?: Gasto | null; opciones: readonly OpcionProveedor[]; ahora?: string },
): Omit<Gasto, "id"> {
  const previo = c.previo ?? undefined;
  const montoNum = leerMonto(b.monto) || 0;
  const tc = leerMonto(b.tipoCambio) || 0;
  const convertido = redondear(aMonedaBase(montoNum, b.moneda, c.base, tc));
  const prov = resolverProveedor(b.proveedor, c.opciones);

  /* Lo que maneja este asistente se rearma de cero; el resto del `extra`
     (de dónde vino el gasto, qué liquidación lo cargó) se conserva. */
  const {
    montoOriginal: _m, monedaOriginal: _o, tipoCambio: _t, embudoId: _e, proveedorEquipoId: _p, ...extraLimpio
  } = previo?.extra ?? {};
  const propio: Record<string, unknown> = { ...extraLimpio };
  if (b.embudoId) propio.embudoId = b.embudoId;
  if (prov.equipoId) propio.proveedorEquipoId = prov.equipoId;
  if (b.moneda !== c.base) {
    propio.montoOriginal = redondear(montoNum);
    propio.monedaOriginal = b.moneda;
    propio.tipoCambio = tc;
  }

  return {
    categoria: b.categoria.trim(),
    grupo: b.grupo,
    concepto: b.concepto.trim(),
    monto: convertido,
    moneda: c.base,
    fecha: b.fecha,
    recurrente: b.recurrente,
    webinarId: b.webinarId || vaciar(previo?.webinarId),
    proveedor: prov.nombre || vaciar(previo?.proveedor),
    notas: b.notas.trim() || vaciar(previo?.notas),
    creadoEn: previo?.creadoEn ?? c.ahora ?? new Date().toISOString(),
    extra: propio,
  };
}
