/* ==================================================================
   El software corre en la hora de la empresa: Argentina, UTC-3 todo el año.

   Antes, el «hoy», el «este mes», los cortes de mes de Finanzas y cada hora que se
   muestra salían del huso horario de la computadora de quien miraba (o del servidor,
   que es UTC): desde otro país, o a las 22 de Argentina (ya es mañana en UTC), el
   cierre de un mes se corría unas horas. Acá se fija el huso una sola vez, como si la
   computadora (y el servidor) estuvieran en Buenos Aires: todo lo que el código lee o
   arma «en hora local» (getMonth, getHours, new Date(2026, 9, 31), setDate,
   toLocaleDateString, Intl.DateTimeFormat sin zona…) pasa a ser hora argentina,
   mire quien mire y desde donde mire.

   Argentina no tiene horario de verano desde 2009: la diferencia con UTC es siempre
   de 3 horas, así que alcanza con correr los instantes tres horas.

   Se instala una sola vez, lo más temprano posible:
   - en el navegador, desde src/instrumentation-client.ts (antes que la app);
   - en el servidor, desde src/instrumentation.ts;
   - en las pruebas, desde pruebas/registrar.mjs (así corren igual en cualquier huso).
   Lo que ya usaba un huso explícito (diaDeNegocio, los formatos con timeZone) no cambia.
   ================================================================== */

export const TZ_ARGENTINA = "America/Argentina/Buenos_Aires";
/* Lo que Argentina está detrás de UTC, en milisegundos. */
const DESFASE = 3 * 3600000;
const MARCA = Symbol.for("apicanta.hora-argentina");

/* Una fecha y hora «sin zona» («2026-10-31T23:30:00») es hora local para JavaScript: acá, hora argentina. */
const SIN_ZONA = /^[+-]?\d{4,6}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

const CAMPOS_LEER = {
  getFullYear: "getUTCFullYear", getMonth: "getUTCMonth", getDate: "getUTCDate", getDay: "getUTCDay",
  getHours: "getUTCHours", getMinutes: "getUTCMinutes", getSeconds: "getUTCSeconds", getMilliseconds: "getUTCMilliseconds",
} as const;
const CAMPOS_ESCRIBIR = {
  setFullYear: "setUTCFullYear", setMonth: "setUTCMonth", setDate: "setUTCDate", setHours: "setUTCHours",
  setMinutes: "setUTCMinutes", setSeconds: "setUTCSeconds", setMilliseconds: "setUTCMilliseconds",
} as const;

export function instalarHoraArgentina(): void {
  const g = globalThis as unknown as Record<symbol, unknown> & { Date: DateConstructor; Intl: typeof Intl };
  if (g[MARCA]) return;
  g[MARCA] = true;

  const Nativa = g.Date;
  const P = Nativa.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;

  /* Una fecha cuyos campos «UTC» son los de la hora argentina del instante dado. */
  const corrida = (instante: number) => new Nativa(instante - DESFASE);

  for (const [local, utc] of Object.entries(CAMPOS_LEER)) {
    const leerUtc = P[utc];
    Object.defineProperty(Nativa.prototype, local, {
      configurable: true, writable: true,
      value: function (this: Date) { const t = this.getTime(); return Number.isNaN(t) ? NaN : leerUtc.call(corrida(t)); },
    });
  }
  for (const [local, utc] of Object.entries(CAMPOS_ESCRIBIR)) {
    const escribirUtc = P[utc];
    Object.defineProperty(Nativa.prototype, local, {
      configurable: true, writable: true,
      value: function (this: Date, ...args: unknown[]) {
        const t = this.getTime();
        /* Como dice el estándar: sobre una fecha inválida sólo setFullYear arranca de cero; el resto sigue inválida. */
        if (Number.isNaN(t) && local !== "setFullYear") return NaN;
        const c = new Nativa(Number.isNaN(t) ? 0 : t - DESFASE);
        escribirUtc.call(c, ...args);
        const nuevo = c.getTime();
        return this.setTime(Number.isNaN(nuevo) ? NaN : nuevo + DESFASE);
      },
    });
  }
  Object.defineProperty(Nativa.prototype, "getTimezoneOffset", {
    configurable: true, writable: true,
    value: function (this: Date) { return Number.isNaN(this.getTime()) ? NaN : DESFASE / 60000; },
  });

  /* Lo que se escribe en texto, en hora argentina salvo que pidan otra zona. */
  for (const metodo of ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"] as const) {
    const original = P[metodo];
    Object.defineProperty(Nativa.prototype, metodo, {
      configurable: true, writable: true,
      value: function (this: Date, locales?: unknown, opciones?: Intl.DateTimeFormatOptions) {
        return original.call(this, locales, opciones?.timeZone ? opciones : { ...opciones, timeZone: TZ_ARGENTINA });
      },
    });
  }
  const FormatoNativo = g.Intl.DateTimeFormat;
  const Formato = function (locales?: Intl.LocalesArgument, opciones?: Intl.DateTimeFormatOptions) {
    return new FormatoNativo(locales, opciones?.timeZone ? opciones : { ...opciones, timeZone: TZ_ARGENTINA });
  } as unknown as typeof Intl.DateTimeFormat;
  (Formato as unknown as { prototype: unknown }).prototype = FormatoNativo.prototype;
  Formato.supportedLocalesOf = FormatoNativo.supportedLocalesOf.bind(FormatoNativo);
  Object.defineProperty(g.Intl, "DateTimeFormat", { configurable: true, writable: true, value: Formato });

  /* Un texto sin zona es hora argentina; con zona («…Z», «…-03:00») o sólo con el día, se lee como siempre. */
  const leerTexto = (texto: string): number => (SIN_ZONA.test(texto) ? Nativa.parse(`${texto}Z`) + DESFASE : Nativa.parse(texto));

  /* El constructor: new Date(2026, 9, 31, 23, 30) es hora argentina. Va como función (no como clase) para que Date() sin new siga andando. */
  const Nueva = function (this: unknown, ...args: unknown[]) {
    if (!new.target) return Nativa();
    let valor: number;
    if (args.length === 0) valor = Nueva.now();                  // Date.now() de ahora: así un reloj de prueba que lo cambie también mueve `new Date()`
    else if (args.length === 1) {
      const v = args[0];
      valor = typeof v === "string" ? leerTexto(v) : Nativa.prototype.valueOf.call(v instanceof Nativa ? v : new Nativa(v as number));
    } else {
      const [a, m, d = 1, h = 0, mi = 0, s = 0, ms = 0] = args.map(Number);
      valor = Nativa.UTC(a, m, d, h, mi, s, ms) + DESFASE;
    }
    return Reflect.construct(Nativa, [valor], new.target);
  } as unknown as DateConstructor;
  /* La misma `prototype`: las fechas que armen otras librerías (con el Date de antes) también son de acá, y `instanceof Date` sigue valiendo. */
  (Nueva as unknown as { prototype: unknown }).prototype = Nativa.prototype;
  Object.defineProperty(Nativa.prototype, "constructor", { configurable: true, writable: true, value: Nueva });
  Object.setPrototypeOf(Nueva, Nativa);
  Object.defineProperty(Nueva, "name", { value: "Date" });
  Object.defineProperty(Nueva, "length", { value: 7 });
  Nueva.now = Nativa.now;
  Nueva.UTC = Nativa.UTC;
  Nueva.parse = leerTexto;
  g.Date = Nueva;
}
