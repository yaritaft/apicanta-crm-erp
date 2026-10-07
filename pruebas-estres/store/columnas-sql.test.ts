/* Estrés del almacén, frente 2: los campos de los tipos y las columnas del SQL dicen lo mismo.

   La app manda a la base la fila entera (`upsert`) con los nombres de los campos
   de types.ts. Si un campo no tiene su columna, la base contesta PGRST204 y el
   store lo SACA en silencio y reintenta (columnaFaltante): la app anda, pero ese
   dato no se guarda nunca. Si una columna existe y el tipo no la conoce, la
   pantalla no la ve. Las dos cosas se ven recién en producción: por eso se
   comparan acá, leyendo types.ts con el compilador y los .sql como texto. */
import test from "node:test";
import assert from "node:assert/strict";
import { COLUMNAS_QUE_PONE_LA_BASE } from "@/lib/control-cobros";
import { camposDe, INTERFACES } from "./_aleatorio";
import { leerEsquema } from "./_sql";

const esquema = leerEsquema();

/* Qué interface de types.ts es la fila de cada tabla. */
const INTERFAZ: Record<string, string> = {
  pagos: "Pago", ventas: "Venta", cuotas: "Cuota", sesiones: "Sesion", gastos: "Gasto", procesadores: "Procesador",
  ajustes: "Ajustes", contactos: "Contacto", leads: "Lead", alumnos: "Alumno", movimientos: "Movimiento",
  devoluciones: "Devolucion", gastos_recurrentes: "GastoRecurrente", seguimiento_alumnos: "SeguimientoAlumno",
  testimonios: "Testimonio", equipo: "MiembroEquipo", webinars: "Webinar", tipos_cuenta: "TipoCuenta",
  etapas_servicio: "EtapaServicio", honorarios: "EsquemaPago", liquidaciones: "Liquidacion", traspasos: "Traspaso",
  arqueos: "Arqueo", comentarios: "Comentario", campaigns: "Campaign", adsets: "Adset", ads: "Ad", ad_insights: "AdInsight",
  embudos: "Embudo", actividad: "Actividad",
};

/* Columnas que existen en la base y que el tipo NO tiene a propósito: las pone la base y la app no las lee. */
const COLUMNAS_SIN_CAMPO: Record<string, string[]> = {
  /* «Quién creó cada persona/lead/actividad»: lo completa la base con el correo de la sesión (tipos-cuenta.sql). */
  contactos: ["creadoPor"], leads: ["creadoPor"], actividad: ["creadoPor"],
};

/* Los campos que se agregaron en los lotes del 07/10 (diferencia de types.ts contra la versión del 02/10). */
const NUEVOS_DE_HOY: Record<string, string[]> = {
  sesiones: ["estadoLlamadaEn", "estadoPreCallEn", "ventaPorOtro"],
  ventas: ["sesionId"],
  pagos: ["chequeoDirector", "chequeoDirectorPor", "chequeoDirectorEn", "chequeoDirectorNota", "chequeoFinanzas", "chequeoFinanzasPor", "chequeoFinanzasEn", "chequeoFinanzasNota", "cargadoPor"],
  gastos: ["fechaPago"],
  procesadores: ["cajaOtros"],
  ajustes: ["seguimiento"],
};

const columnasDe = (tabla: string) => [...(esquema.tablas.get(tabla)?.columnas.keys() ?? [])];

test("los campos nuevos de hoy existen como columna en algún supabase/*.sql", () => {
  for (const [tabla, campos] of Object.entries(NUEVOS_DE_HOY)) {
    const cols = new Set(columnasDe(tabla));
    const tipo = new Set(camposDe(INTERFAZ[tabla]));
    for (const c of campos) {
      assert.ok(tipo.has(c), `${INTERFAZ[tabla]}.${c} no está en types.ts`);
      assert.ok(cols.has(c), `${INTERFAZ[tabla]}.${c} no tiene columna en ${tabla}: el store la sacaría en silencio y no se guardaría nunca`);
    }
  }
});

test("las tablas que el SQL define entero tienen EXACTAMENTE los campos del tipo (en las dos direcciones)", () => {
  const sinDiferencia: string[] = [];
  for (const [tabla, interfaz] of Object.entries(INTERFAZ)) {
    const t = esquema.tablas.get(tabla);
    if (!t?.creada) continue;
    const columnas = new Set(columnasDe(tabla));
    const campos = new Set(camposDe(interfaz));
    const extra = COLUMNAS_SIN_CAMPO[tabla] ?? [];
    const sinColumna = [...campos].filter((c) => !columnas.has(c));
    const sinCampo = [...columnas].filter((c) => !campos.has(c) && !extra.includes(c));
    if (sinColumna.length || sinCampo.length) {
      sinDiferencia.push(`${tabla} (${interfaz}): campos sin columna [${sinColumna.join(", ")}] · columnas sin campo [${sinCampo.join(", ")}]`);
    }
  }
  assert.deepEqual(sinDiferencia, [], `\n${sinDiferencia.join("\n")}`);
});

