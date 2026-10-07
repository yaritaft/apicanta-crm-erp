/* Ayudas para las pruebas de estrés del almacén (no es una prueba: no termina en .test.ts).

   - mulberry32: generador con semilla. Cuando una propiedad falla, el mensaje
     imprime la semilla para repetir el caso.
   - tipos: lee src/lib/types.ts con el compilador de TypeScript y arma, a partir de
     la propia definición de cada interface, filas aleatorias «con datos raros»
     (acentos, comillas, emoji, textos largos, montos fraccionarios, ceros,
     negativos, números enormes). Así un campo nuevo entra solo en las pruebas. */
import ts from "typescript";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function mulberry32(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Azar = ReturnType<typeof azar>;

export function azar(semilla: number) {
  const r = mulberry32(semilla);
  const api = {
    semilla,
    r,
    entero: (a: number, b: number) => a + Math.floor(r() * (b - a + 1)),
    pick: <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)],
    prob: (p: number) => r() < p,
    mezclar: <T,>(xs: readonly T[]): T[] => {
      const c = [...xs];
      for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; }
      return c;
    },
  };
  return api;
}

/* ---------- Valores raros ---------- */

const TEXTOS_RAROS = [
  "", " ", "  con espacios  ", "Ñandú Ünïcode áéíóú", "comillas \"dobles\" y 'simples'", "barra \\ invertida", "salto\nde línea\ty tab",
  "emoji 🚀 y más 👩‍💻", "<script>alert(1)</script>", "'; drop table pagos; --", "%20%25 ya codificado", "a,b(c)d", "uno;dos", "{\"json\":true}",
  "0", "-1", "null", "undefined", "NaN", "2026-02-30", "2026-10-07T18:00:00.000Z", "x".repeat(2000), "日本語のテキスト", "ZWSP​Aquí",
];

const NUMEROS_RAROS = [0, 1, -1, 0.1, 0.2, 0.1 + 0.2, 1 / 3, 99.995, 1234.5678, 1e-7, 123456789.12, 9007199254740991, 1e21, -250.5, 0.005, 2.675];

export function textoRaro(a: Azar): string {
  const t = a.pick(TEXTOS_RAROS);
  return a.prob(0.5) ? t : `${t}${a.entero(0, 999)}`;
}
export function numeroRaro(a: Azar): number {
  return a.prob(0.5) ? a.pick(NUMEROS_RAROS) : Math.round(a.r() * 1e6) / 100;
}
export function fechaRara(a: Azar): string {
  const ms = Date.UTC(2024, 0, 1) + Math.floor(a.r() * 3 * 365 * 86400000);
  const d = new Date(ms);
  return a.prob(0.3) ? d.toISOString().slice(0, 10) : d.toISOString();
}

/* ---------- Tipos de types.ts ---------- */

export interface CampoDeTipo { nombre: string; opcional: boolean; tipo: ts.TypeNode }
const ruta = resolve(RAIZ, "src", "lib", "types.ts");
const fuente = ts.createSourceFile(ruta, readFileSync(ruta, "utf8"), ts.ScriptTarget.ES2022, true);
export const INTERFACES = new Map<string, CampoDeTipo[]>();
export const ALIAS = new Map<string, ts.TypeNode>();
for (const st of fuente.statements) {
  if (ts.isInterfaceDeclaration(st)) {
    INTERFACES.set(st.name.text, st.members.filter(ts.isPropertySignature).map((m) => ({
      nombre: m.name.getText(fuente), opcional: Boolean(m.questionToken), tipo: m.type as ts.TypeNode,
    })));
  } else if (ts.isTypeAliasDeclaration(st)) ALIAS.set(st.name.text, st.type);
}

/** Los nombres de los campos de una interface de types.ts. */
export function camposDe(interfaz: string): string[] {
  const c = INTERFACES.get(interfaz);
  if (!c) throw new Error(`types.ts no tiene la interface ${interfaz}`);
  return c.map((x) => x.nombre);
}

let contadorId = 0;
export const idAzar = (a: Azar, prefijo = "x") => `${prefijo}_${a.entero(0, 1e9).toString(36)}${(contadorId++).toString(36)}`;

