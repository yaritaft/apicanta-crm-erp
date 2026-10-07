/* Estrés del trigger sesiones_marca_primera_carga (supabase/cierre-del-dia.sql) en un Postgres en memoria (PGlite).

   La marca de la PRIMERA vez que se cargó el Estado de Llamada y el Estado Pre-Call es lo que cuenta los strikes del
   cierre del día (lib/cierre-del-dia.ts: atrasoDe). Lo que dice el encabezado del SQL, y se prueba acá con secuencias
   al azar de UPDATE (por el closer dueño de la llamada, por otra persona y por la clave de servicio):

     · pasar el estado de vacío a cargado pone la marca (la hora del servidor si no vino) y la primera vez gana: si ya
       había una, queda esa;
     · cambiar el estado por otro NO la corre ni hacia adelante ni hacia atrás, aunque el cambio traiga otra;
     · vaciar el estado la conserva; sólo la saca un cambio que la manda en NULL a la vez que vacía el estado
       («Deshacer» la primera carga);
     · cada estado (Llamada y Pre-Call) lleva la suya, sin cruzarse; y cambiar otras columnas no las toca;
     · un estado cargado SIN marca (los de antes) sigue sin marca al cambiarlo: no se inventa una.
   Lo que NO se prueba como propiedad (decisión de diseño del SQL: la app es local-first y manda la hora de cuando el closer
   cargó, que puede ser anterior a la del servidor): una marca que viene en el mismo cambio que carga por primera vez, o
   que vacía el estado, se acepta tal cual.

   Necesita PGlite (ver pg-arnes.ts); sin él, se saltea. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { asignaciones, Azar, cargarPglite, lit, montarBanco, type Banco } from "./pg-arnes";

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/stress/pg-arnes.ts)";

let compartido: Promise<Banco> | null = null;
const banco = (): Promise<Banco> => (compartido ??= montarBanco(Pg!, { archivos: ["cierre-del-dia.sql"], veces: 2 }));
after(async () => { if (compartido) await (await compartido).db.close(); });

type Fila = Record<string, unknown>;
const CAMPOS = [{ estado: "estadoLlamada", marca: "estadoLlamadaEn" }, { estado: "estadoPreCall", marca: "estadoPreCallEn" }] as const;
const vacio = (v: unknown) => v === null || v === undefined || v === "";
const T = (n: number) => new Date(Date.UTC(2026, 9, 1, 10, n)).toISOString();
const ms = (v: unknown) => (v === null || v === undefined ? null : Date.parse(String(v)));

const leer = async (b: Banco): Promise<Fila> => (await b.servicio<{ j: Fila }>(`select row_to_json(s) as j from public.sesiones s where id = 's1'`))[0].j;

async function reiniciar(b: Banco, fila: Fila = {}): Promise<void> {
  await b.servicio(`truncate public.sesiones`);
  const base: Fila = { id: "s1", anfitrion: "Dante Closer", ...fila };
  const cols = Object.keys(base);
  await b.servicio(`insert into public.sesiones (${cols.map((c) => `"${c}"`).join(",")}) values (${cols.map((c) => lit(base[c])).join(",")})`);
}

test("la marca de la primera carga: secuencias al azar de cambios, vaciados y Deshacer, por el closer, otra persona y el servicio", { skip: saltear }, async () => {
  const b = await banco();
  const visto = { vacioACargado: 0, cambiado: 0, vaciado: 0, deshacer: 0, conMarcaPrevia: 0, recargaConOtraMarca: 0, recargaPreCall: 0, recargaLlamada: 0 };
  for (const semilla of [1, 2, 3, 4, 5]) {
    const az = new Azar(semilla);
    await reiniciar(b);
    const traza: string[] = [];
    for (let paso = 0; paso < 50; paso++) {
      const antes = await leer(b);
      const quien = az.elegir(["dante@x.com", "dante@x.com", "yari@x.com", "seti@x.com", "marta@x.com", null]);
      const cambios: Fila = {};
      const intencion: Record<string, { estado: string; mencionaMarca: boolean; marca?: unknown; nuevo?: unknown }> = {};
      for (const c of CAMPOS) {
        if (!az.bool(0.55)) continue;
        const nuevo = az.elegir<unknown>([null, "", "Compra Full", "Seguimiento", "Inasistió", "Compra Full"]);
        cambios[c.estado] = nuevo;
        let mencionaMarca = false, marca: unknown;
        if (vacio(nuevo)) {
          /* Vaciar: sólo se prueba el cambio que no trae marca o que la manda en NULL (Deshacer). */
          if (az.bool(0.25)) { mencionaMarca = true; marca = null; cambios[c.marca] = null; }
        } else if (!vacio(antes[c.estado]) && az.bool(0.35)) {
          /* Cambiar un estado cargado por otro, con una marca cualquiera: no la tiene que mover. */
          mencionaMarca = true; marca = az.elegir([null, T(1), T(500)]); cambios[c.marca] = marca;
        } else if (vacio(antes[c.estado]) && az.bool(0.6)) {
          /* Carga de vacío a cargado que trae una hora: si no había marca, se acepta (el cliente sabe cuándo lo cargó el closer); si ya había
             una (se vació y se vuelve a cargar), gana la primera. */
          mencionaMarca = true; marca = T(7); cambios[c.marca] = marca;
        }
        intencion[c.estado] = { estado: String(nuevo ?? "null"), mencionaMarca, marca, nuevo };
      }
      if (az.bool(0.2)) cambios.notas = "n" + paso;
      if (Object.keys(cambios).length === 0) cambios.notas = "n" + paso;
      const sql = `update public.sesiones set ${asignaciones(cambios)} where id = 's1'`;
      traza.push(`[${quien ?? "servicio"}] ${sql}`);
      const inicio = Date.now();
      const r = await b.intentar(quien, sql);
      /* Escriben las llamadas el closer (las suyas), el dueño, el setter (Leads editable) y el servicio; Marketing no. */
      const permitido = quien !== "marta@x.com";
      assert.ok(r.ok, `semilla ${semilla}: ${r.ok ? "" : r.mensaje}\n${traza.slice(-8).join("\n")}`);
      const despues = await leer(b);
      const ctx = `semilla ${semilla}, paso ${paso}\n${traza.slice(-8).join("\n")}\nantes=${JSON.stringify(antes)}\ndespués=${JSON.stringify(despues)}`;
      if (!permitido) { assert.deepEqual(despues, antes, `${ctx}\nMarketing no edita las llamadas`); continue; }

      for (const c of CAMPOS) {
        const m0 = antes[c.marca] ?? null, m1 = despues[c.marca] ?? null;
        const e0 = antes[c.estado], e1 = despues[c.estado];
        const dice = intencion[c.estado];
        if (!dice) {
          assert.equal(e1 ?? null, e0 ?? null, `${ctx}\nel estado ${c.estado} no tenía que moverse`);
          assert.equal(m1, m0, `${ctx}\ncambiar otra cosa movió ${c.marca}`);
          continue;
        }
        if (vacio(dice.nuevo)) {
          if (m0 !== null) visto.conMarcaPrevia++;
          if (dice.mencionaMarca) { assert.equal(m1, null, `${ctx}\nDeshacer (vaciar y marca NULL) tiene que sacar ${c.marca}`); if (!vacio(e0)) visto.deshacer++; }
          else { assert.equal(m1, m0, `${ctx}\nvaciar tiene que conservar ${c.marca}`); if (!vacio(e0)) visto.vaciado++; }
        } else if (vacio(e0)) {
          visto.vacioACargado++;
          if (m0 !== null && dice.mencionaMarca) { visto.recargaConOtraMarca++; if (c.estado === "estadoPreCall") visto.recargaPreCall++; else visto.recargaLlamada++; }
          if (m0 !== null) assert.equal(m1, m0, `${ctx}\nla primera vez gana: ${c.marca} tenía que quedar la de antes`);
          else if (dice.mencionaMarca) assert.equal(ms(m1), ms(dice.marca), `${ctx}\nla hora que trae la primera carga se acepta`);
          else assert.ok(m1 !== null && Math.abs(Date.parse(String(m1)) - inicio) < 120_000, `${ctx}\nde vacío a cargado tenía que poner la hora del servidor y quedó ${m1}`);
        } else {
          visto.cambiado++;
          if (m0 !== null) assert.equal(m1, m0, `${ctx}\ncambiar el estado por otro corrió ${c.marca} (nunca hacia adelante ni hacia atrás)`);
          else if (dice.mencionaMarca && dice.marca !== null) assert.equal(ms(m1), ms(dice.marca), `${ctx}\nuna llamada de antes (sin marca) toma la que trae el cambio`);
          else assert.equal(m1, null, `${ctx}\nun estado de antes (sin marca) no se marca al cambiarlo`);
        }
      }
    }
  }
  assert.ok(visto.vacioACargado >= 20 && visto.cambiado >= 20 && visto.vaciado >= 10 && visto.deshacer >= 5 && visto.conMarcaPrevia >= 10 && visto.recargaPreCall >= 2 && visto.recargaLlamada >= 2,
    `el generador tiene que llegar a todos los casos: ${JSON.stringify(visto)}`);
});

