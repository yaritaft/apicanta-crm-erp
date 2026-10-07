/* Estrés del trigger control_cruzado_pagos (supabase/control-cruzado.sql) en un Postgres en memoria (PGlite),
   con secuencias aleatorias de INSERT / UPDATE / UPSERT hechas por todos los tipos de cuenta y por la clave de
   servicio, contra un modelo escrito aparte (la especificación del encabezado del SQL) y contra el modelo en
   TypeScript de src/lib/control-cobros.ts (conChequeo, cambiosDeChequeo, conComprobanteNuevo, controlDeCobro) y
   de src/lib/permisos.ts (puedeUsarCasillero, puedeEditar).

   Propiedades:
     1. los casilleros los cambia sólo quien corresponde, a su nombre y con su hora, y la base deja EXACTAMENTE lo que
        calcula conChequeo();
     2. cambiar monto, moneda, día, montoArs, comprobante o link vuelve los dos casilleros a pendiente; cambiar sólo
        las notas no toca nada;
     3. lo que la base dice de quién puede escribir un cobro es lo mismo que puedeEditar().
   Si una falla, el mensaje trae la semilla y la lista de pasos para reproducirla (semillas fijas: es determinista).

   Necesita PGlite (ver pg-arnes.ts); sin él, se saltea. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  cambiosDeChequeo, conChequeo, conComprobanteNuevo, controlDeCobro, puedeUsarCasillero, type CasilleroChequeo,
} from "@/lib/control-cobros";
import { puedeEditar, TIPOS_POR_DEFECTO, type MiAcceso } from "@/lib/permisos";
import type { Pago } from "@/lib/types";
import {
  altaDeTiposAlAzar, asignaciones, Azar, cargarPglite, igualesJson, lit, montarBanco, PERSONAS, type Banco, type Persona,
} from "./pg-arnes";

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/stress/pg-arnes.ts)";

type Fila = Record<string, unknown>;
const CAJAS: readonly CasilleroChequeo[] = ["director", "finanzas"];
const K = (c: CasilleroChequeo): Record<"v" | "por" | "en" | "nota", string> => (c === "director"
  ? { v: "chequeoDirector", por: "chequeoDirectorPor", en: "chequeoDirectorEn", nota: "chequeoDirectorNota" }
  : { v: "chequeoFinanzas", por: "chequeoFinanzasPor", en: "chequeoFinanzasEn", nota: "chequeoFinanzasNota" });
const COLS_CONTROL = CAJAS.flatMap((c) => Object.values(K(c)));
/* Quién es el dueño de cada cuota (lo que ve un closer es sólo lo suyo) y quién es cada persona. Cambia según la corrida. */
interface Contexto { personas: Persona[]; accesos: Map<string, MiAcceso>; duenos: Record<string, string | null> }
const POR_DEFECTO = (): Contexto => ({
  personas: PERSONAS,
  accesos: new Map(PERSONAS.map((p) => {
    const t = TIPOS_POR_DEFECTO.find((x) => x.id === p.tipo)!;
    return [p.email, { tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo, miembroId: p.miembroId } as MiAcceso];
  })),
  duenos: { c1: "m_dante", c2: "m_otro", c3: null },
});
let mundo: Contexto = POR_DEFECTO();
const acceso = (p: Persona): MiAcceso => mundo.accesos.get(p.email)!;
const AHORA = Symbol("ahora");
type Esperado = Record<string, unknown>;

/* ---------- el modelo: la especificación del encabezado de control-cruzado.sql ---------- */

const mismoNumero = (a: unknown, b: unknown) => (a === null || a === undefined || b === null || b === undefined
  ? (a ?? null) === (b ?? null) : Number(a) === Number(b));
const mismoTexto = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

function cambiaLaPrueba(vieja: Fila, nueva: Fila): boolean {
  return (vieja.comprobante != null && !igualesJson(nueva.comprobante ?? null, vieja.comprobante))
    || (vieja.comprobanteLink != null && !mismoTexto(nueva.comprobanteLink, vieja.comprobanteLink))
    || !mismoNumero(nueva.monto, vieja.monto) || !mismoTexto(nueva.moneda, vieja.moneda)
    || !mismoTexto(nueva.fecha, vieja.fecha) || !mismoNumero(nueva.montoArs, vieja.montoArs);
}

const puedeCaja = (u: Persona | null, c: CasilleroChequeo) => (u ? puedeUsarCasillero(acceso(u), c) : true);
const esPersona = (u: Persona | null): u is Persona => u !== null;

