import test from "node:test";
import assert from "node:assert/strict";
import {
  agruparPorCloser, anfitrionesPorMiembro, avisosDePase, closerDeLlamada, destinosDePase, planDePase, responsableTrasPase,
  todaviaNoPaso,
} from "@/lib/pasar-llamadas";
import { anfitrionTrasCalendly, pasadaDe } from "@/lib/pasada-closer";
import { esDelCloser } from "@/lib/eod";
import type { MiembroEquipo, Sesion } from "@/lib/types";

/* Un equipo como el de verdad: Calendly escribe «Dante Barbieri» o «Mariano
   Arias» donde Equipo dice «Dante Barbieri» o «Mariano». */
const miembro = (id: string, nombre: string, extra: Partial<MiembroEquipo> = {}): MiembroEquipo =>
  ({ id, nombre, rol: "closer", comisionRate: 0.1, activo: true, sinComision: false, ...extra });

const EQUIPO: MiembroEquipo[] = [
  miembro("yari", "Yari Taft", { rol: "ceo", email: "yari@apicanta.com" }),
  miembro("santi", "Santiago Burghiani", { rol: "director", email: "santi@apicanta.com" }),
  miembro("mariano", "Mariano", { email: "mariano@apicanta.com" }),
  miembro("dante", "Dante Barbieri", { email: "dante@apicanta.com" }),
  miembro("valentin", "Valentin Abadia"),
  miembro("ex", "Eduardo Viejo", { activo: false }),
];

const llamada = (id: string, anfitrion: string | undefined, extra: Partial<Sesion> = {}): Sesion => ({
  id, titulo: "Llamada de Asesoramiento", tipo: "Llamada de Asesoramiento - Webinar - Team", invitado: `Persona ${id}`,
  inicia: "2026-10-09T15:00:00.000Z", duracionMin: 45, estado: "agendada", origen: "calendly",
  creadoEn: "2026-10-01T12:00:00.000Z", extra: {}, anfitrion, ...extra,
});

const SESIONES: Sesion[] = [
  llamada("a1", "Mariano Arias"), llamada("a2", "Mariano Arias"), llamada("a3", "Mariano Arias"), llamada("a4", "Mariano"),
  llamada("b1", "Dante Barbieri"), llamada("b2", "Dante Barbieri"),
  llamada("c1", "Yari Taft"),
  llamada("d1", "V. Abadia"), llamada("d2", "V. Abadia"),
];

const AHORA = "2026-10-08T14:00:00.000Z";
const ctx = { equipo: EQUIPO, por: "Santiago Burghiani", cuando: AHORA };

test("a quién se le puede pasar: los closers activos y quien ya atiende llamadas, con su nombre de Calendly", () => {
  const destinos = destinosDePase({ equipo: EQUIPO, sesiones: SESIONES });
  assert.deepEqual(destinos.map((d) => d.miembro.nombre), ["Dante Barbieri", "Mariano", "Valentin Abadia", "Yari Taft"]);
  /* Santi no atiende llamadas y no es closer; el que ya no está, tampoco. */
  assert.ok(!destinos.some((d) => d.miembro.id === "santi" || d.miembro.id === "ex"));
  /* «Mariano Arias» (3 llamadas) gana sobre «Mariano» (1): queda como Calendly lo escribe. */
  assert.equal(destinos.find((d) => d.miembro.id === "mariano")!.anfitrion, "Mariano Arias");
  /* Sin ninguna llamada con su nombre, el de Equipo. */
  assert.equal(destinos.find((d) => d.miembro.id === "valentin")!.anfitrion, "Valentin Abadia");
  /* Sin correo en Equipo, no va a ver lo que se le pase. */
  assert.deepEqual(destinos.filter((d) => d.sinCorreo).map((d) => d.miembro.nombre), ["Valentin Abadia"]);
});

test("los anfitriones de cada uno: sólo los que la regla de dos palabras une con él", () => {
  const por = anfitrionesPorMiembro(SESIONES, EQUIPO);
  assert.deepEqual(por.get("mariano"), [{ nombre: "Mariano Arias", llamadas: 3 }, { nombre: "Mariano", llamadas: 1 }]);
  assert.deepEqual(por.get("dante"), [{ nombre: "Dante Barbieri", llamadas: 2 }]);
  /* «V. Abadia» no es de nadie: no coincide con «Valentin Abadia». */
  assert.equal(por.has("valentin"), false);
  assert.deepEqual([...por.keys()].sort(), ["dante", "mariano", "yari"]);
});

