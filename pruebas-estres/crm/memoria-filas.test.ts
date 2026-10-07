import test from "node:test";
import assert from "node:assert/strict";
import { filasCrm } from "@/lib/crm";
import { filasTabla } from "@/lib/crm-tabla";
import type { Contacto, Lead, Producto, Sesion, Venta } from "@/lib/types";
import { AHORA, Azar, conSemilla, mundoAzar, type Mundo } from "./gen";

/* ==================================================================
   La memoria de filasCrm (FILAS: una fila por agenda mientras no cambie
   nada de lo que la arma) no puede cambiar el resultado: después de
   cualquier secuencia de ediciones (como las hace el store: reemplaza el
   objeto que cambia, nunca lo edita en el lugar), las filas que da con la
   memoria caliente son iguales, valor por valor, a las que da con la memoria
   fría (copias nuevas de todo, que no están en la memoria).
   ================================================================== */

const fria = (m: Mundo): Mundo => structuredClone(m);

/* `venta.fecha` tiene su propio hallazgo (filas-estados-raros.test.ts): acá se compara todo lo demás. */
const sinFechaDeVenta = <T extends { venta?: { fecha?: string } }>(filas: T[]): T[] => filas.map((f) => (f.venta ? { ...f, venta: { ...f.venta, fecha: "" } } : f));

function editar(r: Azar, m: Mundo): { m: Mundo; que: string } {
  const reemplazar = <T extends { id: string }>(xs: T[], i: number, f: (x: T) => T) => xs.map((x, k) => (k === i ? f(x) : x));
  switch (r.int(12)) {
    case 0: { const i = r.int(m.sesiones.length); return { m: { ...m, sesiones: reemplazar(m.sesiones, i, (s) => ({ ...s, notas: `n${r.int(99)}`, estadoLlamada: r.pick(["Compra Full", "Inasistió", undefined, "Reserva"]) } as Sesion)) }, que: `agenda ${i}: notas y estado` }; }
    case 1: { const i = r.int(m.sesiones.length); return { m: { ...m, sesiones: reemplazar(m.sesiones, i, (s) => ({ ...s, inicia: new Date(Date.parse(s.inicia) + r.entre(-5, 5) * 86_400_000).toISOString() })) }, que: `agenda ${i}: fecha` }; }
    case 2: { const i = r.int(m.contactos.length); return { m: { ...m, contactos: reemplazar(m.contactos, i, (c) => ({ ...c, telefono: `+54 9 11 ${r.int(9999)}`, pais: r.pick(["Chile", "México", undefined]) } as Contacto)) }, que: `contacto ${i}` }; }
    case 3: { const i = r.int(m.leads.length); return { m: { ...m, leads: reemplazar(m.leads, i, (l) => ({ ...l, nombre: `Lead ${r.int(99)}`, telefono: `+34 6${r.int(99999)}` } as Lead)) }, que: `lead ${i}` }; }
    case 4: { const i = r.int(m.ventas.length); return { m: { ...m, ventas: reemplazar(m.ventas, i, (v) => ({ ...v, fecha: new Date(Date.parse(v.fecha) + r.entre(1, 9) * 86_400_000).toISOString() } as Venta)) }, que: `venta ${i}: fecha` }; }
    case 5: { const i = r.int(m.ventas.length); return { m: { ...m, ventas: reemplazar(m.ventas, i, (v) => ({ ...v, precioAcordado: r.pick([100, 2500, 99999]), moneda: r.pick(["USD", "ARS"] as const) } as Venta)) }, que: `venta ${i}: precio` }; }
    case 6: { const i = r.int(m.ventas.length); return { m: { ...m, ventas: reemplazar(m.ventas, i, (v) => ({ ...v, estado: r.pick(["activa", "cancelada", "reembolsada"] as const), sesionId: r.pick([v.sesionId, undefined, m.sesiones[r.int(m.sesiones.length)].id]) } as Venta)) }, que: `venta ${i}: estado y llamada` }; }
    case 7: return { m: { ...m, productos: (m.productos as Producto[]).map((p) => (r.bool() ? { ...p, nombre: `${p.nombre}${r.int(9)}` } : p)) }, que: "productos" };
    case 8: return { m: { ...m, ajustes: { ...m.ajustes, crm: { ...(m.ajustes.crm ?? {}), opciones: r.bool() ? { estadoPreCall: [{ nombre: "Confirmado", color: "verde4" }, { nombre: "Reagendar", color: "amarillo3" }] } : undefined } } as Mundo["ajustes"] }, que: "ajustes" };
    case 9: { const i = r.int(m.sesiones.length); return { m: { ...m, sesiones: reemplazar(m.sesiones, i, (s) => ({ ...s, creadoEn: new Date(Date.parse(s.creadoEn) + r.entre(-9, 9) * 86_400_000).toISOString(), tipo: r.pick(["Asesoramiento Hackear IT", "Auditoría con alumnos", "Mock interview"]), estado: r.pick(["agendada", "cancelada", "no-show", "hecha"] as const), reprogramadaDe: r.pick([undefined, m.sesiones[r.int(m.sesiones.length)].id]) } as Sesion)) }, que: `agenda ${i}: tipo, estado y cuándo agendó` }; }
    case 10: return { m: { ...m, ajustes: { ...m.ajustes, crm: { ...(m.ajustes.crm ?? {}), tablas: r.bool() ? [{ id: "booking", nombre: "Booking Calls", incluir: ["Mock interview"] }] : undefined } } as Mundo["ajustes"] }, que: "tablas del CRM" };
    default: return { m: { ...m, webinars: [...m.webinars].reverse() }, que: "webinars" };
  }
}