/** Lo que tiene que quedar al insertar. */
function modeloInsert(u: Persona | null, fila: Fila): Esperado {
  const e: Esperado = { ...fila };
  if (!esPersona(u)) return e;
  e.cargadoPor = u.email;
  for (const c of CAJAS) {
    const k = K(c);
    if (puedeCaja(u, c) && fila[k.v] != null) { e[k.por] = u.email; e[k.en] = AHORA; }
    else { e[k.v] = null; e[k.por] = null; e[k.en] = null; e[k.nota] = null; }
  }
  const tilde = puedeCaja(u, "director") || puedeCaja(u, "finanzas");
  /* Atar un cobro a un movimiento es de quien concilia (director y finanzas): a los demás la base les ignora el dato. */
  if (!tilde) { e.movimientoId = null; e.chequeado = null; }
  return e;
}

/** Lo que tiene que quedar al actualizar `vieja` con `pedido` (las columnas que vienen en el SET). */
function modeloUpdate(u: Persona | null, vieja: Fila, pedido: Fila): Esperado {
  const propuesta: Fila = { ...vieja, ...pedido };
  const e: Esperado = { ...propuesta };
  if (!esPersona(u)) return e;
  e.cargadoPor = vieja.cargadoPor ?? null;
  const reemplazo = cambiaLaPrueba(vieja, propuesta);
  for (const c of CAJAS) {
    const k = K(c);
    const pidioOtro = !mismoTexto(propuesta[k.v], vieja[k.v]) || !mismoTexto(propuesta[k.nota], vieja[k.nota]);
    if (reemplazo) { e[k.v] = null; e[k.por] = null; e[k.en] = null; e[k.nota] = null; }
    else if (!pidioOtro) { e[k.v] = vieja[k.v] ?? null; e[k.nota] = vieja[k.nota] ?? null; e[k.por] = vieja[k.por] ?? null; e[k.en] = vieja[k.en] ?? null; }
    else if (!puedeCaja(u, c)) { for (const x of Object.values(k)) e[x] = vieja[x] ?? null; }
    else if (propuesta[k.v] == null) { e[k.v] = null; e[k.por] = null; e[k.en] = null; e[k.nota] = null; }
    else { e[k.por] = u.email; e[k.en] = AHORA; }
  }
  const tilde = puedeCaja(u, "director") || puedeCaja(u, "finanzas");
  /* Atar o desatar el movimiento es de quien concilia: a los demás les queda el de antes (y entonces cuenta el de antes). */
  const movimiento = tilde ? propuesta.movimientoId : (vieja.movimientoId ?? null);
  e.movimientoId = movimiento ?? null;
  if (reemplazo && movimiento == null) e.chequeado = null;
  else if (!mismoTexto(propuesta.chequeado, vieja.chequeado) && !tilde) e.chequeado = vieja.chequeado ?? null;
  return e;
}

/** ¿La base deja escribir ese cobro a esa persona? (puedeEditar de permisos.ts + "sólo lo suyo"). */
function puedeEscribir(u: Persona | null, cuotaId: unknown): boolean {
  if (!esPersona(u)) return true;
  const a = acceso(u);
  if (!puedeEditar(a, "pagos")) return false;
  return !a.soloLoSuyo || mundo.duenos[String(cuotaId)] === u.miembroId;
}

/* ---------- el banco ---------- */

/* Un solo Postgres para todo el archivo (montarlo cuesta ~1 s): cada prueba vacía las tablas y vuelve a sembrar. */
let compartido: Promise<Banco> | null = null;
const banco = (): Promise<Banco> => (compartido ??= montarBanco(Pg!, { archivos: ["control-cruzado.sql"], veces: 2 }));
after(async () => { if (compartido) await (await compartido).db.close(); });

