/* Estrés del freno de las bajas de ventas (trigger ventas_cambio_de_baja, supabase/devoluciones.sql) en un Postgres en
   memoria (PGlite), con el RLS de verdad de tipos-cuenta.sql.

   Lo que dice el encabezado: quien ve «sólo lo suyo» (el closer) no puede cancelar una venta, marcarla como reembolsada ni
   reactivarla; el resto de la venta se edita igual. Se prueba con secuencias al azar de UPDATE de una columna, de fila entera,
   UPDATE sin `estado`, `estado = estado` y UPSERT (ON CONFLICT DO UPDATE, que es como guarda la app), hechas por todos los
   tipos de cuenta de fábrica, por tipos inventados y por la clave de servicio:
     · el closer (y cualquier tipo «sólo lo suyo») no cambia el estado desde ni hacia cancelada/reembolsada por ningún camino,
       y la base responde con el código de RLS (42501) que la app trata como «tu tipo de cuenta no puede…»;
     · lo que puedeDarDeBaja() de permisos.ts deja, la base también (la app nunca promete lo que la base niega);
     · quien no es «sólo lo suyo» y edita Ventas o Finanzas (director, administración, dueño) y el servidor sí pueden;
     · cambiar otras columnas, o pasar de activa a otra cosa que no sea baja, no se traba.

   Necesita PGlite (ver pg-arnes.ts); sin él, se saltea. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { puedeDarDeBaja, puedeEditar, type MiAcceso } from "@/lib/permisos";
import {
  altaDeTiposAlAzar, asignaciones, Azar, cargarPglite, lit, montarBanco, personasPorDefecto, type Banco, type PersonaConAcceso,
} from "./pg-arnes";

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/stress/pg-arnes.ts)";

let compartido: Promise<Banco> | null = null;
const banco = (): Promise<Banco> => (compartido ??= montarBanco(Pg!, { archivos: ["devoluciones.sql"], veces: 2 }));
after(async () => { if (compartido) await (await compartido).db.close(); });

type Estado = "activa" | "cancelada" | "reembolsada";
const ESTADOS: Estado[] = ["activa", "cancelada", "reembolsada"];
const esBaja = (e: string | null) => e === "cancelada" || e === "reembolsada";
const soloSuyo = (a: MiAcceso) => a.soloLoSuyo && a.tipo !== "dueno";

interface VentaMia { id: string; closerId: string }
const VENTAS: VentaMia[] = [];

async function sembrar(b: Banco, personas: PersonaConAcceso[], az: Azar): Promise<void> {
  await b.servicio(`truncate public.ventas, public.cuotas`);
  VENTAS.length = 0;
  const duenos = [...new Set(["m_dante", "m_otro", "m_santi", ...personas.map((p) => p.miembroId).filter((m): m is string => Boolean(m))])];
  duenos.forEach((closerId, i) => VENTAS.push({ id: `v${i}`, closerId }));
  await b.servicio(`insert into public.ventas (id, "closerId", estado, monto) values ${VENTAS.map((v) => `(${lit(v.id)}, ${lit(v.closerId)}, ${lit(az.elegir(ESTADOS))}, 100)`).join(", ")}`);
}

type Resultado = { ok: true } | { ok: false; codigo: string; mensaje: string };

test("el closer (o cualquier tipo «sólo lo suyo») no da de baja ni reactiva una venta por ningún camino; los demás sí", { skip: saltear }, async () => {
  const b = await banco();
  const az0 = new Azar(5);
  const personas: PersonaConAcceso[] = [...personasPorDefecto(), ...(await altaDeTiposAlAzar(b, az0, 16))];
  const visto = { bloqueados: 0, pasaronBaja: 0, otrosCambios: 0, upserts: 0, filaEntera: 0 };

  for (const semilla of [1, 2]) {
    const az = new Azar(semilla);
    await sembrar(b, personas, az);
    const traza: string[] = [];
    for (let paso = 0; paso < 190; paso++) {
      const persona: PersonaConAcceso | null = az.bool(0.1) ? null : az.elegir(personas);
      const a = persona?.acceso;
      /* Que los «sólo lo suyo» caigan seguido sobre ventas suyas: es donde está el freno. */
      const suyas = persona ? VENTAS.filter((v) => v.closerId === persona.miembroId) : [];
      const venta = suyas.length && az.bool(0.6) ? az.elegir(suyas) : az.elegir(VENTAS);
      const [{ estado: viejo }] = await b.servicio<{ estado: Estado }>(`select estado from public.ventas where id = ${lit(venta.id)}`);
      const nuevo = az.elegir(ESTADOS);
      const forma = az.elegir(["columna", "columna", "fila-entera", "sin-estado", "mismo", "upsert"] as const);
      let sql: string;
      switch (forma) {
        case "columna": sql = `update public.ventas set estado = ${lit(nuevo)} where id = ${lit(venta.id)}`; break;
        case "fila-entera": sql = `update public.ventas set ${asignaciones({ closerId: venta.closerId, setterId: null, contactoId: null, estado: nuevo, sesionId: null, monto: 100 })} where id = ${lit(venta.id)}`; visto.filaEntera++; break;
        case "sin-estado": sql = `update public.ventas set monto = ${az.entero(900)} where id = ${lit(venta.id)}`; break;
        case "mismo": sql = `update public.ventas set estado = estado, monto = ${az.entero(900)} where id = ${lit(venta.id)}`; break;
        default:
          sql = `insert into public.ventas (id, "closerId", estado, monto) values (${lit(venta.id)}, ${lit(venta.closerId)}, ${lit(nuevo)}, 100) `
            + `on conflict (id) do update set "closerId" = excluded."closerId", estado = excluded.estado, monto = excluded.monto`;
          visto.upserts++;
      }
      traza.push(`[${persona?.email ?? "servicio"} ${persona?.tipo ?? ""}] ${sql}`);
      const r: Resultado = await b.intentar(persona?.email ?? null, sql);
      const [{ estado: despues }] = await b.servicio<{ estado: Estado }>(`select estado from public.ventas where id = ${lit(venta.id)}`);
      const ctx = `semilla ${semilla}, paso ${paso}\n${traza.slice(-6).join("\n")}\nantes=${viejo}, después=${despues}`;

      const cambiaElEstado = forma !== "sin-estado" && forma !== "mismo" && nuevo !== viejo;
      const tocaBaja = cambiaElEstado && (esBaja(nuevo) || esBaja(viejo));
      const esSuya = !persona || !a || !soloSuyo(a) || venta.closerId === persona.miembroId;
      const puedeEscribir = !persona || puedeEditar(a!, "ventas");

      if (!persona) { assert.ok(r.ok, ctx); assert.equal(despues, forma === "sin-estado" || forma === "mismo" ? viejo : nuevo, ctx); continue; }
      if (!puedeEscribir || !esSuya) {
        /* El RLS: o no ve la fila (el UPDATE no toca nada) o el INSERT del upsert no pasa su WITH CHECK. */
        assert.equal(despues, viejo, `${ctx}\nno podía escribir esta venta y la cambió`);
        continue;
      }
      if (soloSuyo(a!) && tocaBaja) {
        assert.ok(!r.ok && r.codigo === "42501", `${ctx}\nun tipo «sólo lo suyo» no tiene que poder dar de baja ni reactivar: ${JSON.stringify(r)}`);
        assert.equal(despues, viejo, `${ctx}\nla venta cambió de estado`);
        visto.bloqueados++;
        continue;
      }
      assert.ok(r.ok, `${ctx}\nse trabó algo que se podía: ${r.ok ? "" : r.mensaje}`);
      assert.equal(despues, forma === "sin-estado" || forma === "mismo" ? viejo : nuevo, `${ctx}\nno quedó el estado pedido`);
      if (tocaBaja) { visto.pasaronBaja++; assert.ok(!soloSuyo(a!)); } else visto.otrosCambios++;
      /* La app nunca promete lo que la base niega: si puedeDarDeBaja lo permite, la base también (lo vemos arriba: no se trabó). */
      if (tocaBaja) assert.ok(!puedeDarDeBaja(a) || r.ok, ctx);
    }
  }
  assert.ok(visto.bloqueados >= 15 && visto.pasaronBaja >= 15 && visto.otrosCambios >= 30 && visto.upserts >= 25 && visto.filaEntera >= 25,
    `el generador tiene que llegar a todos los casos: ${JSON.stringify(visto)}`);
});

