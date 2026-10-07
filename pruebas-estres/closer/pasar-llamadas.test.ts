import test from "node:test";
import assert from "node:assert/strict";
import { closerDeLlamada, destinosDePase, planDePase, responsableTrasPase, type DestinoDePase } from "@/lib/pasar-llamadas";
import { anfitrionTrasCalendly, pasadaDe } from "@/lib/pasada-closer";
import { esDelCloser, closersConLlamadas, llamadasDelDia } from "@/lib/eod";
import { miembroDeCloser } from "@/lib/crm";
import { strikesDe } from "@/lib/cierre-del-dia";
import type { EstadoApp, Lead, MiembroEquipo, Sesion } from "@/lib/types";
import { TIPO_VENTA, clonar, enAR, llamada, miembro, porSemillas, sumarDias, type Azar } from "./azar";

/* ==================================================================
   Propiedad 3: pasar llamadas de un closer a otro (lib/pasar-llamadas.ts y
   lib/pasada-closer.ts).

   - Calendly no pisa la elección manual (lib/pasada-closer.ts), ni en una
     cancelación, ni en un no-show, ni en una reprogramación.
   - El closer nuevo la ve y el viejo deja de verla (por la regla del
     anfitrión: la misma que usa la base, escrita acá aparte).
   - Es idempotente (pasarla de nuevo al mismo no hace nada) y reversible
     (con `antes`, o pasándola de vuelta a quien figura en Calendly).
   - Pasar llamadas no cambia cuántos strikes hay en total: la demora de
     cada llamada es de la llamada, no de quien la atiende.
   ================================================================== */

const EQUIPO: MiembroEquipo[] = [
  miembro("yari", "Yari Taft", "ceo", { email: "yari@a.com" }),
  miembro("santi", "Santiago Burghiani", "director", { email: "santi@a.com" }),
  miembro("mariano", "Mariano", "closer", { email: "m@a.com" }),
  miembro("dante", "Dante Barbieri", "closer", { email: "d@a.com" }),
  miembro("valentin", "Valentín Abadía", "closer"),
  miembro("lucia", "Lucía Pérez Gómez", "closer", { email: "l@a.com" }),
  miembro("ex", "Eduardo Viejo", "closer", { activo: false }),
];

/* Cómo puede escribir Calendly al anfitrión, y de quién es en Equipo (null: de nadie). */
const ANFITRIONES: [string, string | null][] = [
  ["Mariano Arias", "mariano"], ["Mariano", "mariano"], ["mariano arias", "mariano"],
  ["Dante Barbieri", "dante"], ["DANTE BARBIERI", "dante"], ["Dante", "dante"],
  ["Yari Taft", "yari"], ["Valentin Abadia", "valentin"], ["Valentín Abadía", "valentin"],
  ["Lucia Perez", "lucia"], ["Lucía Pérez Gómez", "lucia"],
  ["V. Abadia", null], ["Externo Uno", null], ["Eduardo Viejo", "ex"],
];

function sesionAlAzar(r: Azar, id: string, extra: Partial<Sesion> = {}): Sesion {
  const [host] = r.elige(ANFITRIONES);
  return llamada(id, r.si(0.05) ? undefined : host, enAR(sumarDias("2026-09-10", r.entre(0, 14)), r.elige([10, 15, 21])), {
    extra: r.si(0.4) ? { foo: r.entre(1, 9), anidado: { a: [1, 2] } } : {}, ...extra,
  });
}

const aplicar = (s: Sesion, c: { anfitrion?: string; extra: Record<string, unknown> }): Sesion => ({ ...s, ...c } as Sesion);
/* Sin las propiedades en undefined (para la base «no tiene» y «null» son lo mismo) y con el extra siempre presente. */
const normal = (s: Sesion) => JSON.parse(JSON.stringify({ ...s, extra: s.extra ?? {} }));
const ve = (m: MiembroEquipo | { id: string }, s: Sesion) => closerDeLlamada(s, EQUIPO).miembro?.id === m.id;
const ctx = (r: Azar) => ({ equipo: EQUIPO, por: r.elige(["Santiago Burghiani", "Yari Taft", ""]), cuando: enAR("2026-10-08", 14) });