async function sembrar(b: Banco, az: Azar): Promise<void> {
  await b.servicio(`truncate public.pagos, public.cuotas, public.ventas`);
  const cuotas = Object.keys(mundo.duenos);
  await b.servicio(`insert into public.ventas (id, "closerId") values ${cuotas.map((c, i) => `('v${i + 1}', ${lit(mundo.duenos[c])})`).join(", ")}`);
  await b.servicio(`insert into public.cuotas (id, "ventaId") values ${cuotas.map((c, i) => `(${lit(c)}, 'v${i + 1}')`).join(", ")}`);
  const ISO = (d: number) => new Date(Date.UTC(2026, 0, 1 + d)).toISOString();
  for (let i = 1; i <= 5; i++) {
    const f: Fila = {
      id: `p${i}`, cuotaId: az.elegir(cuotas), monto: 100 * i, moneda: "USD", fecha: `2026-09-0${i}`, montoArs: az.bool() ? 1000 * i : null,
      comprobante: az.bool(0.7) ? { ruta: `r${i}`, nombre: "a.png" } : null, comprobanteLink: az.bool(0.3) ? `https://d/${i}` : null,
      movimientoId: az.bool(0.2) ? `mov${i}` : null, chequeado: az.elegir([null, true, false]),
      chequeoDirector: az.elegir([null, "chequeado", "rechazado"]), chequeoFinanzas: az.elegir([null, "chequeado", "rechazado"]),
    };
    f.chequeoDirectorPor = f.chequeoDirector ? "santi@x.com" : null; f.chequeoDirectorEn = f.chequeoDirector ? ISO(i) : null;
    f.chequeoDirectorNota = f.chequeoDirector === "rechazado" ? "no se lee" : null;
    f.chequeoFinanzasPor = f.chequeoFinanzas ? "aldana@x.com" : null; f.chequeoFinanzasEn = f.chequeoFinanzas ? ISO(i + 1) : null;
    f.chequeoFinanzasNota = f.chequeoFinanzas === "rechazado" ? "otro monto" : null;
    f.cargadoPor = "dante@x.com";
    const cols = Object.keys(f);
    await b.servicio(`insert into public.pagos (${cols.map((c) => `"${c}"`).join(",")}) values (${cols.map((c) => lit(f[c])).join(",")})`);
  }
}
const leerTodo = async (b: Banco): Promise<Map<string, Fila>> => {
  const rows = await b.servicio<{ j: Fila }>(`select row_to_json(p) as j from public.pagos p order by id`);
  return new Map(rows.map((r) => [String(r.j.id), r.j]));
};

/* ---------- comparar ---------- */

const DATOS = ["monto", "moneda", "fecha", "montoArs", "comprobante", "comprobanteLink", "movimientoId", "chequeado", "notas", "cuotaId"];
function comparar(donde: string, esperado: Esperado, real: Fila, inicio: number): void {
  for (const col of [...DATOS, ...COLS_CONTROL, "cargadoPor"]) {
    const e = esperado[col] ?? null, r = real[col] ?? null;
    if (e === AHORA) {
      assert.ok(typeof r === "string", `${donde}: ${col} tenía que quedar con la hora de ahora y quedó ${JSON.stringify(r)}`);
      const t = Date.parse(r as string);
      assert.ok(Math.abs(t - inicio) < 120_000, `${donde}: ${col} = ${r} no es de ahora`);
    } else if (col === "monto" || col === "montoArs") assert.ok(mismoNumero(e, r), `${donde}: ${col} esperado ${JSON.stringify(e)}, quedó ${JSON.stringify(r)}`);
    else if (col === "comprobante") assert.ok(igualesJson(e, r), `${donde}: comprobante esperado ${JSON.stringify(e)}, quedó ${JSON.stringify(r)}`);
    else if (col === "chequeoDirectorEn" || col === "chequeoFinanzasEn") {
      assert.ok((e === null) === (r === null) && (e === null || Date.parse(String(e)) === Date.parse(String(r))), `${donde}: ${col} esperado ${JSON.stringify(e)}, quedó ${JSON.stringify(r)}`);
    } else assert.equal(r, e, `${donde}: ${col} esperado ${JSON.stringify(e)}, quedó ${JSON.stringify(r)}`);
  }
}

/** La fila de la base como la ve la app (los null son "sin dato"). */
const comoPago = (f: Fila): Pago => {
  const p: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) if (v !== null) p[k] = v;
  return p as unknown as Pago;
};

/* ---------- las operaciones al azar ---------- */

type Paso = { quien: string; tipo: string; sql: string };

