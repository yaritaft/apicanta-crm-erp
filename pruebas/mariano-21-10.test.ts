import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { filasResells, estadosDeResell } from "@/lib/clientes-cs";
import { diaGuardado, guardarDia, olvidarDia, VIGENCIA_DIA } from "@/lib/dia-recordado";

/* Pedidos de Mariano del 21/10: resells repetidos, grabación y «No responde» en resells, ver cuáles faltan cargar, el día elegido que se
   pierde al volver, el gesto de «atrás» del trackpad, el encabezado fijo y una columna de notas en Leads. */

test("la agenda de resells muestra la grabación que cargaron o, si no, la que Fathom le trajo a la llamada", () => {
  const e = {
    alumnos: [],
    sesiones: [{ id: "ses_1", grabacion: "https://fathom.video/de-la-llamada" }],
    resells: [
      { id: "a", sesionId: "ses_1", fechaHora: "2026-10-14T18:00:00.000Z", nombre: "A" },
      { id: "b", sesionId: "ses_1", grabacion: "https://fathom.video/mia", fechaHora: "2026-10-14T18:00:00.000Z", nombre: "B" },
      { id: "c", sesionId: null, fechaHora: "2026-10-14T18:00:00.000Z", nombre: "C" },
    ],
  };
  assert.deepEqual(filasResells(e as never).map((f) => f.grabacion), ["https://fathom.video/de-la-llamada", "https://fathom.video/mia", ""]);
});

test("«No responde» es un estado de resell más, y se puede elegir junto con otros", () => {
  assert.deepEqual(estadosDeResell("Seguimiento, No responde"), ["Seguimiento", "No responde"]);
});

test("el SQL une las agendas repetidas (una reprogramación deja dos), sólo lo corre el servidor y deja respaldo", () => {
  const sql = readFileSync("supabase/resells-grabacion-y-repetidos.sql", "utf8");
  assert.match(sql, /add column if not exists grabacion text not null default ''/);
  assert.match(sql, /create table if not exists respaldo\.resells_2110/, "respaldo antes de tocar nada");
  assert.match(sql, /create or replace function public\.unir_resells_repetidos\(\)/);
  assert.match(sql, /revoke all on function public\.unir_resells_repetidos\(\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.unir_resells_repetidos\(\) to service_role/);
  assert.match(sql, /coalesce\(sa\.estado, ''\) = 'cancelada'/, "la vieja es la cancelada, también por su llamada (una importada no trae cancelada)");
  assert.match(sql, /lower\(b\.email\) = lower\(a\.email\)/, "la misma persona, por su mail");
  assert.match(sql, /Antes: /, "si los dos tenían estado, el viejo queda en las notas");
  for (const f of ["src/app/api/cron/calendly/route.ts", "src/lib/calendly-sync.ts"]) assert.match(readFileSync(f, "utf8"), /unir_resells_repetidos/, f);
});

test("«Mis llamadas» recuerda el día que el closer eligió unas horas, y después abre en lo de hoy", () => {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k),
  } as Storage;
  const T0 = Date.parse("2026-10-21T13:00:00.000Z");
  assert.equal(diaGuardado(T0), null, "nada guardado: abre en hoy");
  guardarDia(new URLSearchParams("periodo=custom&desde=2026-10-20&hasta=2026-10-20&pendientes=1&pag=3"), T0);
  assert.equal(diaGuardado(T0 + 60_000), "periodo=custom&desde=2026-10-20&hasta=2026-10-20", "sólo el período, no los demás filtros");
  assert.equal(diaGuardado(T0 + VIGENCIA_DIA - 1), "periodo=custom&desde=2026-10-20&hasta=2026-10-20");
  assert.equal(diaGuardado(T0 + VIGENCIA_DIA + 1), null, "pasadas las horas, vuelve a hoy");
  olvidarDia();
  assert.equal(diaGuardado(T0), null, "si vuelve a «Hoy» él mismo, se olvida");
});

test("el gesto de «atrás» del trackpad no se dispara al scrollear una tabla ancha", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.match(css, /html, body \{ overscroll-behavior-x: none; \}/);
  assert.match(css, /\.hk-table-wrap, \[class\*="crm-t"\], \.kpis-caja \{ overscroll-behavior-x: contain; \}/);
});

test("las tablas largas dejan el encabezado fijo (alto propio) y Leads suma una columna de notas editable", () => {
  for (const f of ["src/components/cs/TablaCs.tsx", "src/components/crm-tabla/CrmTabla.tsx"]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /useAltoTabla\(\)/, f);
    assert.match(src, /alto=\{alto\}/, f);
  }
  const leads = readFileSync("src/app/(app)/leads/page.tsx", "utf8");
  assert.match(leads, /clave: "notas", titulo: "Notas"/);
  assert.match(leads, /editor="largo"/);
  assert.match(leads, /COLUMNAS_SUMADAS_LEADS/);
});

test("el aviso de Mis llamadas dice cuáles son las que faltan cargar y Resell lleva directo a las que faltan", () => {
  assert.match(readFileSync("src/components/closers/MisLlamadas.tsx", "utf8"), /periodo: "max"[^}]*pendientes: "1"/);
  assert.match(readFileSync("src/components/crm-tabla/CrmConResells.tsx", "utf8"), /"por-cargar": porCargar > 0 \? "1" : null/);
  const r = readFileSync("src/components/cs/ResellsCs.tsx", "utf8");
  assert.match(r, /params\.get\("por-cargar"\) === "1"/);
  assert.match(r, /Cargar la venta \(con su comprobante\)/, "el comprobante se sube cargando la venta");
  assert.match(r, /<Field label="Grabación de la llamada"/);
});