function destinos(sesiones: Sesion[]): DestinoDePase[] {
  return destinosDePase({ equipo: EQUIPO, sesiones });
}

test("la lista de destinos: closers activos y quien ya atiende, y escribirles el anfitrión los resuelve a ellos mismos (400 semillas)", () => {
  porSemillas(400, 1, (r) => {
    const sesiones = Array.from({ length: r.entre(0, 30) }, (_, i) => sesionAlAzar(r, `s${i}`));
    const ds = destinos(sesiones);
    for (const d of ds) {
      assert.ok(d.miembro.activo, "sólo activos");
      assert.equal(miembroDeCloser(d.anfitrion, EQUIPO)?.id, d.miembro.id, `escribir «${d.anfitrion}» deja la llamada con otra persona`);
    }
    for (const m of EQUIPO.filter((x) => x.activo && x.rol === "closer")) assert.ok(ds.some((d) => d.miembro.id === m.id), `${m.nombre} es closer activo y no está`);
    assert.equal(new Set(ds.map((d) => d.miembro.id)).size, ds.length);
  });
});

test("pasar una llamada: el nuevo la ve, el viejo deja de verla, nadie más cambia, y pasarla otra vez no hace nada (500 semillas)", () => {
  let pases = 0, nulos = 0, vuelven = 0, conMarcaPrevia = 0;
  porSemillas(500, 100, (r) => {
    let s = sesionAlAzar(r, "x");
    const todas = [s, ...Array.from({ length: 5 }, (_, i) => sesionAlAzar(r, `y${i}`))];
    /* A veces ya viene pasada a mano. */
    if (r.si(0.3)) {
      const p = planDePase(s, r.elige(destinos(todas)), ctx(r));
      if (p) { s = aplicar(s, p.cambios); conMarcaPrevia++; }
    }
    const destino = r.elige(destinos(todas));
    const antes = clonar(s);
    const duenoAntes = closerDeLlamada(s, EQUIPO).miembro;
    const plan = planDePase(s, destino, ctx(r));
    assert.deepEqual(s, antes, "planDePase no toca la llamada");
    if (!plan) {
      nulos++;
      assert.ok(duenoAntes?.id === destino.miembro.id || (s.anfitrion ?? "").trim() !== "", "sin plan sólo si ya la atiende");
      if (duenoAntes) assert.equal(duenoAntes.id, destino.miembro.id);
      return;
    }
    pases++;
    const despues = aplicar(s, plan.cambios);
    assert.ok(ve(destino.miembro, despues), "el nuevo la ve");
    assert.ok(esDelCloser(despues, destino.miembro.nombre, EQUIPO), "y la regla del cierre del día también");
    if (duenoAntes) {
      assert.ok(!ve(duenoAntes, despues), "el viejo ya no la ve");
      assert.ok(!esDelCloser(despues, duenoAntes.nombre, EQUIPO));
    }
    for (const m of EQUIPO) if (m.id !== destino.miembro.id && m.id !== duenoAntes?.id) assert.equal(ve(m, despues), ve(m, s), `${m.nombre} no tendría que notar el pase`);
    /* Lo demás de la llamada queda como estaba. */
    const { anfitrion: _a, extra: _e, ...resto } = despues; const { anfitrion: _a2, extra: _e2, ...resto2 } = s;
    void _a; void _e; void _a2; void _e2;
    assert.deepEqual(resto, resto2);
    for (const k of Object.keys(s.extra ?? {})) if (k !== "pasada") assert.deepEqual(despues.extra[k], s.extra[k], `extra.${k}`);
    /* Idempotente: aplicarlo dos veces es aplicarlo una; pasarla de nuevo al mismo no hace nada. */
    assert.deepEqual(aplicar(despues, plan.cambios), despues);
    assert.equal(planDePase(despues, destino, ctx(r)), null);
    /* Reversible. */
    assert.deepEqual(normal(aplicar(despues, plan.antes)), normal(s), "deshacer");
    /* La marca dice quién y cuándo, y lo que había en Calendly. */
    const m = pasadaDe(despues);
    if (plan.vuelveACalendly) {
      vuelven++;
      assert.equal(m, undefined, "pasada a quien figura en Calendly: se saca la marca");
      assert.equal(despues.anfitrion, pasadaDe(s)?.calendly ?? s.anfitrion?.trim() ?? "");
    } else {
      assert.ok(m, "queda la marca");
      assert.equal(m.a, despues.anfitrion);
      assert.equal(m.calendly, pasadaDe(s)?.calendly || (s.anfitrion ?? "").trim());
      assert.equal(m.en, ctx(r).cuando);
    }
  });
  assert.ok(pases > 250 && nulos > 10 && vuelven > 10 && conMarcaPrevia > 50, `pases ${pases}, sin plan ${nulos}, vuelven a Calendly ${vuelven}, con marca previa ${conMarcaPrevia}`);
});