let comprobadosConTs = 0;
const cobertura = { cajaLlenada: 0, cajaRechazadaPorNoPoder: 0, reinicios: 0, tildeDeAntesPisado: 0, insertsRechazados: 0, sinEfecto: 0 };
async function correr(semilla: number, pasos: number): Promise<void> {
  const az = new Azar(semilla);
  const b = await banco();
  const cuotasIds = Object.keys(mundo.duenos);
  const traza: Paso[] = [];
  const ctx = () => `semilla ${semilla}\n${traza.slice(-12).map((p, i) => `  ${traza.length - 12 + i + 1}. [${p.quien}] ${p.tipo}: ${p.sql}`).join("\n")}`;
  try {
    await sembrar(b, az);
    const personas: (Persona | null)[] = [...mundo.personas, null, null];
    for (let n = 0; n < pasos; n++) {
      const antes = await leerTodo(b);
      /* Que los «sólo lo suyo» (closers) caigan seguido sobre cobros suyos: es donde está el freno. */
      const closers = mundo.personas.filter((x) => acceso(x).soloLoSuyo);
      const u = closers.length && az.bool(0.3) ? az.elegir(closers) : az.elegir(personas);
      const email = u?.email ?? null;
      const propios = u ? [...antes.keys()].filter((id) => puedeEscribir(u, antes.get(id)!.cuotaId)) : [];
      const objetivo = propios.length && az.bool(0.7) ? az.elegir(propios) : az.elegir([...antes.keys()]);
      const vieja = antes.get(objetivo)!;
      const inicio = Date.now();
      const forjada = "falso@evil.com", enForjada = "2000-01-01T00:00:00.000Z";
      const tipoOp = az.elegir(["update", "update", "update", "casillero", "casillero", "casillero", "comprobante", "insert", "upsert", "notas", "tilde"]);
      let sql = "", esperado: Esperado | null = null, objetivoEsperado = objetivo, falla = false, tsCaja: CasilleroChequeo | null = null;
      let pedidoGuardado: Fila = {};

      if (tipoOp === "update" || tipoOp === "notas" || tipoOp === "casillero" || tipoOp === "comprobante" || tipoOp === "tilde") {
        const pedido: Fila = {};
        const otraPrueba = () => az.elegir([null, { ruta: "A", nombre: "a" }, { ruta: "B", nombre: "b" }, vieja.comprobante]);
        if (tipoOp === "notas") pedido.notas = az.elegir(["x", "y", null]);
        else if (tipoOp === "tilde") pedido.chequeado = az.elegir([null, true, false]);
        else if (tipoOp === "casillero") {
          const c = az.elegir(CAJAS); tsCaja = c;
          const v = az.elegir<"chequeado" | "rechazado" | null>(["chequeado", "rechazado", null]);
          Object.assign(pedido, cambiosDeChequeo(c, v, { por: forjada, en: enForjada, nota: az.elegir(["", "  motivo ", "no coincide"]) }));
        } else if (tipoOp === "comprobante") {
          const nuevo = az.elegir([{ ruta: "A", nombre: "a", tipo: "image/png", tamanio: 1, subidoEn: "x" }, { ruta: "B", nombre: "b", tipo: "image/png", tamanio: 2, subidoEn: "y" },
            ...(vieja.comprobante ? [vieja.comprobante as Fila] : [])]);
          Object.assign(pedido, conComprobanteNuevo(comoPago(vieja), nuevo as never).cambios);
        } else {
          const cols = az.mezclar(["monto", "moneda", "fecha", "montoArs", "comprobante", "comprobanteLink", "movimientoId", "chequeado", "notas", "cuotaId",
            "chequeoDirector", "chequeoDirectorPor", "chequeoDirectorEn", "chequeoDirectorNota", "chequeoFinanzas", "chequeoFinanzasPor", "chequeoFinanzasEn", "chequeoFinanzasNota", "cargadoPor"]);
          for (const c of cols.slice(0, 1 + az.entero(4))) {
            switch (c) {
              case "monto": pedido[c] = az.elegir([vieja.monto, Number(vieja.monto) + 1, 0, 12.5]); break;
              case "moneda": pedido[c] = az.elegir(["USD", "ARS", vieja.moneda]); break;
              case "fecha": pedido[c] = az.elegir(["2026-10-01", "2026-10-02", vieja.fecha]); break;
              case "montoArs": pedido[c] = az.elegir([null, 1000, vieja.montoArs]); break;
              case "comprobante": pedido[c] = otraPrueba(); break;
              case "comprobanteLink": pedido[c] = az.elegir([null, "l1", "l2", vieja.comprobanteLink]); break;
              case "movimientoId": pedido[c] = az.elegir([null, "mov1", "mov2", vieja.movimientoId]); break;
              case "chequeado": pedido[c] = az.elegir([null, true, false]); break;
              case "notas": pedido[c] = "n" + az.entero(3); break;
              case "cuotaId": pedido[c] = az.elegir(cuotasIds); break;
              case "chequeoDirector": case "chequeoFinanzas": pedido[c] = az.elegir([null, "chequeado", "rechazado", vieja[c]]); break;
              case "chequeoDirectorNota": case "chequeoFinanzasNota": pedido[c] = az.elegir([null, "n1", "n2", vieja[c]]); break;
              case "chequeoDirectorPor": case "chequeoFinanzasPor": pedido[c] = az.elegir([forjada, null, vieja[c]]); break;
              case "chequeoDirectorEn": case "chequeoFinanzasEn": pedido[c] = az.elegir([enForjada, null, vieja[c]]); break;
              case "cargadoPor": pedido[c] = az.elegir([forjada, null]); break;
            }
          }
        }
        sql = `update public.pagos set ${asignaciones(pedido)} where id = ${lit(objetivo)}`;
        const nuevoCuota = pedido.cuotaId ?? vieja.cuotaId;
        if (!puedeEscribir(u, vieja.cuotaId)) esperado = { ...vieja };
        else if (!puedeEscribir(u, nuevoCuota)) { esperado = { ...vieja }; falla = true; }
        else esperado = modeloUpdate(u, vieja, pedido);

        pedidoGuardado = pedido;
      } else if (tipoOp === "insert") {
        const id = `n${n}`;
        /* Que quien sólo escribe lo suyo caiga seguido en una cuota suya: ahí es donde el INSERT no tiene que dejarle llenar un casillero. */
        const cuotaParaInsertar = () => {
          const propias = u ? cuotasIds.filter((c) => puedeEscribir(u, c)) : [];
          return propias.length && az.bool(0.6) ? az.elegir(propias) : az.elegir(cuotasIds);
        };
        const fila: Fila = {
          id, cuotaId: cuotaParaInsertar(), monto: az.elegir([10, 50]), moneda: "USD", fecha: "2026-10-01",
          chequeado: az.elegir([null, true]), movimientoId: az.elegir([null, "mov9"]),
          chequeoDirector: az.elegir([null, "chequeado", "rechazado"]), chequeoDirectorPor: az.elegir([forjada, null]), chequeoDirectorEn: az.elegir([enForjada, null]),
          chequeoDirectorNota: az.elegir([null, "n"]), chequeoFinanzas: az.elegir([null, "chequeado", "rechazado"]),
          chequeoFinanzasPor: az.elegir([forjada, null]), chequeoFinanzasEn: az.elegir([enForjada, null]), chequeoFinanzasNota: az.elegir([null, "n"]),
          cargadoPor: az.elegir([forjada, null]),
        };
        const cols = Object.keys(fila);
        sql = `insert into public.pagos (${cols.map((c) => `"${c}"`).join(",")}) values (${cols.map((c) => lit(fila[c])).join(",")})`;
        objetivoEsperado = id;
        if (!puedeEscribir(u, fila.cuotaId)) { falla = true; esperado = null; }
        else esperado = { ...modeloInsert(u, { monto: 0, moneda: "USD", ...fila }) };
        if (esperado) for (const c of DATOS) if (!(c in esperado)) esperado[c] = null;
      } else {
        /* upsert del cobro entero, como lo manda la app: sin las columnas del control (sinColumnasDelControl) pero con el tilde de antes. */
        const payload: Fila = {
          id: objetivo, cuotaId: vieja.cuotaId, monto: az.elegir([vieja.monto, Number(vieja.monto) + 5]), moneda: vieja.moneda, fecha: vieja.fecha,
          montoArs: vieja.montoArs, comprobante: vieja.comprobante, comprobanteLink: vieja.comprobanteLink,
          movimientoId: az.elegir([vieja.movimientoId, null]), chequeado: az.elegir([vieja.chequeado, true, null]), notas: "up",
        };
        const cols = Object.keys(payload);
        sql = `insert into public.pagos (${cols.map((c) => `"${c}"`).join(",")}) values (${cols.map((c) => lit(payload[c])).join(",")}) `
          + `on conflict (id) do update set ${cols.filter((c) => c !== "id").map((c) => `"${c}" = excluded."${c}"`).join(", ")}`;
        if (!puedeEscribir(u, payload.cuotaId)) { esperado = { ...vieja }; falla = u !== null; }
        else {
          const excluida = modeloInsert(u, { ...payload });
          const pedido: Fila = {};
          for (const c of cols) if (c !== "id") pedido[c] = excluida[c];
          esperado = modeloUpdate(u, vieja, pedido);
        }
      }

      traza.push({ quien: email ?? "servicio", tipo: tipoOp, sql });
      const r = await b.intentar(email, sql);
      if (falla && tipoOp === "insert") cobertura.insertsRechazados++;
      if (falla) assert.ok(!r.ok && r.codigo === "42501", `${ctx()}\nse esperaba que la base lo rechazara (RLS) y respondió ${JSON.stringify(r)}`);
      else assert.ok(r.ok, `${ctx()}\nla base lo rechazó: ${r.ok ? "" : r.mensaje}`);

      const despues = await leerTodo(b);
      /* Nada más se movió. */
      for (const [id, fila] of antes) {
        if (id === objetivoEsperado) continue;
        assert.deepEqual(despues.get(id), fila, `${ctx()}\nse movió otro cobro (${id})`);
      }
      if (esperado) {
        const real = despues.get(objetivoEsperado);
        assert.ok(real, `${ctx()}\nfalta el cobro ${objetivoEsperado}`);
        comparar(`${ctx()}\nmodelo`, esperado, real, inicio);
        /* Cobertura: que el generador de verdad llegue a los casos que importan. */
        for (const c of CAJAS) {
          const k = K(c);
          if (vieja[k.v] == null && real[k.v] != null && u && tipoOp !== "insert") cobertura.cajaLlenada++;
          if (vieja[k.v] != null && real[k.v] == null && esperado[k.v] === null && tipoOp !== "casillero") cobertura.reinicios++;
          if (tipoOp === "casillero" && u && !puedeCaja(u, c) && puedeEscribir(u, vieja.cuotaId) && tsCaja === c) cobertura.cajaRechazadaPorNoPoder++;
        }
        if (vieja.chequeado === true && real.chequeado !== true && u) cobertura.tildeDeAntesPisado++;
        /* El modelo en TypeScript: lo que la base deja al chequear tiene que ser lo que calcula conChequeo(). */
        if (tsCaja && u && !falla && puedeEscribir(u, vieja.cuotaId) && puedeCaja(u, tsCaja)) {
          const k = K(tsCaja);
          const distinto = !mismoTexto(pedidoGuardado[k.v], vieja[k.v]) || !mismoTexto(pedidoGuardado[k.nota], vieja[k.nota]);
          if (distinto) {
            const veredicto = (pedidoGuardado[k.v] ?? null) as "chequeado" | "rechazado" | null;
            const ts = conChequeo(comoPago(vieja), tsCaja, veredicto, { por: u.email, en: String(real[k.en] ?? ""), nota: (pedidoGuardado[k.nota] ?? undefined) as string | undefined });
            const tsFila = ts as unknown as Record<string, unknown>;
            for (const col of [k.v, k.por, k.nota]) assert.equal(real[col] ?? null, tsFila[col] ?? null, `${ctx()}\nconChequeo vs base: ${col}`);
            assert.equal(real[k.en] ? Date.parse(String(real[k.en])) : null, tsFila[k.en] ? Date.parse(String(tsFila[k.en])) : null, `${ctx()}\nconChequeo vs base: ${k.en}`);
            assert.equal(controlDeCobro(comoPago(real)).estado, controlDeCobro(ts).estado, `${ctx()}\nconChequeo vs base: estado`);
            comprobadosConTs++;
          }
        }
      } else assert.equal(despues.has(objetivoEsperado), false, `${ctx()}\nse creó un cobro que la base tenía que rechazar`);
    }
  } finally { /* el banco es de todo el archivo: lo cierra after() */ }
}

