/* Lector mínimo de los supabase/*.sql y sql/*.sql (no es una prueba).

   No es un parser de SQL: entiende lo que estos archivos usan de verdad
   (create table, alter table … add column, claves foráneas y los CHECK de
   `in (…)` y `between`). Lo suficiente para comparar el SQL contra los tipos
   de la app y para validar las filas que el store manda a la base. */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { RAIZ } from "./_aleatorio";

export interface ColumnaSql {
  nombre: string;
  tipo: string;
  noNulo: boolean;
  /** `default …` en la definición (o clave primaria: nunca llega vacía). */
  porDefecto: string | null;
  clave: boolean;
  check: string | null;
  referencia: { tabla: string; alBorrar: "cascade" | "set null" | "restrict" } | null;
  archivos: string[];
}
export interface TablaSql {
  nombre: string;
  columnas: Map<string, ColumnaSql>;
  /** Los archivos que la crean o le agregan columnas. */
  archivos: Set<string>;
  creada: boolean;
}
export interface FkSql { hijo: string; columna: string; padre: string; alBorrar: "cascade" | "set null" | "restrict"; archivo: string }

export const SQL_DIRS = [resolve(RAIZ, "supabase"), resolve(RAIZ, "sql")];

export function archivosSql(): { nombre: string; texto: string }[] {
  const salida: { nombre: string; texto: string }[] = [];
  for (const dir of SQL_DIRS) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      salida.push({ nombre: `${dir.endsWith("supabase") ? "supabase" : "sql"}/${f}`, texto: readFileSync(resolve(dir, f), "utf8") });
    }
  }
  return salida;
}

/* Parte el texto en sentencias por «;» respetando '…', "…", comentarios y $tag$…$tag$. */
export function sentencias(texto: string): string[] {
  const salida: string[] = [];
  let actual = "";
  let i = 0;
  const n = texto.length;
  while (i < n) {
    const c = texto[i];
    const dos = texto.slice(i, i + 2);
    if (dos === "--") { while (i < n && texto[i] !== "\n") i++; continue; }
    if (dos === "/*") { const f = texto.indexOf("*/", i + 2); i = f < 0 ? n : f + 2; continue; }
    if (c === "'") {
      let j = i + 1;
      while (j < n) { if (texto[j] === "'" && texto[j + 1] === "'") j += 2; else if (texto[j] === "'") break; else j++; }
      actual += texto.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '"') {
      const f = texto.indexOf('"', i + 1);
      actual += texto.slice(i, f + 1); i = f + 1; continue;
    }
    if (c === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(texto.slice(i));
      if (m) {
        const f = texto.indexOf(m[0], i + m[0].length);
        const fin = f < 0 ? n : f + m[0].length;
        actual += texto.slice(i, fin); i = fin; continue;
      }
    }
    if (c === ";") { if (actual.trim()) salida.push(actual.trim()); actual = ""; i++; continue; }
    actual += c; i++;
  }
  if (actual.trim()) salida.push(actual.trim());
  return salida;
}

/* Parte por comas del nivel de arriba. */
function porComas(texto: string): string[] {
  const salida: string[] = [];
  let prof = 0, actual = "", enComilla: string | null = null;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComilla) { actual += c; if (c === enComilla) enComilla = null; continue; }
    if (c === "'" || c === '"') { enComilla = c; actual += c; continue; }
    if (c === "(") prof++;
    if (c === ")") prof--;
    if (c === "," && prof === 0) { salida.push(actual.trim()); actual = ""; continue; }
    actual += c;
  }
  if (actual.trim()) salida.push(actual.trim());
  return salida;
}