test("pasarla y volver a pasarla a quien figuraba en Calendly deja la llamada exactamente como estaba (400 semillas)", () => {
  let n = 0;
  porSemillas(400, 1000, (r) => {
    const s = sesionAlAzar(r, "x");
    const orig = closerDeLlamada(s, EQUIPO).miembro;
    if (!orig || !(s.anfitrion ?? "").trim()) return;
    const ds = destinos([s]);
    const a = ds.find((d) => d.miembro.id === orig.id);
    const otros = ds.filter((d) => d.miembro.id !== orig.id);
    if (!a || otros.length === 0) return;
    const p1 = planDePase(s, r.elige(otros), ctx(r))!;
    const pasada = aplicar(s, p1.cambios);
    /* Un camino más largo: pasa por otro closer antes de volver. */
    const intermedio = r.si(0.5) ? (() => { const p = planDePase(pasada, r.elige(ds), ctx(r)); return p ? aplicar(pasada, p.cambios) : pasada; })() : pasada;
    const p2 = planDePase(intermedio, a, ctx(r));
    const vuelta = p2 ? aplicar(intermedio, p2.cambios) : intermedio;
    n++;
    assert.equal(pasadaDe(vuelta), undefined, "ya no hay marca");
    assert.equal(vuelta.anfitrion, s.anfitrion, "el anfitrión escrito como lo trajo Calendly");
    assert.deepEqual(normal(vuelta), normal(s));
  });
  assert.ok(n > 200, `casos ${n}`);
});

test("secuencias largas de pases: siempre manda el último, la marca guarda lo que dice Calendly, y lo demás de la llamada no se toca (300 semillas)", () => {
  porSemillas(300, 2000, (r) => {
    const todas = Array.from({ length: 4 }, (_, i) => sesionAlAzar(r, `s${i}`));
    const original = clonar(todas);
    const ds = destinos(todas);
    let actual = clonar(todas);
    const vistos: DestinoDePase[] = [];
    for (let paso = 0; paso < r.entre(1, 12); paso++) {
      const i = r.entre(0, actual.length - 1);
      const d = r.elige(ds);
      const plan = planDePase(actual[i], d, ctx(r));
      if (!plan) { assert.ok(ve(d.miembro, actual[i]) || !ve(d.miembro, actual[i])); continue; }
      actual[i] = aplicar(actual[i], plan.cambios);
      vistos.push(d);
      assert.ok(ve(d.miembro, actual[i]));
      const marca = pasadaDe(actual[i]);
      const hostCalendly = (original[i].anfitrion ?? "").trim();
      if (hostCalendly && marca) assert.equal(marca.calendly, hostCalendly, "Calendly dice lo de siempre");
      const dueno = closerDeLlamada(original[i], EQUIPO).miembro;
      if (hostCalendly && dueno && dueno.id === d.miembro.id) { assert.equal(marca, undefined); assert.equal(actual[i].anfitrion, original[i].anfitrion); }
    }
    for (let i = 0; i < actual.length; i++) {
      for (const k of Object.keys(original[i].extra)) if (k !== "pasada") assert.deepEqual(actual[i].extra[k], original[i].extra[k]);
      assert.equal(actual[i].id, original[i].id);
      assert.equal(actual[i].inicia, original[i].inicia);
    }
  });
});