const preparar = async (b: Banco, personas: Contexto = POR_DEFECTO()): Promise<void> => {
  mundo = personas;
  await b.servicio(`truncate public.pagos, public.cuotas, public.ventas`);
  await b.servicio(`insert into public.ventas (id, "closerId") values ('v1','m_dante')`);
  await b.servicio(`insert into public.cuotas (id, "ventaId") values ('c1','v1')`);
};

test("el trigger deja exactamente lo que dice el modelo, con secuencias al azar de todos los tipos de cuenta", { skip: saltear }, async () => {
  mundo = POR_DEFECTO();
  for (const semilla of [101, 202, 303, 404]) await correr(semilla, 65);
  assert.ok(comprobadosConTs >= 8, `el generador tiene que ejercitar conChequeo() (${comprobadosConTs} casos)`);
  assert.ok(cobertura.cajaLlenada >= 5 && cobertura.reinicios >= 8 && cobertura.cajaRechazadaPorNoPoder >= 5 && cobertura.insertsRechazados >= 3,
    `el generador tiene que llegar a los casos que importan: ${JSON.stringify(cobertura)}`);
});

/* Tipos de cuenta inventados (áreas y «sólo lo suyo» al azar): lo que decide quién llena cada casillero es nivel_area() y
   solo_lo_suyo() de la base, y puedeUsarCasillero() de la app tiene que decir lo mismo para cualquier combinación. */