const sinPublic = (t: string) => t.replace(/^public\./i, "").replace(/"/g, "");
const NOMBRE = String.raw`(?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?`;

function columnaDe(def: string, archivo: string): ColumnaSql | null {
  const m = /^("?)([A-Za-z_][A-Za-z0-9_]*)\1\s+(.*)$/is.exec(def.trim());
  if (!m) return null;
  const nombre = m[2];
  if (/^(primary|constraint|unique|check|foreign|exclude)$/i.test(nombre)) return null;
  const resto = m[3];
  const tipoBase = /^([A-Za-z_]+(?:\s+with(?:out)?\s+time\s+zone)?)(\s*\[\])?/i.exec(resto);
  const tipo = tipoBase ? `${tipoBase[1].toLowerCase()}${tipoBase[2] ? "[]" : ""}` : "";
  const ref = /references\s+(?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\([^)]*\)(?:\s+on\s+delete\s+(cascade|set\s+null|restrict|no\s+action))?/i.exec(resto);
  const check = /check\s*\((.*)\)/is.exec(resto)?.[1] ?? null;
  const porDef = /\bdefault\s+(.+?)(?=\s+(?:not\s+null|null|check|references|primary|unique)\b|$)/is.exec(resto)?.[1].trim() ?? null;
  return {
    nombre, tipo,
    noNulo: /\bnot\s+null\b/i.test(resto) || /\bprimary\s+key\b/i.test(resto),
    porDefecto: porDef,
    clave: /\bprimary\s+key\b/i.test(resto),
    check,
    referencia: ref ? { tabla: ref[1], alBorrar: ((ref[2] ?? "restrict").toLowerCase().replace(/\s+/g, " ").replace("no action", "restrict")) as "cascade" | "set null" | "restrict" } : null,
    archivos: [archivo],
  };
}

export interface EsquemaSql { tablas: Map<string, TablaSql>; fks: FkSql[] }

export function leerEsquema(): EsquemaSql {
  const tablas = new Map<string, TablaSql>();
  const fks: FkSql[] = [];
  const tabla = (n: string): TablaSql => {
    let t = tablas.get(n);
    if (!t) { t = { nombre: n, columnas: new Map(), archivos: new Set(), creada: false }; tablas.set(n, t); }
    return t;
  };
  for (const { nombre: archivo, texto } of archivosSql()) {
    for (const s of sentencias(texto)) {
      const crea = new RegExp(String.raw`^create\s+table\s+(?:if\s+not\s+exists\s+)?${NOMBRE}\s*\(([\s\S]*)\)\s*$`, "i").exec(s);
      if (crea) {
        const t = tabla(crea[1]);
        t.creada = true; t.archivos.add(archivo);
        for (const def of porComas(crea[2])) {
          const c = columnaDe(def, archivo);
          if (c) {
            t.columnas.set(c.nombre, c);
            if (c.referencia) fks.push({ hijo: t.nombre, columna: c.nombre, padre: c.referencia.tabla, alBorrar: c.referencia.alBorrar, archivo });
          }
        }
        continue;
      }
      const altera = new RegExp(String.raw`^alter\s+table\s+(?:if\s+exists\s+)?${NOMBRE}\s+([\s\S]*)$`, "i").exec(s);
      if (altera) {
        const t = tabla(altera[1]);
        for (const cl of porComas(altera[2])) {
          const add = /^add\s+column\s+(?:if\s+not\s+exists\s+)?([\s\S]*)$/i.exec(cl);
          if (!add) continue;
          const c = columnaDe(add[1], archivo);
          if (c) {
            t.archivos.add(archivo);
            const previa = t.columnas.get(c.nombre);
            if (previa) previa.archivos.push(archivo); else t.columnas.set(c.nombre, c);
            if (c.referencia) fks.push({ hijo: t.nombre, columna: c.nombre, padre: c.referencia.tabla, alBorrar: c.referencia.alBorrar, archivo });
          }
        }
      }
    }
    /* Las claves foráneas que se agregan aparte, dentro de un bloque do $$ … $$. */
    const re = new RegExp(String.raw`alter\s+table\s+${NOMBRE}\s+add\s+constraint\s+\w+\s+foreign\s+key\s*\(\s*"?(\w+)"?\s*\)\s*references\s+(?:public\.)?"?(\w+)"?\s*\(\s*\w+\s*\)(?:\s+on\s+delete\s+(cascade|set\s+null|restrict))?`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto))) {
      fks.push({ hijo: m[1], columna: m[2], padre: m[3], alBorrar: ((m[4] ?? "restrict").toLowerCase().replace(/\s+/g, " ")) as FkSql["alBorrar"], archivo });
    }
  }
  /* Columnas de una sola tabla que alguien quita (drop column) no se usan acá. */
  return { tablas, fks };
}

/* ---------- Validar una fila contra lo que dice el SQL ---------- */

export interface ErrorSql { code: string; message: string }