test("pasar una llamada: queda el closer nuevo y la marca de que se eligió a mano, sin perder lo que ya tenía", () => {
  const s = llamada("b1", "Dante Barbieri", { extra: { atribucion: { momento: "vivo" } } });
  const mariano = destinosDePase({ equipo: EQUIPO, sesiones: SESIONES }).find((d) => d.miembro.id === "mariano")!;
  const plan = planDePase(s, mariano, ctx)!;
  assert.equal(plan.cambios.anfitrion, "Mariano Arias");
  assert.deepEqual(plan.cambios.extra, {
    atribucion: { momento: "vivo" },
    pasada: { a: "Mariano Arias", calendly: "Dante Barbieri", por: "Santiago Burghiani", en: AHORA },
  });
  assert.equal(plan.de, "Dante Barbieri");
  assert.equal(plan.vuelveACalendly, false);
  assert.equal(plan.detalle, "Persona b1: pasó de Dante Barbieri a Mariano, por Santiago Burghiani.");
  /* Deshacer la deja exacta como estaba. */
  assert.equal(plan.antes.anfitrion, "Dante Barbieri");
  assert.deepEqual(plan.antes.extra, { atribucion: { momento: "vivo" } });
});

test("pasarla otra vez no pierde lo que dice Calendly; pasarla a quien figura en Calendly saca la marca", () => {
  const destinos = destinosDePase({ equipo: EQUIPO, sesiones: SESIONES });
  const a = (id: string) => destinos.find((d) => d.miembro.id === id)!;
  const primera = planDePase(llamada("b1", "Dante Barbieri"), a("mariano"), ctx)!;
  const pasada = llamada("b1", primera.cambios.anfitrion, { extra: primera.cambios.extra });
  assert.equal(pasadaDe(pasada)!.calendly, "Dante Barbieri");

  const segunda = planDePase(pasada, a("yari"), { ...ctx, por: "Yari Taft" })!;
  assert.equal(segunda.cambios.anfitrion, "Yari Taft");
  assert.deepEqual(pasadaDe({ extra: segunda.cambios.extra }), { a: "Yari Taft", calendly: "Dante Barbieri", por: "Yari Taft", en: AHORA });

  /* A Dante, que es el que dice Calendly: vuelve a ser la de siempre. */
  const vuelta = planDePase(pasada, a("dante"), ctx)!;
  assert.equal(vuelta.vuelveACalendly, true);
  assert.equal(vuelta.cambios.anfitrion, "Dante Barbieri");
  assert.equal(pasadaDe({ extra: vuelta.cambios.extra }), undefined);
  assert.deepEqual(vuelta.cambios.extra, {});
});

test("no hay nada que pasar si ya la atiende (aunque lo escriban distinto)", () => {
  const mariano = destinosDePase({ equipo: EQUIPO, sesiones: SESIONES }).find((d) => d.miembro.id === "mariano")!;
  assert.equal(planDePase(llamada("a4", "Mariano"), mariano, ctx), null);
  assert.equal(planDePase(llamada("a1", "Mariano Arias"), mariano, ctx), null);
});

test("una llamada de un anfitrión que no está en Equipo se le puede pasar a quien corresponde", () => {
  const valentin = destinosDePase({ equipo: EQUIPO, sesiones: SESIONES }).find((d) => d.miembro.id === "valentin")!;
  assert.equal(closerDeLlamada(llamada("d1", "V. Abadia"), EQUIPO).miembro, undefined);
  const plan = planDePase(llamada("d1", "V. Abadia"), valentin, ctx)!;
  assert.equal(plan.cambios.anfitrion, "Valentin Abadia");
  assert.equal(plan.detalle, "Persona d1: pasó de V. Abadia a Valentin Abadia, por Santiago Burghiani.");
  assert.equal(pasadaDe({ extra: plan.cambios.extra })!.calendly, "V. Abadia");

  /* Una llamada sin closer: se le asigna uno. */
  const sinCloser = planDePase(llamada("z1", undefined), valentin, ctx)!;
  assert.equal(sinCloser.detalle, "Persona z1: se la asignó a Valentin Abadia, por Santiago Burghiani (no tenía closer).");
  assert.equal(sinCloser.de, "");
});