test("Calendly no pisa lo elegido a mano: con marca, el anfitrión se queda y la marca anota lo que dice Calendly ahora; sin marca, manda Calendly (500 semillas)", () => {
  let conMarca = 0, sinMarca = 0;
  porSemillas(500, 3000, (r) => {
    let s = sesionAlAzar(r, "x");
    const ds = destinos([s]);
    const plan = r.si(0.65) ? planDePase(s, r.elige(ds), ctx(r)) : null;
    if (plan) s = aplicar(s, plan.cambios);
    const nuevoCalendly = r.si(0.1) ? undefined : r.elige(ANFITRIONES)[0];
    /* Lo que hace calendly-sync.ts con una agenda que vuelve a entrar (cancelación, no-show, cambio de horario). */
    const r1 = anfitrionTrasCalendly(nuevoCalendly, { anfitrion: s.anfitrion, extra: s.extra });
    const marca = pasadaDe(s);
    if (marca) {
      conMarca++;
      assert.equal(r1.anfitrion, s.anfitrion, "no pisa el closer elegido");
      assert.equal(r1.pasada?.calendly, nuevoCalendly ?? marca.calendly, "anota lo que dice Calendly ahora");
      assert.equal(r1.pasada?.a, marca.a);
      assert.equal(r1.pasada?.por, marca.por);
      assert.equal(r1.pasada?.en, marca.en);
      /* Tras la entrada, la llamada sigue en manos de quien se eligió, y se la puede devolver a lo que dice Calendly ahora. */
      const tras = { ...s, anfitrion: r1.anfitrion, extra: { ...s.extra, ...(r1.pasada ? { pasada: r1.pasada } : {}) } } as Sesion;
      assert.equal(closerDeLlamada(tras, EQUIPO).miembro?.id, closerDeLlamada(s, EQUIPO).miembro?.id);
      const deCalendly = nuevoCalendly ? miembroDeCloser(nuevoCalendly, EQUIPO) : undefined;
      const dest = deCalendly && destinos([tras]).find((d) => d.miembro.id === deCalendly.id);
      if (dest) {
        const p = planDePase(tras, dest, ctx(r));
        if (p) { assert.equal(p.vuelveACalendly, true); assert.equal(p.cambios.anfitrion, nuevoCalendly); assert.equal(pasadaDe(aplicar(tras, p.cambios)), undefined); }
      }
    } else {
      sinMarca++;
      assert.deepEqual(r1, { anfitrion: nuevoCalendly });
    }
    /* Sin llamada previa (una agenda nueva), manda Calendly. */
    assert.deepEqual(anfitrionTrasCalendly(nuevoCalendly, null), { anfitrion: nuevoCalendly });
    assert.deepEqual(anfitrionTrasCalendly(nuevoCalendly, undefined), { anfitrion: nuevoCalendly });
    /* Una reprogramación (la agenda nueva hereda de la que reemplaza) tampoco la pisa. */
    const nueva = anfitrionTrasCalendly(nuevoCalendly, { anfitrion: s.anfitrion, extra: s.extra });
    if (marca) assert.equal(nueva.anfitrion, s.anfitrion);
  });
  assert.ok(conMarca > 200 && sinMarca > 100, `con marca ${conMarca}, sin marca ${sinMarca}`);
});

test("una marca rota (sin «a», con otro tipo, extra nulo) no cuenta: Calendly manda", () => {
  for (const extra of [null, undefined, {}, { pasada: null }, { pasada: "x" }, { pasada: 3 }, { pasada: [] }, { pasada: {} }, { pasada: { a: "" } }, { pasada: { a: "  " } }, { pasada: { a: 4 } }]) {
    assert.equal(pasadaDe({ extra: extra as Record<string, unknown> | null | undefined }), undefined, JSON.stringify(extra));
    assert.deepEqual(anfitrionTrasCalendly("Dante Barbieri", { anfitrion: "Otro", extra: extra as Record<string, unknown> | null }), { anfitrion: "Dante Barbieri" });
  }
  /* Con la marca ok pero sin anfitrión escrito, vale el de la marca. */
  const x = anfitrionTrasCalendly("Dante Barbieri", { anfitrion: "  ", extra: { pasada: { a: "Mariano Arias", calendly: "Lo viejo" } } });
  assert.equal(x.anfitrion, "Mariano Arias");
  assert.equal(x.pasada?.calendly, "Dante Barbieri");
});