test("con tipos de cuenta inventados, la base y puedeUsarCasillero()/puedeEditar() dicen lo mismo", { skip: saltear }, async () => {
  const b = await banco();
  const gente = await altaDeTiposAlAzar(b, new Azar(7), 14, "tz");
  const accesos = new Map(gente.map((p) => [p.email, p.acceso] as const));
  /* Los primeros 10 son dueños de una cuota cada uno (lo que ve un «sólo lo suyo»); los otros no tienen ninguna. */
  const duenos: Record<string, string | null> = Object.fromEntries(gente.map((p, i) => [`c${i + 1}`, i < 10 ? p.miembroId! : null]));
  const antes = { ...cobertura };
  for (const semilla of [11, 12]) {
    mundo = { personas: gente, accesos, duenos };
    await correr(semilla, 80);
  }
  mundo = POR_DEFECTO();
  assert.ok(cobertura.cajaLlenada - antes.cajaLlenada >= 1 && cobertura.cajaRechazadaPorNoPoder - antes.cajaRechazadaPorNoPoder >= 5,
    `los tipos inventados tienen que llenar y que chocar con casilleros: antes ${JSON.stringify(antes)}, después ${JSON.stringify(cobertura)}`);
});

/* ---------- casos de borde con nombre ---------- */

test("un cobro chequeado que el closer cambia de monto, moneda, día, montoArs, comprobante o link vuelve a pendiente; las notas no", { skip: saltear }, async () => {
  const b = await banco();
  const casos: [string, Fila][] = [
    ["monto", { monto: 101 }], ["moneda", { moneda: "ARS" }], ["fecha", { fecha: "2026-10-09" }], ["montoArs", { montoArs: 5 }],
    ["comprobante", { comprobante: { ruta: "otro" } }], ["comprobanteLink", { comprobanteLink: "https://d/otro" }],
  ];
  for (const [nombre, cambio] of casos) {
    await preparar(b);
    await b.servicio(`insert into public.pagos (id, "cuotaId", monto, moneda, fecha, "montoArs", comprobante, "comprobanteLink", chequeado, "chequeoDirector", "chequeoDirectorPor", "chequeoDirectorEn", "chequeoFinanzas", "chequeoFinanzasPor", "chequeoFinanzasEn")
      values ('p', 'c1', 100, 'USD', '2026-10-01', 1000, '{"ruta":"a"}', 'https://d/x', true, 'chequeado', 'santi@x.com', now(), 'chequeado', 'aldana@x.com', now())`);
    const r = await b.intentar("dante@x.com", `update public.pagos set ${asignaciones(cambio)} where id = 'p'`);
    assert.ok(r.ok, nombre);
    const [f] = await b.servicio<Fila>(`select * from public.pagos where id = 'p'`);
    assert.equal(f.chequeoDirector, null, `${nombre}: el casillero del director`);
    assert.equal(f.chequeoFinanzas, null, `${nombre}: el casillero de finanzas`);
    assert.equal(f.chequeado, null, `${nombre}: el sí/no de antes`);
  }
  await b.servicio(`update public.pagos set "chequeoDirector" = 'chequeado', "chequeoFinanzas" = 'chequeado', chequeado = true where id = 'p'`);
  const r = await b.intentar("dante@x.com", `update public.pagos set notas = 'sólo una nota' where id = 'p'`);
  assert.ok(r.ok);
  const [f] = await b.servicio<Fila>(`select * from public.pagos where id = 'p'`);
  assert.ok(f.chequeoDirector === "chequeado" && f.chequeoFinanzas === "chequeado" && f.chequeado === true, "cambiar sólo las notas no toca los chequeos");
});