test("la oportunidad se va con la llamada sólo si era de quien la atendía", () => {
  const mariano = destinosDePase({ equipo: EQUIPO, sesiones: SESIONES }).find((d) => d.miembro.id === "mariano")!;
  assert.equal(responsableTrasPase({ responsable: "Dante Barbieri" }, "Dante Barbieri", mariano, EQUIPO), "Mariano Arias");
  /* Escrito de otra forma, es el mismo. */
  assert.equal(responsableTrasPase({ responsable: "dante" }, "Dante Barbieri", mariano, EQUIPO), "Mariano Arias");
  /* De otro, no se toca; sin responsable, tampoco. */
  assert.equal(responsableTrasPase({ responsable: "Yari Taft" }, "Dante Barbieri", mariano, EQUIPO), null);
  assert.equal(responsableTrasPase({ responsable: "" }, "Dante Barbieri", mariano, EQUIPO), null);
  /* Si ya es de quien la recibe, no hay nada que cambiar. */
  assert.equal(responsableTrasPase({ responsable: "Mariano" }, "Dante Barbieri", mariano, EQUIPO), null);
});

test("lo que Calendly vuelve a mandar no pisa el closer elegido a mano", () => {
  /* Sin marca: manda Calendly, como siempre. */
  assert.deepEqual(anfitrionTrasCalendly("Dante Barbieri", { anfitrion: "Dante Barbieri", extra: {} }), { anfitrion: "Dante Barbieri" });
  assert.deepEqual(anfitrionTrasCalendly("Dante Barbieri", undefined), { anfitrion: "Dante Barbieri" });
  assert.deepEqual(anfitrionTrasCalendly(undefined, null), { anfitrion: undefined });

  /* Con marca (una cancelación o un no-show del mismo invitado): se queda el elegido, y la marca anota lo que dice Calendly. */
  const marca = { a: "Mariano Arias", calendly: "Dante Barbieri", por: "Santiago Burghiani", en: AHORA };
  const r = anfitrionTrasCalendly("Dante Barbieri", { anfitrion: "Mariano Arias", extra: { pasada: marca, otra: 1 } });
  assert.equal(r.anfitrion, "Mariano Arias");
  assert.deepEqual(r.pasada, marca);

  /* Si en Calendly cambiaron al anfitrión, queda anotado pero no manda. */
  const cambio = anfitrionTrasCalendly("Valentin Abadia", { anfitrion: "Mariano Arias", extra: { pasada: marca } });
  assert.equal(cambio.anfitrion, "Mariano Arias");
  assert.equal(cambio.pasada!.calendly, "Valentin Abadia");
  assert.equal(cambio.pasada!.a, "Mariano Arias");

  /* Una reprogramación es otra agenda: hereda del invitado que reemplaza (el anfitrión viene de la vieja). */
  const nueva = anfitrionTrasCalendly("Dante Barbieri", { anfitrion: "Mariano Arias", extra: { pasada: marca } });
  assert.equal(nueva.anfitrion, "Mariano Arias");

  /* Una marca rota o vacía no cuenta. */
  assert.deepEqual(anfitrionTrasCalendly("Dante Barbieri", { anfitrion: "Mariano Arias", extra: { pasada: { a: " " } } }), { anfitrion: "Dante Barbieri" });
  assert.deepEqual(anfitrionTrasCalendly("Dante Barbieri", { anfitrion: "Mariano Arias", extra: { pasada: "sí" } }), { anfitrion: "Dante Barbieri" });
});

/* ---------- Quién la ve: la regla de la base, igual a la de la app ---------- */

/* Lo mismo que hace supabase/tipos-cuenta.sql (nombre_corto, miembro_de_nombre y son_mios), escrito acá a
   propósito sin tocar lib/crm.ts: si la base y la app dejaran de coincidir, una prueba tiene que avisar. */
const corto = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().split(/\s+/).slice(0, 2).join(" ");
function duenoSegunLaBase(nombre: string, equipo: MiembroEquipo[]): string | undefined {
  const c = corto(nombre);
  if (!c) return undefined;
  const orden = [...equipo].sort((a, b) => Number(b.activo) - Number(a.activo) || a.id.localeCompare(b.id));
  return (orden.find((e) => corto(e.nombre) === c)
    ?? orden.find((e) => corto(e.nombre) !== "" && (c.startsWith(`${corto(e.nombre)} `) || corto(e.nombre).startsWith(`${c} `))))?.id;
}