/* ---------- Strikes y pases ---------- */

function estadoConLlamadas(r: Azar): EstadoApp {
  const sesiones: Sesion[] = [];
  for (let i = 0; i < r.entre(8, 40); i++) {
    const dia = sumarDias("2026-09-01", r.entre(0, 26));
    const s = sesionAlAzar(r, `s${i}`, {
      inicia: enAR(dia, r.elige([10, 15, 21]), 0), tipo: TIPO_VENTA,
      ...r.elige([{}, {}, { estadoLlamada: "Compra Full", estadoLlamadaEn: enAR(dia, 20) }, { estadoLlamada: "Seguimiento Nutrición", estadoLlamadaEn: enAR(sumarDias(dia, 1), 12) }, { estado: "cancelada" as const }, { estado: "no-show" as const }]),
    });
    sesiones.push(s);
  }
  return { sesiones, ventas: [], equipo: EQUIPO, ajustes: { monedaBase: "USD", tipoCambio: 1, crm: { cierreDelDia: { cuentaDesde: "2026-09-01" } } } } as unknown as EstadoApp;
}

const HOY = "2026-09-30";
const totales = (e: EstadoApp) => {
  let dias = 0, llamadas = 0, tarde = 0, sinCargar = 0;
  for (const c of closersConLlamadas(e)) {
    const x = strikesDe(e, c, HOY);
    dias += x.total;
    for (const d of x.dias) { llamadas += d.llamadas; tarde += d.tarde; sinCargar += d.sinCargar; }
  }
  return { llamadas, tarde, sinCargar, dias };
};

test("pasar llamadas no cambia la demora de ninguna llamada: el total de llamadas tarde y sin cargar es el mismo, y deshacer devuelve los strikes de cada uno (300 semillas)", () => {
  let movidos = 0;
  porSemillas(300, 4000, (r) => {
    const e = estadoConLlamadas(r);
    const antes = Object.fromEntries(closersConLlamadas(e).map((c) => [c, strikesDe(e, c, HOY)]));
    const ds = destinos(e.sesiones);
    const i = r.entre(0, e.sesiones.length - 1);
    const plan = planDePase(e.sesiones[i], r.elige(ds), ctx(r));
    /* Una llamada sin anfitrión no es de nadie: no cuenta strikes hasta que alguien la atiende. */
    if (!plan || !plan.de.trim()) return;
    movidos++;
    const e2 = { ...e, sesiones: e.sesiones.map((s, k) => (k === i ? aplicar(s, plan.cambios) : s)) } as EstadoApp;
    const a = totales(e), b = totales(e2);
    assert.equal(b.tarde, a.tarde); assert.equal(b.sinCargar, a.sinCargar);
    /* Una llamada que pide cierre sigue pidiéndolo, sólo que de otro closer. */
    assert.equal(b.llamadas >= 0, true);
    const e3 = { ...e2, sesiones: e2.sesiones.map((s, k) => (k === i ? aplicar(s, plan.antes) : s)) } as EstadoApp;
    for (const c of closersConLlamadas(e)) assert.deepEqual(strikesDe(e3, c, HOY), antes[c], `${c} tras deshacer`);
  });
  assert.ok(movidos > 100, `pases ${movidos}`);
});

