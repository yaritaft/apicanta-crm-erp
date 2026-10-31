import test from "node:test";
import assert from "node:assert/strict";
import { estrategiaDeLaVenta, FALTA_ESTRATEGIA } from "@/lib/estrategia-de-venta";
import type { EstadoApp } from "@/lib/types";
import { estadoDePrueba } from "./estado-liquidacion";

/* ==================================================================
   Aldana (31/10): «esas 8 ventas sin estrategia: nadie puede asignarles estrategia».
   El asistente de ventas las dejaba pasar en blanco cuando quien compró no traía una UTM con regla (un lead de Calendly).
   Ahora la estrategia sale de la UTM o la elige quien carga la venta; sin ninguna de las dos, no se registra.
   ================================================================== */

const FECHA = "2026-10-27T15:00:00.000Z";
const conContacto = (utm?: Record<string, string>, reglas: EstadoApp["ajustes"]["reglasUtm"] = []): EstadoApp => {
  const e = estadoDePrueba();
  e.leads = e.leads ?? [];
  e.sesiones = e.sesiones ?? [];
  e.contactos = [...(e.contactos ?? []), { id: "c_cal", nombre: "Josue Lara", email: "", telefono: "", creadoEn: "2026-10-20T10:00:00.000Z", ...(utm ? { utm } : {}) } as never];
  e.ajustes = { ...e.ajustes, reglasUtm: reglas };
  return e;
};

test("un lead de Calendly sin UTM no trae estrategia: hay que elegirla", () => {
  const e = conContacto();
  assert.equal(estrategiaDeLaVenta(e, "c_cal", FECHA), undefined, "sin UTM ni elección, la venta quedaría sin estrategia");
  assert.match(FALTA_ESTRATEGIA, /Elegí la estrategia/);
});

test("la que se elige a mano vale cuando la UTM no dice nada", () => {
  const e = conContacto();
  assert.equal(estrategiaDeLaVenta(e, "c_cal", FECHA, "emb_webinar"), "emb_webinar");
  assert.equal(estrategiaDeLaVenta(e, undefined, FECHA, "emb_setter"), "emb_setter", "un cliente nuevo, sin persona, también");
  assert.equal(estrategiaDeLaVenta(e, "c_cal", FECHA, ""), undefined, "vacío no cuenta");
});

test("si la UTM de quien compró dice la estrategia, manda ella sobre lo elegido", () => {
  const e = conContacto({ utm_source: "ig", utm_campaign: "promo" }, [
    { id: "r1", source: "ig", campaign: "promo", embudoId: "emb_organico", creadoEn: "2026-10-01T00:00:00.000Z" },
  ]);
  assert.equal(estrategiaDeLaVenta(e, "c_cal", FECHA, "emb_webinar"), "emb_organico");
});