test("la base y la app unen a cada anfitrión con la misma persona del equipo", () => {
  const nombres = ["Dante Barbieri", "dante barbieri", "Dante", "DANTE B.", "Mariano Arias", "Mariano", "Valentín Abadía", "Valentin Abadia", "V. Abadia", "Yari", "Yari Taft", "Santiago", "Eduardo Viejo", "Nadie Conocido"];
  for (const n of nombres) {
    assert.equal(closerDeLlamada({ anfitrion: n }, EQUIPO).miembro?.id, duenoSegunLaBase(n, EQUIPO), `«${n}»`);
  }
});

test("el closer nuevo la ve y el viejo deja de verla", () => {
  const dante = destinosDePase({ equipo: EQUIPO, sesiones: SESIONES }).find((d) => d.miembro.id === "dante")!;
  const mariano = destinosDePase({ equipo: EQUIPO, sesiones: SESIONES }).find((d) => d.miembro.id === "mariano")!;
  const antes = llamada("x1", "Dante Barbieri");
  assert.ok(esDelCloser(antes, "Dante Barbieri", EQUIPO));
  assert.ok(!esDelCloser(antes, "Mariano", EQUIPO));

  const plan = planDePase(antes, mariano, ctx)!;
  const despues = { ...antes, anfitrion: plan.cambios.anfitrion, extra: plan.cambios.extra };
  assert.ok(esDelCloser(despues, "Mariano", EQUIPO), "el nuevo la ve");
  assert.ok(!esDelCloser(despues, "Dante Barbieri", EQUIPO), "el viejo ya no");
  /* Y lo mismo según la regla de la base. */
  assert.equal(duenoSegunLaBase(despues.anfitrion!, EQUIPO), "mariano");

  /* Deshacer vuelve a dejarla con Dante. */
  const deshecha = { ...despues, anfitrion: plan.antes.anfitrion, extra: plan.antes.extra };
  assert.ok(esDelCloser(deshecha, "Dante Barbieri", EQUIPO));
  void dante;
});

test("se avisa de las ventas ya cargadas, las llamadas ya hechas y las que ya estaban pasadas", () => {
  const llamadas = [
    llamada("v1", "Dante Barbieri", { estadoLlamada: "Compra Full" }),
    llamada("v2", "Dante Barbieri", { extra: { pasada: { a: "Dante Barbieri", calendly: "Mariano Arias", por: "Yari", en: AHORA } } }),
    llamada("v3", "Dante Barbieri"),
  ];
  const ventas = [{ id: "ven1", closerId: "dante" }] as never;
  const avisos = avisosDePase(llamadas, { equipo: EQUIPO, ventas }, (id) => (id === "v1" ? { id: "ven1" } : undefined));
  assert.deepEqual(avisos.conVenta, [{ id: "v1", persona: "Persona v1", closer: "Dante Barbieri" }]);
  assert.equal(avisos.hechas, 1);
  assert.equal(avisos.yaPasadas, 1);
});

test("las llamadas se agrupan por quien las atiende, con el nombre de Equipo, la que más tiene primero", () => {
  const grupos = agruparPorCloser([...SESIONES, llamada("z1", undefined)], EQUIPO);
  assert.deepEqual(grupos.map((g) => [g.nombre, g.llamadas.length]), [
    ["Mariano", 4], ["Dante Barbieri", 2], ["V. Abadia", 2], ["Sin closer", 1], ["Yari Taft", 1],
  ]);
  /* «Mariano Arias» y «Mariano» son la misma persona: un solo grupo. */
  assert.equal(grupos[0].miembro?.id, "mariano");
  /* Un anfitrión que no es de nadie queda con su nombre escrito, sin miembro. */
  assert.equal(grupos.find((g) => g.nombre === "V. Abadia")!.miembro, undefined);
});

test("las que todavía no pasaron: la que está empezando cuenta", () => {
  const ahora = Date.parse("2026-10-09T15:30:00.000Z");
  assert.equal(todaviaNoPaso({ inicia: "2026-10-09T15:00:00.000Z" }, ahora), true, "arrancó hace media hora");
  assert.equal(todaviaNoPaso({ inicia: "2026-10-09T14:00:00.000Z" }, ahora), false, "terminó hace rato");
  assert.equal(todaviaNoPaso({ inicia: "2026-10-10T15:00:00.000Z" }, ahora), true);
});
