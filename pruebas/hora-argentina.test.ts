import test from "node:test";
import assert from "node:assert/strict";
import { TZ_ARGENTINA, instalarHoraArgentina } from "@/lib/hora-argentina";

/* El software corre en la hora de Argentina (UTC-3, sin horario de verano), sea cual sea el huso de la computadora.
   Estas pruebas dan lo mismo con TZ=UTC, Asia/Tokyo, America/Los_Angeles… (probar con npm run test:horas). */

const DESFASE = 3 * 3600000;
/* La referencia: lo que dice el calendario de Buenos Aires según el formateador nativo, con la zona explícita. */
const referencia = new Intl.DateTimeFormat("en-CA", { timeZone: TZ_ARGENTINA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short" });
const DIAS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function enBuenosAires(t: number) {
  const p = Object.fromEntries(referencia.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { anio: +p.year, mes: +p.month - 1, dia: +p.day, hora: +p.hour, min: +p.minute, seg: +p.second, semana: DIAS.indexOf(p.weekday) };
}
const azar = (() => { let a = 20261017; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();

test("instalar dos veces no corre las horas dos veces", () => {
  instalarHoraArgentina(); instalarHoraArgentina();
  assert.equal(new Date(Date.UTC(2026, 10, 1, 2, 30)).getHours(), 23);
});

test("leer: año, mes, día, día de la semana, hora, minuto y segundo son los de Buenos Aires para 20.000 instantes al azar (incluidos los bordes de mes y de año)", () => {
  const bordes = [Date.UTC(2026, 9, 31, 2, 59, 59, 999), Date.UTC(2026, 9, 31, 3, 0, 0, 0), Date.UTC(2026, 11, 31, 2, 59, 59, 999), Date.UTC(2027, 0, 1, 3, 0), Date.UTC(2028, 1, 29, 12), Date.UTC(2026, 10, 1, 2, 30)];
  for (let i = 0; i < 20000 + bordes.length; i++) {
    const t = i < bordes.length ? bordes[i] : Date.UTC(2019, 0, 1) + Math.floor(azar() * 11 * 365 * 86400000);
    const d = new Date(t), r = enBuenosAires(t);
    const cual = `${new Date(t).toISOString()}`;
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getDay()], [r.anio, r.mes, r.dia, r.hora, r.min, r.seg, r.semana], cual);
    assert.equal(d.getMilliseconds(), ((t % 1000) + 1000) % 1000, cual);
    assert.equal(d.getTimezoneOffset(), 180, cual);
  }
  assert.ok(Number.isNaN(new Date(NaN).getHours()) && Number.isNaN(new Date("basura").getDate()) && Number.isNaN(new Date(NaN).getTimezoneOffset()));
});

test("armar: new Date(año, mes, día, hora…) es hora argentina, normaliza lo que se pasa de rango y vuelve a leerse igual", () => {
  for (let i = 0; i < 5000; i++) {
    const a = 2020 + Math.floor(azar() * 10), m = Math.floor(azar() * 12), dd = 1 + Math.floor(azar() * 28), h = Math.floor(azar() * 24), mi = Math.floor(azar() * 60), s = Math.floor(azar() * 60), ms = Math.floor(azar() * 1000);
    const d = new Date(a, m, dd, h, mi, s, ms);
    assert.equal(d.getTime(), Date.UTC(a, m, dd, h, mi, s, ms) + DESFASE);
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()], [a, m, dd, h, mi, s, ms]);
  }
  /* El mes 12 es enero del año que sigue; el día 0, el último del mes anterior; la hora 25, la 1 del día siguiente. */
  assert.equal(new Date(2026, 12, 1).getFullYear(), 2027);
  assert.equal(new Date(2026, 10, 0).getDate(), 31);
  assert.deepEqual([new Date(2026, 9, 31, 25).getDate(), new Date(2026, 9, 31, 25).getHours()], [1, 1]);
  /* Dos argumentos (año y mes), el año de dos cifras como 19xx, y lo que no es número. */
  assert.deepEqual([new Date(2026, 9).getDate(), new Date(2026, 9).getHours()], [1, 0]);
  assert.equal(new Date(99, 0, 1).getFullYear(), 1999);
  assert.ok(Number.isNaN(new Date(2026, NaN).getTime()) && Number.isNaN(new Date(2026, 9, undefined as unknown as number).getTime()));
  /* Fin de mes a las 23:59:59,999: último instante de octubre; el siguiente ya es noviembre. */
  const finDeOctubre = new Date(2026, 9, 31, 23, 59, 59, 999);
  assert.equal(finDeOctubre.toISOString(), "2026-11-01T02:59:59.999Z");
  assert.equal(new Date(finDeOctubre.getTime() + 1).getMonth(), 10);
});

test("leer texto: una fecha y hora sin zona es hora argentina; con zona, o sólo con el día, se lee como siempre", () => {
  assert.equal(new Date("2026-10-31T23:30:00").toISOString(), "2026-11-01T02:30:00.000Z");
  assert.equal(new Date("2026-10-31T23:30").toISOString(), "2026-11-01T02:30:00.000Z");
  assert.equal(new Date("2026-10-31T23:30:00.123").toISOString(), "2026-11-01T02:30:00.123Z");
  assert.equal(Date.parse("2026-10-31T12:00:00"), Date.UTC(2026, 9, 31, 15));
  assert.equal(new Date("2026-10-31T23:30:00Z").toISOString(), "2026-10-31T23:30:00.000Z");
  assert.equal(new Date("2026-10-31T23:30:00-03:00").toISOString(), "2026-11-01T02:30:00.000Z");
  assert.equal(new Date("2026-10-31T23:30:00+05:30").toISOString(), "2026-10-31T18:00:00.000Z");
  assert.equal(new Date("2026-10-31").toISOString(), "2026-10-31T00:00:00.000Z", "sólo el día: medianoche UTC, como dice el estándar");
  assert.equal(new Date(`${"2026-10-05"}T12:00:00`).getDate(), 5, "el mediodía de un día sigue siendo de ese día");
  /* Copiar una fecha, un número, y los usos de siempre. */
  const orig = new Date(Date.UTC(2026, 5, 1, 12));
  assert.equal(new Date(orig).getTime(), orig.getTime());
  assert.equal(new Date(5).getTime(), 5);
  assert.equal(new Date(null as unknown as number).getTime(), 0);
  assert.ok(Number.isNaN(new Date(undefined as unknown as number).getTime()));
  assert.equal(JSON.stringify(new Date(0)), '"1970-01-01T00:00:00.000Z"');
  assert.equal(Object.prototype.toString.call(new Date()), "[object Date]");
  assert.ok(new Date() instanceof Date && typeof Date() === "string" && Date.now() > 0);
  class Mia extends Date { quien() { return `${this.getDate()}/${this.getMonth() + 1}`; } }
  assert.equal(new Mia(2026, 9, 31).quien(), "31/10");
});

test("escribir: setMonth, setDate, setHours… operan sobre el calendario de Buenos Aires, con sus desbordes", () => {
  for (let i = 0; i < 3000; i++) {
    const t = Date.UTC(2022, 0, 1) + Math.floor(azar() * 6 * 365 * 86400000);
    const base = enBuenosAires(t);
    const n = Math.floor(azar() * 40) - 20;
    for (const [metodo, esperado] of [
      ["setDate", () => Date.UTC(base.anio, base.mes, n, base.hora, base.min, base.seg, t % 1000)],
      ["setMonth", () => Date.UTC(base.anio, n, base.dia, base.hora, base.min, base.seg, t % 1000)],
      ["setHours", () => Date.UTC(base.anio, base.mes, base.dia, n, base.min, base.seg, t % 1000)],
      ["setFullYear", () => Date.UTC(base.anio + n, base.mes, base.dia, base.hora, base.min, base.seg, t % 1000)],
    ] as const) {
      const d = new Date(t);
      const devuelto = (d as unknown as Record<string, (x: number) => number>)[metodo](metodo === "setFullYear" ? base.anio + n : n);
      assert.equal(d.getTime(), esperado() + DESFASE, `${metodo}(${n}) sobre ${new Date(t).toISOString()}`);
      assert.equal(devuelto, d.getTime(), `${metodo} devuelve el valor nuevo`);
    }
  }
  /* Sumar un mes al 31: el desborde clásico (31 de enero + 1 mes = 3 de marzo). */
  const d = new Date(2026, 0, 31); d.setMonth(d.getMonth() + 1);
  assert.deepEqual([d.getMonth(), d.getDate()], [2, 3]);
  /* Una fecha inválida sigue inválida, salvo setFullYear (que arranca de cero, como el estándar). */
  const malo = new Date(NaN);
  assert.ok(Number.isNaN(malo.setHours(5)) && Number.isNaN(malo.setDate(5)));
  assert.ok(!Number.isNaN(malo.setFullYear(2026)));
  /* setHours con varios argumentos, y un cambio de día sin tocar la hora. */
  const e = new Date(2026, 9, 31, 10, 20, 30, 400); e.setHours(23, 59, 59, 999);
  assert.equal(e.toISOString(), "2026-11-01T02:59:59.999Z");
  const f = new Date(2026, 9, 31, 10, 20); f.setDate(f.getDate() + 1);
  assert.deepEqual([f.getMonth(), f.getDate(), f.getHours(), f.getMinutes()], [10, 1, 10, 20]);
});

test("escribir en texto: toLocale…String e Intl.DateTimeFormat salen en hora argentina salvo que pidan otra zona", () => {
  const d = new Date(Date.UTC(2026, 10, 1, 2, 30));            // 1/11 02:30 UTC = 31/10 23:30 en Buenos Aires
  assert.equal(d.toLocaleDateString("es-AR"), "31/10/2026");
  assert.match(d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false }), /^23:30$/);
  assert.equal(d.toLocaleDateString("es-AR", { timeZone: "UTC" }), "1/11/2026", "una zona explícita se respeta");
  assert.equal(d.toLocaleDateString("es-AR", { timeZone: undefined }), "31/10/2026");
  assert.match(d.toLocaleString("es-AR", { day: "numeric", month: "long" }), /31 de octubre/);
  assert.equal(new Intl.DateTimeFormat("es-AR").format(d), "31/10/2026");
  assert.equal(Intl.DateTimeFormat("es-AR").format(d), "31/10/2026", "también sin new");
  assert.equal(new Intl.DateTimeFormat("es-AR", { timeZone: "UTC" }).format(d), "1/11/2026");
  assert.match(new Intl.DateTimeFormat().resolvedOptions().timeZone, /^America\/(Argentina\/)?Buenos_Aires$/);   // ICU a veces lo nombra por su alias
  assert.ok(new Intl.DateTimeFormat("es-AR") instanceof Intl.DateTimeFormat);
  assert.deepEqual(Intl.DateTimeFormat.supportedLocalesOf(["es-AR"]), ["es-AR"]);
});

test("una fecha armada con el Date de antes (otra librería) también es de acá", () => {
  const Nativa = Object.getPrototypeOf(Date) as DateConstructor;           // el constructor original queda como el padre de Date
  const deOtro = new Nativa(Date.UTC(2026, 10, 1, 2, 30));
  assert.ok(deOtro instanceof Date);
  assert.equal(deOtro.getDate(), 31);
  assert.equal(deOtro.getHours(), 23);
});
