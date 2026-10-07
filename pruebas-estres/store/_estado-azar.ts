/* Un estado completo al azar, con datos raros pero VÁLIDOS (no es una prueba).

   Sale de las interfaces de types.ts (así cada campo nuevo entra solo), con los ids que apuntan a otras
   colecciones elegidos entre los que existen (claves foráneas), y ajustado a lo que el SQL exige (enteros,
   rangos de CHECK, listas de valores). Es lo que podría traer un respaldo de verdad, escrito por gente
   rara: acentos, comillas, emoji, textos largos, montos con decimales, ceros y negativos. */
import { azar, type Azar, filaDeInterface, INTERFACES, idAzar, porJson, textoRaro } from "./_aleatorio";
import { leerEsquema } from "./_sql";

const esquema = leerEsquema();

/* colección del estado → interface de types.ts → tabla */
const COLECCIONES: { clave: string; interfaz: string; tabla: string; n: [number, number] }[] = [
  { clave: "etapas", interfaz: "Etapa", tabla: "etapas", n: [2, 5] },
  { clave: "etapasServicio", interfaz: "EtapaServicio", tabla: "etapas_servicio", n: [2, 5] },
  { clave: "productos", interfaz: "Producto", tabla: "productos", n: [2, 5] },
  { clave: "procesadores", interfaz: "Procesador", tabla: "procesadores", n: [2, 5] },
  { clave: "embudos", interfaz: "Embudo", tabla: "embudos", n: [2, 5] },
  { clave: "equipo", interfaz: "MiembroEquipo", tabla: "equipo", n: [2, 5] },
  { clave: "webinars", interfaz: "Webinar", tabla: "webinars", n: [1, 4] },
  { clave: "contactos", interfaz: "Contacto", tabla: "contactos", n: [3, 12] },
  { clave: "leads", interfaz: "Lead", tabla: "leads", n: [3, 12] },
  { clave: "alumnos", interfaz: "Alumno", tabla: "alumnos", n: [2, 8] },
  { clave: "seguimientos", interfaz: "SeguimientoAlumno", tabla: "seguimiento_alumnos", n: [0, 0] },
  { clave: "testimonios", interfaz: "Testimonio", tabla: "testimonios", n: [0, 5] },
  { clave: "sesiones", interfaz: "Sesion", tabla: "sesiones", n: [3, 12] },
  { clave: "reportes", interfaz: "Reporte", tabla: "reportes", n: [0, 5] },
  { clave: "campanias", interfaz: "Campania", tabla: "campanias", n: [0, 3] },
  { clave: "metas", interfaz: "Meta", tabla: "metas", n: [0, 4] },
  { clave: "campos", interfaz: "CampoPersonalizado", tabla: "campos", n: [0, 3] },
  { clave: "ventas", interfaz: "Venta", tabla: "ventas", n: [2, 8] },
  { clave: "cuotas", interfaz: "Cuota", tabla: "cuotas", n: [2, 12] },
  { clave: "movimientos", interfaz: "Movimiento", tabla: "movimientos", n: [0, 6] },
  { clave: "pagos", interfaz: "Pago", tabla: "pagos", n: [2, 10] },
  { clave: "devoluciones", interfaz: "Devolucion", tabla: "devoluciones", n: [0, 4] },
  { clave: "gastos", interfaz: "Gasto", tabla: "gastos", n: [1, 8] },
  { clave: "comentarios", interfaz: "Comentario", tabla: "comentarios", n: [0, 5] },
  { clave: "arqueos", interfaz: "Arqueo", tabla: "arqueos", n: [0, 3] },
  { clave: "traspasos", interfaz: "Traspaso", tabla: "traspasos", n: [0, 3] },
  { clave: "gastosRecurrentes", interfaz: "GastoRecurrente", tabla: "gastos_recurrentes", n: [0, 4] },
  { clave: "actividad", interfaz: "Actividad", tabla: "actividad", n: [1, 8] },
  { clave: "honorarios", interfaz: "EsquemaPago", tabla: "honorarios", n: [0, 3] },
  { clave: "liquidaciones", interfaz: "Liquidacion", tabla: "liquidaciones", n: [0, 3] },
];

/* Los campos que apuntan a otra colección, por colección (lo que el SQL ata con clave foránea
   y lo que las pantallas dan por existente). El resto de los ids son textos sueltos. */
