/* ==================================================================
   Una base de mentira, en memoria, con la parte de la API de Supabase que
   usa la entrada de Calendly (lib/calendly-sync.ts): select, eq, ilike, in,
   order, limit, upsert (sin pisar las columnas que no se mandan, como
   `defaultToNull: false`) y update. Sólo para las pruebas: no toca ninguna
   base de verdad ni usa la red.
   ================================================================== */

type Fila = Record<string, unknown>;
type Resultado = { data: Fila[] | null; error: { message: string } | null };

class Consulta implements PromiseLike<Resultado> {
  private filtros: ((f: Fila) => boolean)[] = [];
  private operacion: "select" | "upsert" | "update" = "select";
  private carga: Fila | Fila[] | undefined;
  private limite = Infinity;

  constructor(private base: BaseFalsa, private tabla: string) {}

  select(_columnas?: string) { return this; }
  eq(columna: string, valor: unknown) { this.filtros.push((f) => f[columna] === valor); return this; }
  /* Sin comodines: el código de la app los escapa, así que acá es una igualdad sin mayúsculas. */
  ilike(columna: string, patron: string) {
    const v = patron.replace(/\\([\\%_])/g, "$1").toLowerCase();
    this.filtros.push((f) => String(f[columna] ?? "").toLowerCase() === v);
    return this;
  }
  in(columna: string, valores: unknown[]) { this.filtros.push((f) => valores.includes(f[columna])); return this; }
  order() { return this; }
  limit(n: number) { this.limite = n; return this; }
  upsert(carga: Fila | Fila[], _opciones?: unknown) { this.operacion = "upsert"; this.carga = carga; return this; }
  update(carga: Fila) { this.operacion = "update"; this.carga = carga; return this; }

  private ejecutar(): Resultado {
    const filas = (this.base.tablas[this.tabla] ??= []);
    if (this.operacion === "upsert") {
      for (const nueva of Array.isArray(this.carga) ? this.carga : [this.carga as Fila]) {
        const ya = filas.find((f) => f.id === nueva.id);
        if (ya) Object.assign(ya, structuredClone(nueva));
        else filas.push(structuredClone(nueva));
      }
      return { data: null, error: null };
    }
    const quedan = filas.filter((f) => this.filtros.every((p) => p(f)));
    if (this.operacion === "update") {
      for (const f of quedan) Object.assign(f, structuredClone(this.carga as Fila));
      return { data: null, error: null };
    }
    return { data: structuredClone(quedan.slice(0, this.limite)), error: null };
  }

  then<A = Resultado, B = never>(
    ok?: ((v: Resultado) => A | PromiseLike<A>) | null, mal?: ((r: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.ejecutar()).then(ok, mal);
  }
}

export class BaseFalsa {
  tablas: Record<string, Fila[]> = {};
  from(tabla: string) { return new Consulta(this, tabla); }
  fila(tabla: string, id: string): Fila | undefined { return (this.tablas[tabla] ?? []).find((f) => f.id === id); }
}