test("el estado cargado sin marca (los de antes) no se marca al cambiarlo; sí al pasar de vacío a cargado", { skip: saltear }, async () => {
  const b = await banco();
  await reiniciar(b, { estadoLlamada: "Compra Full", estadoPreCall: "Confirmado" });
  await b.servicio(`update public.sesiones set "estadoLlamada" = 'Seguimiento' where id = 's1'`);
  let f = await leer(b);
  assert.equal(f.estadoLlamadaEn ?? null, null);
  await b.servicio(`update public.sesiones set "estadoLlamada" = null where id = 's1'`);
  await b.servicio(`update public.sesiones set "estadoLlamada" = 'Compra Full' where id = 's1'`);
  f = await leer(b);
  assert.ok(f.estadoLlamadaEn, "de vacío a cargado la pone");
  assert.equal(f.estadoPreCallEn ?? null, null, "y la del Pre-Call sigue sin marca");
});

test("la marca sobrevive a que una pestaña vieja guarde la llamada con otro estado y otra marca", { skip: saltear }, async () => {
  const b = await banco();
  await reiniciar(b);
  await b.servicio(`update public.sesiones set "estadoLlamada" = 'Compra Full', "estadoLlamadaEn" = ${lit(T(1))} where id = 's1'`);
  /* La pestaña vieja carga el mismo estado, otro día, y también lo vacía y lo vuelve a cargar. */
  for (const sql of [
    `update public.sesiones set "estadoLlamada" = 'Seguimiento', "estadoLlamadaEn" = ${lit(T(900))} where id = 's1'`,
    `update public.sesiones set "estadoLlamada" = null where id = 's1'`,
    `update public.sesiones set "estadoLlamada" = 'Inasistió', "estadoLlamadaEn" = ${lit(T(901))} where id = 's1'`,
  ]) await b.servicio(sql);
  const f = await leer(b);
  assert.equal(ms(f.estadoLlamadaEn), Date.parse(T(1)), "queda la primera");
});

test("el upsert de Calendly (sin los estados) sobre una llamada ya cargada no toca las marcas", { skip: saltear }, async () => {
  const b = await banco();
  await reiniciar(b);
  await b.servicio(`update public.sesiones set "estadoLlamada" = 'Compra Full', "estadoLlamadaEn" = ${lit(T(3))}, "estadoPreCall" = 'Confirmado', "estadoPreCallEn" = ${lit(T(2))} where id = 's1'`);
  await b.servicio(`insert into public.sesiones (id, anfitrion, "leadId") values ('s1', 'Dante Closer', 'l9') on conflict (id) do update set anfitrion = excluded.anfitrion, "leadId" = excluded."leadId"`);
  const f = await leer(b);
  assert.equal(ms(f.estadoLlamadaEn), Date.parse(T(3)));
  assert.equal(ms(f.estadoPreCallEn), Date.parse(T(2)));
  assert.equal(f.estadoLlamada, "Compra Full");
});