test("el upsert del cobro entero (como lo manda la app) por el closer no pisa el control ni el tilde de antes", { skip: saltear }, async () => {
  const b = await banco();
  await preparar(b);
  await b.servicio(`insert into public.pagos (id, "cuotaId", monto, moneda, fecha, chequeado, "chequeoDirector", "chequeoDirectorPor", "chequeoDirectorEn", "cargadoPor")
    values ('p', 'c1', 100, 'USD', '2026-10-01', true, 'chequeado', 'santi@x.com', now(), 'dante@x.com')`);
  const r = await b.intentar("dante@x.com", `insert into public.pagos (id, "cuotaId", monto, moneda, fecha, chequeado, notas) values ('p','c1',100,'USD','2026-10-01', true, 'n')
    on conflict (id) do update set "cuotaId" = excluded."cuotaId", monto = excluded.monto, moneda = excluded.moneda, fecha = excluded.fecha, chequeado = excluded.chequeado, notas = excluded.notas`);
  assert.ok(r.ok, r.ok ? "" : r.mensaje);
  const [f] = await b.servicio<Fila>(`select * from public.pagos where id = 'p'`);
  assert.equal(f.chequeado, true);
  assert.equal(f.chequeoDirector, "chequeado");
  assert.equal(f.chequeoDirectorPor, "santi@x.com");
  assert.equal(f.cargadoPor, "dante@x.com");
  assert.equal(f.notas, "n");
});