test("puedeDarDeBaja() (permisos.ts) nunca promete una baja que la base niega, en todas las combinaciones de áreas", { skip: saltear }, async () => {
  const b = await banco();
  const az = new Azar(77);
  const personas = await altaDeTiposAlAzar(b, az, 30, "tw");
  await sembrar(b, personas, az);
  let prometidas = 0, laBaseDejaYLaAppNo = 0;
  for (const p of personas) {
    const a = p.acceso;
    /* Una venta que el tipo ve: la suya si es «sólo lo suyo», cualquiera si no. */
    const venta = soloSuyo(a) ? VENTAS.find((v) => v.closerId === p.miembroId)! : VENTAS[0];
    for (const hacia of ["cancelada", "reembolsada"]) {
      await b.servicio(`update public.ventas set estado = 'activa' where id = ${lit(venta.id)}`);
      const r = await b.intentar(p.email, `update public.ventas set estado = ${lit(hacia)} where id = ${lit(venta.id)}`);
      const [{ estado }] = await b.servicio<{ estado: string }>(`select estado from public.ventas where id = ${lit(venta.id)}`);
      const pudo = r.ok && estado === hacia;
      if (puedeDarDeBaja(a)) { prometidas++; assert.ok(pudo, `${p.tipo} ${JSON.stringify(a.areas)}: puedeDarDeBaja dice que sí y la base no (${JSON.stringify(r)})`); }
      else if (pudo) laBaseDejaYLaAppNo++;
      if (soloSuyo(a)) assert.equal(estado, "activa", `${p.tipo}: un tipo «sólo lo suyo» no tiene que poder pasar una venta a ${hacia}`);
      /* Lo que la base deja: quien edita Ventas o Finanzas y no es «sólo lo suyo». */
      assert.equal(pudo, puedeEditar(a, "ventas") && !soloSuyo(a), `${p.tipo} ${JSON.stringify(a.areas)} soloLoSuyo=${a.soloLoSuyo}: quién puede dar de baja`);
    }
  }
  assert.ok(prometidas >= 4, `el generador tiene que dar tipos que puedan (${prometidas})`);
  /* Los tipos que sólo editan Finanzas (sin Ventas) la base sí los deja y la app no les ofrece el botón: la app es más estricta, no hay promesa rota. */
  assert.ok(laBaseDejaYLaAppNo >= 0);
});