test("con la memoria caliente las filas son iguales a las de la memoria fría, después de cualquier secuencia de ediciones", () => {
  for (let semilla = 1; semilla <= 20; semilla++) {
    const r = new Azar(semilla + 10);
    let m = mundoAzar(r, { sesiones: 40, ventas: 25, pagos: 0 }) as Mundo;
    filasCrm(m); /* se llena la memoria */
    const historia: string[] = [];
    for (let paso = 0; paso < 20; paso++) {
      const e = editar(r, m);
      m = e.m; historia.push(e.que);
      const caliente = filasCrm(m);
      const frio = filasCrm(fria(m));
      assert.deepEqual(sinFechaDeVenta(caliente), sinFechaDeVenta(frio), conSemilla(semilla, `después de: ${historia.join(" → ")}`));
    }
  }
});

test("lo mismo en la tabla (filasTabla): las filas con la memoria caliente son las de la fría", () => {
  for (let semilla = 1; semilla <= 15; semilla++) {
    const r = new Azar(semilla + 500);
    let m = mundoAzar(r, { sesiones: 40, ventas: 25, pagos: 30 });
    filasTabla(m, AHORA);
    for (let paso = 0; paso < 15; paso++) {
      m = { ...editar(r, m as Mundo).m, pagos: m.pagos, cuotas: m.cuotas, procesadores: m.procesadores } as typeof m;
      const norm = (fs: ReturnType<typeof filasTabla>) => fs.map((f) => ({ ...f, fila: sinFechaDeVenta([f.fila])[0] }));
      assert.deepEqual(norm(filasTabla(m, AHORA)), norm(filasTabla(fria(m) as typeof m, AHORA)), conSemilla(semilla, `paso ${paso}`));
    }
  }
});

test("BUG: la misma comparación, con la fecha de la venta incluida, no es igual (ver el hallazgo de venta.fecha)", () => {
  for (let semilla = 1; semilla <= 8; semilla++) {
    const r = new Azar(semilla + 10);
    let m = mundoAzar(r, { sesiones: 40, ventas: 25, pagos: 0 }) as Mundo;
    filasCrm(m);
    for (let paso = 0; paso < 20; paso++) {
      m = editar(r, m).m;
      assert.deepEqual(filasCrm(m), filasCrm(fria(m)), conSemilla(semilla, `paso ${paso}`));
    }
  }
});
