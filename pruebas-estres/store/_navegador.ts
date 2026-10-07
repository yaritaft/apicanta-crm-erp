/* Un «navegador» mínimo para las pruebas (no es una prueba): window.localStorage en memoria.
   Hay que instalarlo ANTES de importar el store (lee window al guardar y al abrir). */
export class AlmacenFalso {
  datos = new Map<string, string>();
  /** Con un número, a partir de ese tamaño total setItem falla (cuota llena). */
  tope: number | null = null;
  /** Con true, todo falla (modo privado). */
  roto = false;
  escrituras = 0;
  getItem(k: string) { if (this.roto) throw new Error("denegado"); return this.datos.get(k) ?? null; }
  setItem(k: string, v: string) {
    if (this.roto) throw new Error("denegado");
    if (this.tope !== null && v.length > this.tope) throw new Error("QuotaExceededError");
    this.escrituras++;
    this.datos.set(k, String(v));
  }
  removeItem(k: string) { if (this.roto) throw new Error("denegado"); this.datos.delete(k); }
  clear() { this.datos.clear(); }
  get length() { return this.datos.size; }
  key(i: number) { return [...this.datos.keys()][i] ?? null; }
}

export function instalarNavegador(): AlmacenFalso {
  const almacen = new AlmacenFalso();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: almacen, setTimeout, clearTimeout,
    addEventListener() {}, removeEventListener() {},
  };
  return almacen;
}