test("el cambio de baja de una venta ajena tampoco pasa por un UPDATE que sólo toca otras columnas junto con el estado", { skip: saltear }, async () => {
  const b = await banco();
  await sembrar(b, personasPorDefecto(), new Azar(1));
  await b.servicio(`update public.ventas set estado = 'activa'`);
  /* Varias columnas a la vez, con el estado al final y al principio del SET. */
  for (const sql of [
    `update public.ventas set monto = 1, estado = 'cancelada' where id = 'v0'`,
    `update public.ventas set estado = 'cancelada', monto = 1 where id = 'v0'`,
    `update public.ventas set (monto, estado) = (1, 'reembolsada') where id = 'v0'`,
  ]) {
    const r = await b.intentar("dante@x.com", sql);
    assert.ok(!r.ok && r.codigo === "42501", sql);
  }
  const [{ estado }] = await b.servicio<{ estado: string }>(`select estado from public.ventas where id = 'v0'`);
  assert.equal(estado, "activa");
  /* Cancelada → activa (reactivar) tampoco. */
  await b.servicio(`update public.ventas set estado = 'cancelada' where id = 'v0'`);
  const re = await b.intentar("dante@x.com", `update public.ventas set estado = 'activa' where id = 'v0'`);
  assert.ok(!re.ok && re.codigo === "42501");
  const dir = await b.intentar("santi@x.com", `update public.ventas set estado = 'activa' where id = 'v0'`);
  assert.ok(dir.ok, "el director sí reactiva");
});