/** Un valor al azar para un nodo de tipo. `ids` son ids reales de la colección a la que apunta, si se conocen. */
function valorDeTipo(a: Azar, t: ts.TypeNode, nombre: string, prof: number, ctx: ContextoFila): unknown {
  if (ts.isParenthesizedTypeNode(t)) return valorDeTipo(a, t.type, nombre, prof, ctx);
  switch (t.kind) {
    case ts.SyntaxKind.StringKeyword: return textoPara(a, nombre, ctx);
    case ts.SyntaxKind.NumberKeyword: return numeroPara(a, nombre);
    case ts.SyntaxKind.BooleanKeyword: return a.prob(0.5);
    case ts.SyntaxKind.UnknownKeyword:
    case ts.SyntaxKind.AnyKeyword: return a.pick([textoRaro(a), numeroRaro(a), true, null, [], {}]);
    case ts.SyntaxKind.NullKeyword: return null;
    case ts.SyntaxKind.UndefinedKeyword: return undefined;
    default: break;
  }
  if (ts.isLiteralTypeNode(t)) {
    if (t.literal.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isStringLiteral(t.literal)) return t.literal.text;
    if (ts.isNumericLiteral(t.literal)) return Number(t.literal.text);
    if (t.literal.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (t.literal.kind === ts.SyntaxKind.FalseKeyword) return false;
    return null;
  }
  if (ts.isUnionTypeNode(t)) {
    const opciones = t.types.filter((x) => x.kind !== ts.SyntaxKind.UndefinedKeyword);
    return valorDeTipo(a, a.pick(opciones), nombre, prof, ctx);
  }
  if (ts.isArrayTypeNode(t)) {
    if (prof > 3) return [];
    return Array.from({ length: a.entero(0, 3) }, () => valorDeTipo(a, t.elementType, nombre, prof + 1, ctx));
  }
  if (ts.isTupleTypeNode(t)) return t.elements.map((x) => valorDeTipo(a, x, nombre, prof + 1, ctx));
  if (ts.isTypeLiteralNode(t)) {
    if (prof > 3) return {};
    const o: Record<string, unknown> = {};
    for (const m of t.members) {
      if (!ts.isPropertySignature(m) || !m.type) continue;
      if (m.questionToken && a.prob(0.4)) continue;
      o[m.name.getText(fuente)] = valorDeTipo(a, m.type, m.name.getText(fuente), prof + 1, ctx);
    }
    return o;
  }
  if (ts.isIntersectionTypeNode(t)) return Object.assign({}, ...t.types.map((x) => { const v = valorDeTipo(a, x, nombre, prof + 1, ctx); return typeof v === "object" && v ? v : {}; }));
  if (ts.isTypeReferenceNode(t)) {
    const n = t.typeName.getText(fuente);
    if (n === "ID") return textoPara(a, nombre, ctx);
    if (n === "Record" || n === "Partial") {
      const v = t.typeArguments?.[1];
      const o: Record<string, unknown> = {};
      if (prof > 3) return o;
      const claves = (() => {
        const k = t.typeArguments?.[0];
        const lit = k && ALIAS.get(k.getText(fuente));
        if (lit && ts.isUnionTypeNode(lit)) return lit.types.filter(ts.isLiteralTypeNode).map((x) => (x.literal as ts.StringLiteral).text);
        return Array.from({ length: a.entero(0, 3) }, () => `k${a.entero(0, 99)}`);
      })();
      for (const k of claves) if (a.prob(0.6)) o[k] = v ? valorDeTipo(a, v, k, prof + 1, ctx) : textoRaro(a);
      return o;
    }
    if (["Pick", "Omit", "Required", "Readonly", "NonNullable"].includes(n)) return {};
    const alias = ALIAS.get(n);
    if (alias) return valorDeTipo(a, alias, nombre, prof + 1, ctx);
    const interfaz = INTERFACES.get(n);
    if (interfaz) return filaDeInterface(a, n, ctx, prof + 1);
    return textoRaro(a);
  }
  if (t.kind === ts.SyntaxKind.TemplateLiteralType) return a.pick(["azul1", "verde3", "rojo5"]);
  return textoRaro(a);
}

export interface ContextoFila {
  /** Los ids que ya existen por colección: los campos «xxxId» apuntan a alguno. */
  ids?: Record<string, string[]>;
  /** Con true, los textos son siempre «normales» (sin comillas ni saltos de línea). */
  limpio?: boolean;
}

const COLECCION_DE_CAMPO: Record<string, string> = {
  leadId: "leads", contactoId: "leads", alumnoId: "alumnos", ventaId: "ventas", cuotaId: "cuotas", movimientoId: "movimientos",
  pagoId: "pagos", procesadorId: "procesadores", productoId: "productos", embudoId: "embudos", closerId: "equipo", setterId: "equipo",
  directorId: "equipo", webinarId: "webinars", etapaId: "etapas", etapaServicioId: "etapasServicio", sesionId: "sesiones",
  origenWebinarId: "webinars", cuentaId: "procesadores", miembroId: "equipo", gastoId: "gastos", origenId: "procesadores", destinoId: "procesadores",
};

function textoPara(a: Azar, nombre: string, ctx: ContextoFila): string {
  const col = COLECCION_DE_CAMPO[nombre];
  const ids = col ? ctx.ids?.[col] : undefined;
  if (ids?.length) return a.pick(ids);
  if (/^(fecha|inicia|vence|creadoEn|actualizadoEn|.*En|desde|hasta|dia|semanaDel)$/.test(nombre) && !/^(.*Por|.*Nota)$/.test(nombre)) return fechaRara(a);
  if (ctx.limpio) return `${a.pick(["Ana", "Luis", "Marta", "Pablo"])} ${a.entero(0, 999)}`;
  return textoRaro(a);
}

function numeroPara(a: Azar, nombre: string): number {
  if (/(rate|tasa|probabilidad)/i.test(nombre)) return Math.round(a.r() * 1000) / 1000;
  if (/^(orden|numero|cadenciaDias|diaDelMes|intentos|tamanio|duracionMin)/.test(nombre)) return a.entero(0, 400);
  return numeroRaro(a);
}

/** Una fila al azar con la forma de la interface. Los campos opcionales aparecen a veces. */
export function filaDeInterface(a: Azar, interfaz: string, ctx: ContextoFila = {}, prof = 0): Record<string, unknown> {
  const campos = INTERFACES.get(interfaz);
  if (!campos) throw new Error(`types.ts no tiene la interface ${interfaz}`);
  const o: Record<string, unknown> = {};
  for (const c of campos) {
    if (c.opcional && a.prob(0.45)) continue;
    const v = valorDeTipo(a, c.tipo, c.nombre, prof, ctx);
    if (v !== undefined) o[c.nombre] = v;
  }
  if (!("id" in o) && campos.some((c) => c.nombre === "id")) o.id = idAzar(a, interfaz.slice(0, 3).toLowerCase());
  return o;
}

/** Clona por JSON, como lo hace el respaldo (sin undefined). */
export const porJson = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