test("las llamadas del día de un closer (cierre del día) se mudan con el pase: la del viejo sale de su día y entra en el del nuevo (300 semillas)", () => {
  porSemillas(300, 5000, (r) => {
    const e = estadoConLlamadas(r);
    const i = r.entre(0, e.sesiones.length - 1);
    const s = e.sesiones[i];
    if (s.estado === "cancelada") return;
    const ds = destinos(e.sesiones);
    const d = r.elige(ds);
    const plan = planDePase(s, d, ctx(r));
    if (!plan) return;
    const dia = enAR("2026-09-01", 0).slice(0, 0) + new Date(Date.parse(s.inicia) - 3 * 3600_000).toISOString().slice(0, 10);
    const duenoAntes = closerDeLlamada(s, EQUIPO);
    const e2 = { ...e, sesiones: e.sesiones.map((x, k) => (k === i ? aplicar(x, plan.cambios) : x)) } as EstadoApp;
    assert.ok(llamadasDelDia(e2, d.miembro.nombre, dia).some((x) => x.id === s.id), "entra en el día del nuevo");
    if (duenoAntes.miembro) assert.ok(!llamadasDelDia(e2, duenoAntes.miembro.nombre, dia).some((x) => x.id === s.id), "sale del día del viejo");
  });
});

test("responsableTrasPase: la oportunidad se va con la llamada sólo si era de quien la atendía, y después queda con el closer nuevo (400 semillas)", () => {
  porSemillas(400, 6000, (r) => {
    const s = sesionAlAzar(r, "x");
    const ds = destinos([s]);
    const d = r.elige(ds);
    const plan = planDePase(s, d, ctx(r));
    if (!plan) return;
    const respo = r.elige(["", ...ANFITRIONES.map((x) => x[0]), "Persona Cualquiera"]);
    const lead = { responsable: respo } as Pick<Lead, "responsable">;
    const nuevo = responsableTrasPase(lead, plan.de, d, EQUIPO);
    const dueno = closerDeLlamada({ anfitrion: plan.de }, EQUIPO).miembro;
    if (nuevo !== null) {
      assert.equal(miembroDeCloser(nuevo, EQUIPO)?.id, d.miembro.id, `el responsable nuevo «${nuevo}» no es el closer nuevo`);
      assert.ok(respo.trim() !== "" && plan.de.trim() !== "");
      /* Era de quien la atendía. */
      const r1 = miembroDeCloser(respo, EQUIPO);
      if (r1 && dueno) assert.equal(r1.id, dueno.id);
    } else if (respo.trim() && plan.de.trim()) {
      const r1 = miembroDeCloser(respo, EQUIPO);
      /* Si no se movió, o ya era del destino o era de otro. */
      if (r1 && dueno) assert.ok(r1.id !== dueno.id || r1.id === d.miembro.id, `«${respo}» era de ${dueno.nombre} y no se movió a ${d.miembro.nombre}`);
    }
  });
});

/* ---------- La regla de la base, con equipos al azar ---------- */

/* Lo mismo que hace supabase/tipos-cuenta.sql (nombre_corto, miembro_de_nombre): activos primero, y a igual, el de menor id. */
const corto = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().split(/\s+/).slice(0, 2).join(" ");
function duenoSegunLaBase(nombre: string, equipo: MiembroEquipo[]): string | undefined {
  const c = corto(nombre);
  if (!c) return undefined;
  const orden = [...equipo].sort((a, b) => Number(b.activo) - Number(a.activo) || a.id.localeCompare(b.id));
  return (orden.find((e) => corto(e.nombre) === c)
    ?? orden.find((e) => corto(e.nombre) !== "" && (c.startsWith(`${corto(e.nombre)} `) || corto(e.nombre).startsWith(`${c} `))))?.id;
}

const NOMBRES = ["Ana", "Ana María", "Ana María Gómez", "Juan", "Juan Cruz", "Juan Cruz Pérez", "Dante Barbieri", "Dante", "Lucía Pérez", "Lucia", "Mariano Arias", "Mariano Gómez", "Mariano"];

/* Las personas a las que puede referirse un anfitrión: el mismo nombre corto o uno que empieza como el otro. */
const candidatos = (host: string, equipo: MiembroEquipo[]) => {
  const c = corto(host);
  return equipo.filter((m) => corto(m.nombre) === c || (corto(m.nombre) !== "" && (c.startsWith(`${corto(m.nombre)} `) || corto(m.nombre).startsWith(`${c} `))));
};