/* BUG: el trigger conserva `chequeado = true` en el INSERT, y no reinicia el sí/no de antes ante un cambio de monto en el UPDATE,
   con tal de que el cobro tenga un movimientoId («atado a la pasarela»), pero NO verifica que ese movimientoId sea un cobro real
   de la pasarela: el closer, que escribe sus propios cobros, puede escribir cualquier texto. Ver el hallazgo en el informe. */
test("BUG: un closer no debería poder dar por chequeado un cobro nuevo inventándole un movimientoId", { skip: saltear }, async () => {
  const b = await banco();
  await preparar(b);
  const a = await b.intentar("dante@x.com", `insert into public.pagos (id, "cuotaId", monto, chequeado, "movimientoId") values ('p1','c1', 9999, true, 'mov-inventado')`);
  assert.ok(a.ok);
  const [p1] = await b.servicio<Fila>(`select chequeado from public.pagos where id = 'p1'`);
  assert.notEqual(p1.chequeado, true, "el tilde del closer no cuenta como chequeo, tampoco con un movimientoId inventado");
});

test("BUG: un closer no debería poder conservar el tilde de antes de un cobro al que le sube el monto atándole un movimientoId inventado", { skip: saltear }, async () => {
  const b = await banco();
  await preparar(b);
  await b.servicio(`insert into public.pagos (id, "cuotaId", monto, chequeado, "chequeoDirector", "chequeoDirectorPor", "chequeoDirectorEn") values ('p2','c1', 100, true, 'chequeado', 'santi@x.com', now())`);
  const c = await b.intentar("dante@x.com", `update public.pagos set "movimientoId" = 'mov-inventado', monto = 999999 where id = 'p2'`);
  assert.ok(c.ok);
  const [p2] = await b.servicio<Fila>(`select chequeado, "chequeoDirector" from public.pagos where id = 'p2'`);
  assert.equal(p2.chequeoDirector, null, "el casillero del director sí se reinicia");
  assert.notEqual(p2.chequeado, true, "el tilde de antes también tendría que reiniciarse: el monto cambió y la pasarela no existe");
});

test("conComprobanteNuevo (TypeScript) y el trigger coinciden en qué reinicia y qué no", { skip: saltear }, async () => {
  const b = await banco();
  const nuevoA = { ruta: "a", nombre: "a.png", tipo: "image/png", tamanio: 1, subidoEn: "2026-10-01" };
  const nuevoB = { ruta: "b", nombre: "b.png", tipo: "image/png", tamanio: 2, subidoEn: "2026-10-02" };
  for (const previo of [null, nuevoA]) {
    for (const movimiento of [null, "mov1"]) {
      for (const nuevo of [nuevoA, nuevoB]) {
        await preparar(b);
        await b.servicio(`insert into public.pagos (id, "cuotaId", monto, comprobante, "movimientoId", chequeado, "chequeoDirector", "chequeoDirectorPor", "chequeoDirectorEn", "chequeoFinanzas", "chequeoFinanzasPor", "chequeoFinanzasEn")
          values ('p','c1', 100, ${lit(previo)}, ${lit(movimiento)}, true, 'chequeado', 'santi@x.com', now(), 'rechazado', 'aldana@x.com', now())`);
        const [antes] = await b.servicio<{ j: Fila }>(`select row_to_json(p) j from public.pagos p`);
        const ts = conComprobanteNuevo(comoPago(antes.j), nuevo);
        const r = await b.intentar("dante@x.com", `update public.pagos set ${asignaciones(ts.cambios)} where id = 'p'`);
        assert.ok(r.ok, r.ok ? "" : r.mensaje);
        const [d] = await b.servicio<{ j: Fila }>(`select row_to_json(p) j from public.pagos p`);
        const real = d.j;
        const etiqueta = `previo=${previo?.ruta} movimiento=${movimiento} nuevo=${nuevo.ruta}`;
        assert.ok(igualesJson(real.comprobante, nuevo), `${etiqueta}: el comprobante nuevo queda`);
        assert.equal(real.chequeoDirector ?? null, ts.pago.chequeoDirector ?? null, `${etiqueta}: casillero del director`);
        assert.equal(real.chequeoFinanzas ?? null, ts.pago.chequeoFinanzas ?? null, `${etiqueta}: casillero de finanzas`);
        assert.equal(real.chequeado ?? null, ts.pago.chequeado ?? null, `${etiqueta}: el sí/no de antes`);
        assert.equal(ts.reinicia, previo !== null && previo.ruta !== nuevo.ruta, `${etiqueta}: reinicia`);
      }
    }
  }
});
