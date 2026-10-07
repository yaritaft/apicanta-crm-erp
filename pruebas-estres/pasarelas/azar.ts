/* Ayudas de las pruebas de estrés (pruebas/stress/*): un generador con
   semilla, generadores de basura y un corredor de propiedades que imprime la
   semilla cuando algo falla, así el caso se puede repetir.

   Este archivo NO es una prueba (no termina en .test.ts): lo importan las
   pruebas del frente «la entrada de datos de afuera». */

/** mulberry32: rápido, determinista, de 32 bits. */
export function mulberry32(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Azar {
  readonly semilla: number;
  private r: () => number;
  constructor(semilla: number) { this.semilla = semilla; this.r = mulberry32(semilla); }
  /** Un real en [0, 1). */
  next(): number { return this.r(); }
  /** Un entero en [a, b], los dos incluidos. */
  int(a: number, b: number): number { return a + Math.floor(this.r() * (b - a + 1)); }
  bool(p = 0.5): boolean { return this.r() < p; }
  pick<T>(xs: readonly T[]): T { return xs[this.int(0, xs.length - 1)]; }
  /** Una copia mezclada (Fisher-Yates). */
  mezclar<T>(xs: readonly T[]): T[] {
    const c = [...xs];
    for (let i = c.length - 1; i > 0; i--) { const j = this.int(0, i); [c[i], c[j]] = [c[j], c[i]]; }
    return c;
  }
  /** N dígitos; `primero` fuerza el comienzo. */
  digitos(n: number, primero = ""): string {
    let s = primero;
    while (s.length < n) s += String(this.int(0, 9));
    return s;
  }
  /** Letras y números, de largo n. */
  alfanum(n: number): string {
    const al = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let s = "";
    for (let i = 0; i < n; i++) s += al[this.int(0, al.length - 1)];
    return s;
  }
}

/** Corre `f` con N semillas distintas y, si falla una, dice cuál. */
export function propiedad(nombre: string, iteraciones: number, f: (az: Azar, i: number) => void | Promise<void>, baseFija = 20261007) {
  /* ESTRES_SEMILLA=123 npm test … corre las mismas propiedades con otras semillas (para explorar más; por defecto es siempre la misma). */
  const base = Number(process.env.ESTRES_SEMILLA) || baseFija;
  return async () => {
    for (let i = 0; i < iteraciones; i++) {
      const semilla = base + i * 7919;
      try {
        await f(new Azar(semilla), i);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        throw new Error(`Propiedad «${nombre}» rota con semilla ${semilla} (iteración ${i}): ${m}`, { cause: e });
      }
    }
  };
}

/* ---------- Basura ---------- */

export const NUMEROS_RAROS: number[] = [
  0, -0, 1, -1, 0.1, 0.005, 0.004999, 1e-9, 1e9, 1e15, 1e21, 1e100, 1e300, 1.7976931348623157e308, -1e300,
  Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, NaN, Infinity, -Infinity, 4102444800, 253402300800, 1e13, 1e17,
];

export const STRINGS_RAROS: string[] = [
  "", " ", "   ", "0", "-1", "1e5", "NaN", "Infinity", "-Infinity", "null", "undefined", "true", "[]", "{}", "abc",
  "1.234,56", "1,234.56", "$1,000", "US$ 1.234,56", "٣٤٥", "１２３", "\u0000", "\n", "\r\n", "\t", '"', "'", "\\", "%", "_",
  "𝒳", "ñandú", "áéíóúüñ", "😀", "<script>alert(1)</script>", "../../etc/passwd", "'; DROP TABLE movimientos; --",
  "9999999999999999999999", "2026-13-45", "0000-00-00", "31/02/2026", "+275760-09-13T00:00:00.000Z", "-271821-04-20T00:00:00.000Z",
  "__proto__", "constructor", "toString",
];

/** Un valor JSON cualquiera, con tipos cambiados a propósito. */
export function basura(az: Azar, prof = 0): unknown {
  const t = az.int(0, prof >= 3 ? 7 : 11);
  switch (t) {
    case 0: return null;
    case 1: return az.pick(NUMEROS_RAROS.filter((n) => Number.isFinite(n)));
    case 2: return az.pick(STRINGS_RAROS);
    case 3: return az.bool();
    case 4: return az.alfanum(az.int(0, 24));
    case 5: return az.int(-1000, 1_000_000);
    case 6: return String(az.int(-1000, 1_000_000));
    case 7: return undefined;
    case 8: return Array.from({ length: az.int(0, 4) }, () => basura(az, prof + 1));
    default: {
      const o: Record<string, unknown> = {};
      const claves = ["id", "amount", "created", "currency", "status", "type", "data", "object", "email", "name", "price", "value",
        "transaction", "purchase", "buyer", "user", "final_amount", "paid_at", "payment", "refunded_amount", "event", "action"];
      for (let i = az.int(0, 5); i > 0; i--) o[az.pick(claves)] = basura(az, prof + 1);
      return o;
    }
  }
}

/** Un string de cualquier largo y contenido, incluso gigante. */
export function textoLoco(az: Azar, max = 200): string {
  const partes: string[] = [];
  for (let i = az.int(0, 8); i > 0; i--) {
    const k = az.int(0, 4);
    partes.push(k === 0 ? az.pick(STRINGS_RAROS) : k === 1 ? az.alfanum(az.int(0, max)) : k === 2 ? ",;\t\n\r\"".repeat(az.int(0, 3)) : k === 3 ? az.digitos(az.int(0, 30)) : " ".repeat(az.int(0, 5)));
  }
  return partes.join(az.pick(["", ",", ";", "\n", " "]));
}

/** Una fecha ISO válida entre 2025 y 2027. */
export function fechaIso(az: Azar): string {
  return new Date(Date.UTC(2025, 0, 1) + az.int(0, 3 * 365 * 24 * 60) * 60000).toISOString();
}

/* ---------- Capturar lo que se escribe en consola ---------- */

/** Junta todo lo que `f` escriba con console.* y lo devuelve junto con su resultado. */
export async function capturandoConsola<T>(f: () => Promise<T>): Promise<{ valor: T; texto: string }> {
  const viejos = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  const partes: string[] = [];
  const grabar = (...a: unknown[]) => { partes.push(a.map((x) => (typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })())).join(" ")); };
  console.log = grabar; console.error = grabar; console.warn = grabar; console.info = grabar; console.debug = grabar;
  try {
    const valor = await f();
    return { valor, texto: partes.join("\n") };
  } finally {
    Object.assign(console, viejos);
  }
}

/** Pone variables de entorno mientras corre `f` y las devuelve a como estaban. */
export async function conEntorno<T>(env: Record<string, string | undefined>, f: () => Promise<T>): Promise<T> {
  const antes: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { antes[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { return await f(); }
  finally { for (const k of Object.keys(env)) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; } }
}