test("toda columna que un ALTER agrega a una tabla base es un campo del tipo", () => {
  const faltan: string[] = [];
  for (const [tabla, interfaz] of Object.entries(INTERFAZ)) {
    const t = esquema.tablas.get(tabla);
    if (!t || t.creada) continue;
    const campos = new Set(camposDe(interfaz));
    for (const c of t.columnas.keys()) if (!campos.has(c) && !(COLUMNAS_SIN_CAMPO[tabla] ?? []).includes(c)) faltan.push(`${tabla}.${c}`);
  }
  assert.deepEqual(faltan, [], `columnas del SQL que ${INTERFAZ.pagos} & co. no conocen: ${faltan.join(", ")}`);
});

test("las tablas con columnas agregadas por ALTER sobre las que el tipo ya tenía: no se pierde ninguna", () => {
  /* Contactos: nace en contactos.sql y recibe en calendly.sql las columnas de la persona. */
  const c = new Set(columnasDe("contactos"));
  for (const campo of camposDe("Contacto")) assert.ok(c.has(campo), `contactos.${campo} no tiene columna`);
});

test("COLUMNAS_QUE_PONE_LA_BASE son columnas reales de pagos y las llena el trigger del SQL", () => {
  const cols = new Set(columnasDe("pagos"));
  for (const c of COLUMNAS_QUE_PONE_LA_BASE) assert.ok(cols.has(c), `pagos.${c} no existe en el SQL`);
  /* El trigger de control-cruzado.sql las sella todas: ninguna se manda desde la app. */
  const trigger = esquema.tablas.get("pagos")?.columnas.get("cargadoPor")?.archivos[0];
  assert.equal(trigger, "supabase/control-cruzado.sql");
  const campos = new Set(camposDe("Pago"));
  for (const c of COLUMNAS_QUE_PONE_LA_BASE) assert.ok(campos.has(c), `Pago.${c} no está en types.ts`);
  /* Las de la base son exactamente cargadoPor y los dos casilleros de chequeo (4 columnas cada uno). */
  assert.equal(COLUMNAS_QUE_PONE_LA_BASE.length, 9);
  assert.deepEqual(
    [...COLUMNAS_QUE_PONE_LA_BASE].sort(),
    ["cargadoPor", ...["Director", "Finanzas"].flatMap((r) => ["", "Por", "En", "Nota"].map((s) => `chequeo${r}${s}`))].sort(),
  );
});

test("las colecciones de EstadoApp que se guardan en una tabla tienen interface y tabla", () => {
  /* Un camino corto para que un tipo nuevo (con su tabla) no se olvide del mapa de arriba. */
  for (const t of ["devoluciones", "gastos_recurrentes", "seguimiento_alumnos", "testimonios"]) {
    assert.ok(INTERFAZ[t] && INTERFACES.has(INTERFAZ[t]), `${t}: falta su interface en el mapa de la prueba`);
  }
});

test("las columnas NOT NULL sin default de las tablas nuevas son campos obligatorios del tipo (si no, la fila la rechaza la base)", () => {
  const problemas: string[] = [];
  for (const tabla of ["devoluciones", "gastos_recurrentes", "seguimiento_alumnos", "testimonios", "traspasos", "arqueos"]) {
    const t = esquema.tablas.get(tabla)!;
    const interfaz = INTERFACES.get(INTERFAZ[tabla])!;
    for (const [nombre, c] of t.columnas) {
      if (c.clave || !c.noNulo || c.porDefecto !== null) continue;
      const campo = interfaz.find((x) => x.nombre === nombre);
      if (campo?.opcional) problemas.push(`${tabla}.${nombre} es NOT NULL sin default pero ${INTERFAZ[tabla]}.${nombre} es opcional`);
    }
  }
  assert.deepEqual(problemas, []);
});

test("las columnas con default y NOT NULL que el tipo deja opcional se completan solas (no hay que mandarlas)", () => {
  /* defaultToNull:false: un campo que falta toma el DEFAULT de la columna en vez de NULL. Si una columna NOT NULL sin default
     fuera opcional en el tipo, el upsert fallaría con 23502 para siempre y trabaría la cola. Esto es lo mismo desde otro lado. */
  const quedan: string[] = [];
  for (const [tabla, interfaz] of Object.entries(INTERFAZ)) {
    const t = esquema.tablas.get(tabla);
    if (!t?.creada) continue;
    const campos = INTERFACES.get(interfaz)!;
    for (const [nombre, c] of t.columnas) {
      if (c.clave || !c.noNulo || c.porDefecto !== null) continue;
      const campo = campos.find((x) => x.nombre === nombre);
      if (campo?.opcional) quedan.push(`${tabla}.${nombre}`);
    }
  }
  assert.deepEqual(quedan, [], `columnas NOT NULL sin default cuyo campo es opcional: ${quedan.join(", ")}`);
});