const esNumero = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/** Lo que Postgres rechazaría de esta fila. null si pasa. `nueva`: se inserta (faltan las columnas con default). */
export function violacion(t: TablaSql, fila: Record<string, unknown>, nueva: boolean): ErrorSql | null {
  /* Una tabla de antes de este repo (sólo se conocen las columnas que un ALTER agregó): se miran el tipo y el CHECK
     de lo que viene, pero no se puede saber qué obligatorias faltan. */
  const parcial = !t.creada;
  for (const [col, c] of t.columnas) {
    const v = fila[col];
    const hay = col in fila && v !== undefined;
    if (parcial && !hay) continue;
    if (nueva && !hay && c.noNulo && c.porDefecto === null && !c.clave) {
      return { code: "23502", message: `null value in column "${col}" of relation "${t.nombre}" violates not-null constraint` };
    }
    if (nueva && !hay && c.clave) return { code: "23502", message: `null value in column "${col}" of relation "${t.nombre}" violates not-null constraint` };
    if (!hay) continue;
    if (v === null) {
      if (c.noNulo) return { code: "23502", message: `null value in column "${col}" of relation "${t.nombre}" violates not-null constraint` };
      continue;
    }
    const tipo = c.tipo;
    /* Lo que Postgres acepta de un valor JSON en cada tipo de columna (json_populate_record, que es lo que usa PostgREST):
       un número o un booleano en una columna de texto entran como texto; «5» entra en un entero; un decimal en un entero NO. */
    const mal = (() => {
      if (tipo.endsWith("[]")) return !Array.isArray(v);
      if (/^(text|varchar|character)/.test(tipo)) return false;
      if (/^(integer|int|bigint|smallint)/.test(tipo)) {
        if (typeof v === "number") return !Number.isInteger(v) || Math.abs(v) > (/^bigint/.test(tipo) ? Number.MAX_SAFE_INTEGER : 2147483647);
        if (typeof v === "string") return !/^\s*-?\d+\s*$/.test(v);
        return true;
      }
      if (/^(numeric|decimal|real|double)/.test(tipo)) return typeof v === "number" ? !Number.isFinite(v) : typeof v === "string" ? !/^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(v) : true;
      if (tipo === "boolean") return typeof v === "boolean" ? false : typeof v === "number" ? v !== 0 && v !== 1 : typeof v === "string" ? !/^\s*(t|true|f|false|y|yes|n|no|on|off|1|0)\s*$/i.test(v) : true;
      if (/^(timestamptz|timestamp|date)/.test(tipo)) return typeof v !== "string" || Number.isNaN(Date.parse(v as string));
      if (tipo === "jsonb" || tipo === "json") return false;
      return false;
    })();
    if (mal) return { code: "22P02", message: `invalid input syntax for type ${tipo} in column "${col}": ${JSON.stringify(v)}` };
    if (c.check) {
      const lista = /"?\w+"?\s+in\s*\(([^)]*)\)/i.exec(c.check);
      if (lista) {
        const ok = [...lista[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
        if (!ok.includes(String(v))) return { code: "23514", message: `new row for relation "${t.nombre}" violates check constraint on "${col}": ${JSON.stringify(v)}` };
      }
      const rango = /between\s+(-?[\d.]+)\s+and\s+(-?[\d.]+)/i.exec(c.check);
      if (rango && esNumero(v) && ((v as number) < Number(rango[1]) || (v as number) > Number(rango[2]))) {
        return { code: "23514", message: `new row for relation "${t.nombre}" violates check constraint on "${col}": ${v}` };
      }
    }
  }
  return null;
}

/** El valor por defecto de una columna, si es uno que sabemos escribir. */
export function valorPorDefecto(c: ColumnaSql): unknown {
  const d = c.porDefecto;
  if (d === null) return undefined;
  if (/^now\(\)/i.test(d)) return new Date().toISOString();
  if (/^true$/i.test(d)) return true;
  if (/^false$/i.test(d)) return false;
  if (/^-?\d+(\.\d+)?$/.test(d)) return Number(d);
  const j = /^'(.*)'::jsonb$/is.exec(d);
  if (j) { try { return JSON.parse(j[1]); } catch { return undefined; } }
  const s = /^'(.*)'(?:::\w+)?$/s.exec(d);
  if (s) return s[1];
  return undefined;
}