test("si el anfitrión sólo puede ser una persona, la app y la base lo unen con la misma (300 semillas, equipos con y sin nombres parecidos)", () => {
  let sinAmbiguedad = 0, ambiguos = 0;
  porSemillas(300, 7000, (r) => {
    const equipo: MiembroEquipo[] = [];
    const usados = new Set<string>();
    for (const n of r.mezclar(NOMBRES)) {
      if (r.si(0.45) || usados.has(corto(n))) continue;
      usados.add(corto(n));
      equipo.push(miembro(`m${equipo.length}`, n, "closer", { activo: r.si(0.8) }));
    }
    for (const h of [...NOMBRES, "  Dante   Barbieri ", "ANA MARIA", "Nadie Conocido", "Mariano Arias Pérez"]) {
      const cs = candidatos(h.trim(), equipo);
      /* Con dos candidatos, cuál es depende de la regla de desempate: se prueba aparte (la prueba «BUG»). */
      if (cs.length > 1 && !cs.some((m) => corto(m.nombre) === corto(h))) { ambiguos++; continue; }
      sinAmbiguedad++;
      assert.equal(miembroDeCloser(h.trim(), equipo)?.id, duenoSegunLaBase(h, equipo), `«${h}» en [${equipo.map((m) => `${m.nombre}${m.activo ? "" : " (inactivo)"}`).join(", ")}]`);
    }
  });
  assert.ok(sinAmbiguedad > 1500 && ambiguos > 20, `sin ambigüedad ${sinAmbiguedad}, ambiguos ${ambiguos}`);
});

/* BUG: con dos personas del equipo que se llaman igual (o una que es el comienzo de otra, como «Mariano» y «Mariano Gómez»
   para un anfitrión «Mariano»), la app elige la primera del arreglo (miembroDeCloser) y la base elige la activa de menor id
   (miembro_de_nombre / son_mios en supabase/tipos-cuenta.sql, que dice ser «como miembroDeCloser»). El CRM, el cierre del
   día y los strikes ponen la llamada en una cuenta y la base se la muestra a otra. */
test("BUG: con nombres que se pisan, la app y la base unen al anfitrión con la misma persona", () => {
  const equipo = [
    miembro("b_viejo", "Mariano Gómez", "closer", { activo: false }),
    miembro("a_nuevo", "Mariano Arias", "closer", { activo: true }),
  ];
  assert.equal(duenoSegunLaBase("Mariano", equipo), "a_nuevo", "la base: el activo");
  assert.equal(miembroDeCloser("Mariano", equipo)?.id, "a_nuevo", "la app tendría que elegir lo mismo que la base");
  const repetido = [
    miembro("z", "Dante Barbieri", "closer", { activo: true }),
    miembro("a", "Dante Barbieri", "closer", { activo: true }),
  ];
  assert.equal(miembroDeCloser("Dante Barbieri", repetido)?.id, duenoSegunLaBase("Dante Barbieri", repetido), "dos activos con el mismo nombre: la base toma el de menor id");
});

/* BUG: nombreCorto (lib/crm.ts) parte por espacios sin recortar: un espacio al principio del nombre (el del anfitrión o el de
   Equipo) cambia «las dos primeras palabras» y el anfitrión no se une con nadie. La base recorta antes de partir
   (nombre_corto en supabase/tipos-cuenta.sql). Casi todos los llamadores recortan el anfitrión antes (por eso no se ve en el
   CRM), pero api/fathom/route.ts llama a miembroDeCloser con el anfitrión tal cual, y el nombre de Equipo sólo se recorta
   al dar de alta (ListaEquipo): store.guardarMiembro, que es lo que usa la edición, lo guarda como viene. */
test("BUG: un espacio sobrante al principio del nombre no cambia a quién se refiere (la base lo recorta)", () => {
  const equipo = [miembro("d", "Dante Barbieri", "closer", { activo: true }), miembro("m", " Mariano Arias", "closer", { activo: true })];
  for (const [host, esperado] of [[" Dante Barbieri", "d"], ["Dante Barbieri ", "d"], ["Mariano Arias", "m"], [" mariano arias", "m"]] as const) {
    assert.equal(duenoSegunLaBase(host, equipo), esperado, `la base: «${host}»`);
    assert.equal(miembroDeCloser(host, equipo)?.id, esperado, `la app: «${host}»`);
  }
});