const APUNTA: Record<string, Record<string, string>> = {
  contactos: { origenWebinarId: "webinars" },
  leads: { contactoId: "contactos", etapaId: "etapas", webinarId: "webinars" },
  alumnos: { leadId: "leads", ventaId: "ventas", etapaServicioId: "etapasServicio" },
  seguimientos: { alumnoId: "alumnos" },
  testimonios: { alumnoId: "alumnos" },
  sesiones: { contactoId: "contactos", leadId: "leads", alumnoId: "alumnos" },
  reportes: { alumnoId: "alumnos" },
  ventas: { contactoId: "leads", productoId: "productos", webinarId: "webinars", embudoId: "embudos", closerId: "equipo", directorId: "equipo", setterId: "equipo", sesionId: "sesiones" },
  cuotas: { ventaId: "ventas", closerId: "equipo" },
  movimientos: { procesadorId: "procesadores", pagoId: "pagos", cuotaId: "cuotas", ventaId: "ventas" },
  pagos: { cuotaId: "cuotas", procesadorId: "procesadores", movimientoId: "movimientos" },
  devoluciones: { ventaId: "ventas", procesadorId: "procesadores", sesionId: "sesiones" },
  gastos: { webinarId: "webinars" },
  comentarios: { contactoId: "contactos" },
  traspasos: { origenId: "procesadores", destinoId: "procesadores", gastoId: "gastos" },
  gastosRecurrentes: { cuentaId: "procesadores", webinarId: "webinars" },
  honorarios: { miembroId: "equipo" },
};
const OBLIGATORIOS = new Set(["contactos.origenWebinarId"]);

/** Ajusta una fila a lo que el SQL de esa tabla exige (sin cambiarle el sentido). */
function ajustarASql(a: Azar, tabla: string, fila: Record<string, unknown>) {
  const t = esquema.tablas.get(tabla);
  if (!t) return;
  for (const [col, c] of t.columnas) {
    let v = fila[col];
    if (v === undefined || v === null) continue;
    if (/^(integer|int|smallint)/.test(c.tipo) && typeof v === "number") v = Math.max(-2147483648, Math.min(2147483647, Math.round(v)));
    if (/^bigint/.test(c.tipo) && typeof v === "number") v = Math.round(v);
    if (c.check) {
      const rango = /between\s+(-?\d+)\s+and\s+(-?\d+)/i.exec(c.check);
      if (rango && typeof v === "number") v = Math.max(Number(rango[1]), Math.min(Number(rango[2]), Math.round(v)));
      const lista = /\bin\s*\(([^)]*)\)/i.exec(c.check);
      if (lista && typeof v === "string") { const ok = [...lista[1].matchAll(/'([^']*)'/g)].map((x) => x[1]); if (!ok.includes(v)) v = a.pick(ok); }
    }
    if (/^(date|timestamp)/.test(c.tipo) && typeof v === "string" && Number.isNaN(Date.parse(v))) v = "2026-10-07T12:00:00.000Z";
    fila[col] = v;
  }
}

export interface OpcionesEstado { filas?: number }

/** Un EstadoApp completo (sin los que el respaldo no lleva: Meta, tiposCuenta). */
export function estadoAzar(semilla: number, base: Record<string, unknown>): Record<string, unknown> {
  const a = azar(semilla);
  const estado: Record<string, unknown> = { ...porJson(base) };
  const ids: Record<string, string[]> = {};
  const vistosAlumno = new Set<string>();

  for (const col of COLECCIONES) {
    const apunta = APUNTA[col.clave] ?? {};
    const filas: Record<string, unknown>[] = [];
    const n = col.clave === "seguimientos" ? (ids.alumnos ?? []).length : a.entero(col.n[0], col.n[1]);
    for (let i = 0; i < n; i++) {
      const fila = filaDeInterface(a, col.interfaz, { ids });
      /* Los ids que apuntan a otra colección: uno que existe (o ninguno, si el campo es opcional). */
      for (const [campo, destino] of Object.entries(apunta)) {
        const pool = ids[destino] ?? [];
        const opcional = INTERFACES.get(col.interfaz)!.find((x) => x.nombre === campo)?.opcional && !OBLIGATORIOS.has(`${col.clave}.${campo}`);
        if (!pool.length || (opcional && a.prob(0.35))) delete fila[campo];
        else fila[campo] = a.pick(pool);
      }
      if (col.clave === "seguimientos") {
        const alumnoId = ids.alumnos[i];
        if (vistosAlumno.has(alumnoId)) continue;
        vistosAlumno.add(alumnoId);
        fila.alumnoId = alumnoId; fila.id = `seg_${alumnoId}`;
      }
      if (col.clave === "contactos") { fila.nombre = String(fila.nombre ?? "x"); fila.email = String(fila.email ?? "x"); delete fila.origenAdId; }
      /* Ids únicos dentro de la colección. */
      if (filas.some((x) => x.id === fila.id)) fila.id = idAzar(a, col.clave.slice(0, 3));
      ajustarASql(a, col.tabla, fila);
      filas.push(fila);
    }
    estado[col.clave] = filas;
    ids[col.clave] = filas.map((f) => String(f.id));
  }

  /* Un movimiento y un pago que se apuntan entre sí tienen que existir los dos: sin ciclos raros, el movimiento
     sólo apunta a lo que ya hay. (Los ids ya salen de las listas.) */
  /* Los ajustes: una fila con todos los campos del tipo. */
  const ajustes = filaDeInterface(a, "Ajustes", { ids });
  estado.ajustes = { ...(base.ajustes as object), ...ajustes, tema: a.pick(["dark", "light"]), monedaBase: a.pick(["USD", "ARS"]) };
  ajustarASql(a, "ajustes", estado.ajustes as Record<string, unknown>);
  estado.version = 1;
  void textoRaro;
  return porJson(estado);
}
